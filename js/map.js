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
    let tx = Math.floor(px / 32);
    let ty = Math.floor((py - (tx % 2) * 16) / 32);

    // 先检查初始估计 tile，再检查 3x3 邻域
    if (isPointInTile(px, py, tx, ty)) {
      return { x: tx, y: ty };
    }

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const cx = tx + dx;
        const cy = ty + dy;
        if (isPointInTile(px, py, cx, cy)) {
          return { x: cx, y: cy };
        }
      }
    }

    return { x: tx, y: ty };
  }

  function isPointInTile(px, py, tx, ty) {
    const centerX = tx * 32;
    const centerY = ty * 32 + (tx % 2) * 16;
    const dx = px - centerX;
    const dy = py - centerY;

    const dyIdx = Math.floor(dy + 15);
    if (dyIdx < 0 || dyIdx >= 32) return false;

    // hSegmentTable 是原始碰撞盒数据（半宽为渲染菱形的 2 倍），取一半以匹配 64x30 渲染菱形
    const halfWidth = hSegmentTable[dyIdx] / 2;
    return Math.abs(dx) <= halfWidth + 0.5;
  }

  // Tile 坐标 -> 像素坐标（左上角）
  function tileToPixel(tx, ty) {
    return { x: tx * 32, y: ty * 32 + (tx % 2) * 16 };
  }

  // 计算相邻 Tile 坐标
  // 方向：1=东(右下), 2=南(左下), 3=西(左上), 4=北(右上), 5=上, 6=下, 7=左(奇x), 8=右(奇x)
  function getNeighborTile(tx, ty, direction) {
    const isOdd = (tx % 2 !== 0);
    switch (direction) {
      case 1:
        return isOdd ? { x: tx + 1, y: ty + 1 } : { x: tx + 1, y: ty };
      case 2:
        return isOdd ? { x: tx - 1, y: ty + 1 } : { x: tx - 1, y: ty };
      case 3:
        return isOdd ? { x: tx - 1, y: ty } : { x: tx - 1, y: ty - 1 };
      case 4:
        return isOdd ? { x: tx + 1, y: ty } : { x: tx + 1, y: ty - 1 };
      case 5:
        return { x: tx, y: ty - 1 };
      case 6:
        return { x: tx, y: ty + 1 };
      case 7:
        return { x: tx - 2, y: ty };
      case 8:
        return { x: tx + 2, y: ty };
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
    const total = MAP_WIDTH * MAP_HEIGHT * MAP_LAYERS;
    const mapBytes = total * 2; // 65536 bytes
    const view = new DataView(buffer);
    // 读取 mapData（前半部分）
    for (let i = 0; i < total; i++) {
      mapData[i] = view.getUint16(i * 2, true);
    }
    // 如果文件大于 65536 字节，读取 templateData；否则 templateData 清零
    if (buffer.byteLength >= mapBytes * 2) {
      for (let i = 0; i < total; i++) {
        templateData[i] = view.getUint16(mapBytes + i * 2, true);
      }
    } else {
      templateData.fill(0);
    }
  }

  function saveMap() {
    const total = MAP_WIDTH * MAP_HEIGHT * MAP_LAYERS;
    // PAL 标准 MAP 文件只有 65536 字节（mapData），不写 templateData
    const buffer = new ArrayBuffer(total * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < total; i++) {
      view.setUint16(i * 2, mapData[i], true);
    }
    return buffer;
  }

  function newMap() {
    mapData.fill(0);
    templateData.fill(0);
  }

  function remapTileImage(oldId, newId) {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let x = 0; x < MAP_WIDTH; x++) {
        for (let l = 0; l < MAP_LAYERS; l++) {
          const currentImg = getTileImage(x, y, l);
          if (currentImg === oldId) {
            setTileImage(x, y, l, newId === -1 ? 0 : newId);
          } else if (newId === -1 && currentImg > oldId) {
            setTileImage(x, y, l, currentImg - 1);
          }
        }
      }
    }
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
    setLayerImage,
    setLayerHeight,
    getLayerHeight,
    isBarrier,
    loadMap,
    saveMap,
    newMap,
    remapTileImage,
  };
})();
