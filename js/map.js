const MapModule = (function () {
  const MAP_WIDTH = 128;
  const MAP_HEIGHT = 128;
  const MAP_LAYERS = 2;

  // 地图数据: 每个 Tile 是 16-bit WORD
  // bit 0-7   : 图块图像编号 (0-255)
  // bit 8     : 扩展图块编号第9位
  // bit 9-12  : 高度 (0-15)
  // bit 13    : 障碍标记
  // 注意：实际存储时用的是 WORD，但逻辑上按 DWORD 操作
  let mapData = new Uint16Array(MAP_WIDTH * MAP_HEIGHT * MAP_LAYERS);
  let templateData = new Uint16Array(MAP_WIDTH * MAP_HEIGHT * MAP_LAYERS);

  // Tile 在不同 y 坐标下的水平切片宽度
  const hSegmentTable = [
    8, 8, 16, 16, 24, 24, 32, 32, 40, 40, 48, 48, 56, 56, 64, 64,
    56, 56, 48, 48, 40, 40, 32, 32, 24, 24, 16, 16, 8, 8, 0, 0,
  ];

  // Tile 在不同 x 坐标下的垂直切片高度
  const vSegmentTable = [
    2, 2, 2, 2, 6, 6, 6, 6, 10, 10, 10, 10, 14, 14, 14, 14,
    18, 18, 18, 18, 22, 22, 22, 22, 26, 26, 26, 26, 30, 30, 30, 30,
    30, 30, 30, 30, 26, 26, 26, 26, 22, 22, 22, 22, 18, 18, 18, 18,
    14, 14, 14, 14, 10, 10, 10, 10, 6, 6, 6, 6, 2, 2, 2, 2,
  ];

  function getBit(value, bit) {
    return (value >> (bit - 1)) & 1;
  }

  function setBit(value, bit, set) {
    if (set) {
      return value | (1 << (bit - 1));
    } else {
      return value & ~(1 << (bit - 1));
    }
  }

  function setLayerImage(layer, image) {
    // bit 0-7 + bit 8 (第9位)
    let v = layer;
    for (let i = 1; i <= 8; i++) {
      v = setBit(v, i, getBit(image, i));
    }
    v = setBit(v, 8 + 5, getBit(image, 9));
    return v;
  }

  function setLayerHeight(layer, height) {
    // bit 9-12
    let v = layer;
    for (let i = 1; i <= 4; i++) {
      v = setBit(v, i + 8, getBit(height, i));
    }
    return v;
  }

  function setTileBarrier(layer, barrier) {
    // bit 13 (8 + 5 + 1 = 14? 等一下，原代码是 SetBit(dwpLayer, 8 + 6, bBarrier))
    // 8+6 = 14, 所以是 bit 14 (1-indexed)，即 bit 13 (0-indexed)
    return setBit(layer, 14, barrier);
  }

  function getLayerImage(layer) {
    let image = 0;
    for (let i = 1; i <= 8; i++) {
      image = setBit(image, i, getBit(layer, i));
    }
    if (getBit(layer, 13) === 1) {
      image = setBit(image, 9, true);
    }
    return image;
  }

  function getLayerHeight(layer) {
    return (layer >> 8) & 0xf;
  }

  function isBarrier(layer) {
    return getBit(layer, 14) === 1;
  }

  function calcSegmentPointAtLine(x, a, b) {
    x++; // 坐标从0算起，但计算时+1
    const c = a + b;
    const d = Math.floor((x - (x % c)) / c);
    let segment = d * 2;
    if (x % c > a) {
      segment++;
    }
    return segment;
  }

  // 像素坐标 -> Tile 坐标
  function pixelToTile(px, py) {
    const yt = ((py % 32) + 32) % 32;
    const a = hSegmentTable[yt];
    const b = 64 - a;
    let xt = px - Math.floor(b / 2);
    const tileX = calcSegmentPointAtLine(xt, a, b);

    const xt2 = ((px % 64) + 64) % 64;
    const a2 = vSegmentTable[xt2];
    const b2 = 30 - a2;
    const yt2 = py - Math.floor(b2 / 2);
    const tileY = Math.floor((yt2 - ((yt2 % 32) + 32) % 32) / 32);

    return { x: tileX, y: tileY };
  }

  // Tile 坐标 -> 像素坐标（左上角）
  function tileToPixel(tx, ty) {
    return { x: tx * 32, y: ty * 32 + (tx % 2) * 16 };
  }

  // 计算相邻 Tile 坐标
  // 方向：1=东(右下), 2=南(左下), 3=西(左上), 4=北(右上)
  function getNeighborTile(tx, ty, direction) {
    switch (direction) {
      case 1:
        return tx % 2 === 0 ? { x: tx + 1, y: ty } : { x: tx + 1, y: ty + 1 };
      case 2:
        return tx % 2 === 0 ? { x: tx - 1, y: ty } : { x: tx - 1, y: ty + 1 };
      case 3:
        return tx % 2 === 0 ? { x: tx - 1, y: ty - 1 } : { x: tx - 1, y: ty };
      case 4:
        return tx % 2 === 0 ? { x: tx + 1, y: ty - 1 } : { x: tx + 1, y: ty };
      default:
        return { x: tx, y: ty };
    }
  }

  function assert(x, y) {
    return x >= 0 && x < MAP_WIDTH && y >= 0 && y < MAP_HEIGHT;
  }

  function getTile(x, y, layer) {
    if (!assert(x, y)) return 0;
    return mapData[y * MAP_WIDTH * MAP_LAYERS + x * MAP_LAYERS + layer];
  }

  function setTile(x, y, layer, value) {
    if (!assert(x, y)) return;
    mapData[y * MAP_WIDTH * MAP_LAYERS + x * MAP_LAYERS + layer] = value;
  }

  function getTileImage(x, y, layer) {
    return getLayerImage(getTile(x, y, layer));
  }

  function getTileHeight(x, y, layer) {
    return getLayerHeight(getTile(x, y, layer));
  }

  function getTileBarrier(x, y) {
    return isBarrier(getTile(x, y, 0));
  }

  function setTileImage(x, y, layer, image) {
    setTile(x, y, layer, setLayerImage(getTile(x, y, layer), image));
  }

  function setTileHeight(x, y, layer, height) {
    setTile(x, y, layer, setLayerHeight(getTile(x, y, layer), height));
  }

  function setTileBarrierValue(x, y, barrier) {
    setTile(x, y, 0, setTileBarrier(getTile(x, y, 0), barrier));
  }

  function loadMap(buffer) {
    // 地图文件: 128*128*2*2 = 65536 bytes map + 65536 bytes template
    const data = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const total = MAP_WIDTH * MAP_HEIGHT * MAP_LAYERS;
    for (let i = 0; i < total; i++) {
      mapData[i] = view.getUint16(i * 2, true);
    }
    for (let i = 0; i < total; i++) {
      templateData[i] = view.getUint16(total * 2 + i * 2, true);
    }
  }

  function saveMap() {
    const total = MAP_WIDTH * MAP_HEIGHT * MAP_LAYERS;
    const buffer = new ArrayBuffer(total * 2 * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < total; i++) {
      view.setUint16(i * 2, mapData[i], true);
    }
    for (let i = 0; i < total; i++) {
      view.setUint16(total * 2 + i * 2, templateData[i], true);
    }
    return buffer;
  }

  function newMap() {
    mapData.fill(0);
    templateData.fill(0);
  }

  return {
    MAP_WIDTH,
    MAP_HEIGHT,
    MAP_LAYERS,
    pixelToTile,
    tileToPixel,
    getNeighborTile,
    assert,
    getTile,
    setTile,
    getTileImage,
    getTileHeight,
    getTileBarrier,
    setTileImage,
    setTileHeight,
    setTileBarrierValue,
    getLayerImage,
    getLayerHeight,
    isBarrier,
    loadMap,
    saveMap,
    newMap,
  };
})();
