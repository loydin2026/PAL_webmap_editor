const GopLoader = (function () {
  // RLE 解码，对应 C++ 的 DecodeRLE
  function decodeRLE(imageCode, bufferLen) {
    const data = new Uint8Array(imageCode);
    let offset = 0;

    // 如果前 4 字节是 0x00000002，跳过
    if (
      data.length >= 4 &&
      (data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)) === 0x00000002
    ) {
      offset += 4;
    }

    const width = data[offset] | (data[offset + 1] << 8);
    const height = data[offset + 2] | (data[offset + 3] << 8);
    offset += 4;

    if (!width || !height || width <= 0 || height <= 0) {
      throw new Error('Invalid RLE image size: ' + width + 'x' + height);
    }

    const dwLen = width * height;
    if (dwLen > bufferLen) {
      throw new Error('RLE buffer too small');
    }

    const buffer = new Uint8Array(dwLen);
    buffer.fill(0xff); // 全设为关键色（调色板索引 255）

    let i = 0;
    while (i < dwLen && offset < data.length) {
      const T = data[offset++];
      if (0x80 < T && T <= 0x80 + width) {
        // 跳过 T - 0x80 个像素
        i += T - 0x80;
      } else {
        // 复制 T 个字节
        const copyLen = Math.min(T, dwLen - i, data.length - offset);
        for (let k = 0; k < copyLen; k++) {
          buffer[i + k] = data[offset + k];
        }
        offset += copyLen;
        i += T;
      }
    }

    return { width, height, buffer };
  }

  // 把 256 色图像 + 调色板 转成 ImageData
  function toImageData(indices, width, height, palette) {
    const imgData = new ImageData(width, height);
    const pixels = imgData.data;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = indices[y * width + x];
        const px = (y * width + x) * 4;
        const r = palette[idx * 4 + 0];
        const g = palette[idx * 4 + 1];
        const b = palette[idx * 4 + 2];
        pixels[px + 0] = r;
        pixels[px + 1] = g;
        pixels[px + 2] = b;
        // 透明色：索引 255（RLE 空白区域）或 RGB 恰好等于 (108, 88, 100)
        if (idx === 255 || (r === 108 && g === 88 && b === 100)) {
          pixels[px + 3] = 0;
        } else {
          pixels[px + 3] = 255;
        }
      }
    }
    return imgData;
  }

  // 放大 N 倍（nearest-neighbor）
  function scaleImageData(src, scale) {
    const w = src.width * scale;
    const h = src.height * scale;
    const dst = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = Math.floor(x / scale);
        const sy = Math.floor(y / scale);
        const sIdx = (sy * src.width + sx) * 4;
        const dIdx = (y * w + x) * 4;
        dst.data[dIdx + 0] = src.data[sIdx + 0];
        dst.data[dIdx + 1] = src.data[sIdx + 1];
        dst.data[dIdx + 2] = src.data[sIdx + 2];
        dst.data[dIdx + 3] = src.data[sIdx + 3];
      }
    }
    return dst;
  }

  // 从 ImageData 生成 1x1 的迷你图（取中心颜色）
  function createMiniImage(srcImageData) {
    const cx = Math.floor(srcImageData.width / 2);
    const cy = Math.floor(srcImageData.height / 2);
    const idx = (cy * srcImageData.width + cx) * 4;
    const mini = new ImageData(1, 1);
    mini.data[0] = srcImageData.data[idx + 0];
    mini.data[1] = srcImageData.data[idx + 1];
    mini.data[2] = srcImageData.data[idx + 2];
    mini.data[3] = srcImageData.data[idx + 3];
    return mini;
  }

  // 解析 GOP 文件
  function parseGopBuffer(buffer, palette) {
    const data = new Uint8Array(buffer);
    if (data.length < 4) {
      throw new Error('GOP file too small');
    }
    const view = new DataView(buffer);
    const dwLen = view.getUint32(0, true); // 总数据长度
    if (dwLen === 0 || dwLen > data.length - 4) {
      throw new Error('Invalid GOP data length: ' + dwLen);
    }
    const imageCode = data.slice(4, 4 + dwLen);
    if (imageCode.length < 2) {
      throw new Error('GOP ImageCode too small');
    }

    const imageCount = (imageCode[0] | (imageCode[1] << 8)) - 1;
    if (imageCount <= 0 || imageCount > 512) {
      throw new Error('Invalid GOP image count: ' + imageCount);
    }

    const offsets = new Int32Array(imageCount + 1);
    for (let i = 0; i <= imageCount; i++) {
      offsets[i] = (imageCode[i * 2 + 0] | (imageCode[i * 2 + 1] << 8)) * 2;
    }

    const tiles = [];
    const miniTiles = [];

    for (let i = 0; i < imageCount; i++) {
      const offset = offsets[i];
      const nextOffset = (i + 1 < imageCount) ? offsets[i + 1] : imageCode.length;
      const tileData = imageCode.slice(offset, nextOffset);
      if (tileData.length === 0) {
        console.warn('GOP Tile', i, 'has empty data, skipping');
        continue;
      }

      const { width, height, buffer: decoded } = decodeRLE(tileData, 32 * 15);
      if (!width || !height || width <= 0 || height <= 0) {
        console.warn('GOP Tile', i, 'has invalid size:', width, 'x', height, 'skipping');
        continue;
      }
      if (width !== 32 || height !== 15) {
        console.warn('GOP Tile', i, 'has non-standard size:', width, 'x', height);
      }

      const imgData = toImageData(decoded, width, height, palette);
      const scaled = scaleImageData(imgData, 2); // 64x30
      tiles.push(scaled);
      miniTiles.push(createMiniImage(scaled));
    }

    return { imageCount, tiles, miniTiles };
  }

  async function load(url, palette) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const buffer = await response.arrayBuffer();
    return parseGopBuffer(buffer, palette);
  }

  function loadFromFile(file, palette) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          resolve(parseGopBuffer(e.target.result, palette));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  // GOP 编码器：将 ImageData 数组编码为 GOP 二进制文件
  function encodeGOP(tiles, palette) {
    if (!tiles || tiles.length === 0) throw new Error('没有图块可编码');

    // 构建反向调色板映射 (RGB -> 索引)
    const paletteMap = new Map();
    for (let i = 0; i < 256; i++) {
      const r = palette[i * 4];
      const g = palette[i * 4 + 1];
      const b = palette[i * 4 + 2];
      paletteMap.set((r << 16) | (g << 8) | b, i);
    }

    const encodedTiles = [];
    for (const tile of tiles) {
      // 缩小到 32x15（原始 GOP 尺寸）
      const small = shrinkImageData(tile, 2);
      // 转换为 256 色索引
      const indices = imageDataToIndices(small, palette, paletteMap);
      // RLE 编码
      const encoded = rleEncode(indices, 32, 15);
      encodedTiles.push(encoded);
    }

    // 构建偏移表
    const imageCount = encodedTiles.length;
    const countPlus1 = imageCount + 1;
    const offsetTableSize = countPlus1 * 2;

    let currentOffset = offsetTableSize;
    const offsets = [currentOffset];
    const allData = [];

    for (const encoded of encodedTiles) {
      allData.push(encoded);
      currentOffset += encoded.length;
      // 确保偶数偏移
      if (currentOffset % 2 !== 0) {
        allData.push(new Uint8Array([0x00]));
        currentOffset++;
      }
      offsets.push(currentOffset);
    }

    // 构建 imageCode
    const imageCodeLen = offsetTableSize + allData.reduce((sum, d) => sum + d.length, 0);
    const imageCode = new Uint8Array(imageCodeLen);
    const dv = new DataView(imageCode.buffer);

    // 写入 count_plus_1 / offsets[0]
    dv.setUint16(0, countPlus1, true);

    // 写入偏移表
    for (let i = 0; i < countPlus1; i++) {
      dv.setUint16(i * 2, offsets[i] / 2, true);
    }

    // 写入 tile 数据
    let pos = offsetTableSize;
    for (const data of allData) {
      imageCode.set(data, pos);
      pos += data.length;
    }

    // 构建完整文件
    const dwLen = imageCode.length;
    const file = new Uint8Array(4 + dwLen);
    const fileDv = new DataView(file.buffer);
    fileDv.setUint32(0, dwLen, true);
    file.set(imageCode, 4);

    return file.buffer;
  }

  function shrinkImageData(src, scale) {
    const w = src.width / scale;
    const h = src.height / scale;
    const dst = new ImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x * scale;
        const sy = y * scale;
        const sIdx = (sy * src.width + sx) * 4;
        const dIdx = (y * w + x) * 4;
        dst.data[dIdx + 0] = src.data[sIdx + 0];
        dst.data[dIdx + 1] = src.data[sIdx + 1];
        dst.data[dIdx + 2] = src.data[sIdx + 2];
        dst.data[dIdx + 3] = src.data[sIdx + 3];
      }
    }
    return dst;
  }

  function imageDataToIndices(imgData, palette, paletteMap) {
    const indices = new Uint8Array(imgData.width * imgData.height);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const r = imgData.data[i];
      const g = imgData.data[i + 1];
      const b = imgData.data[i + 2];
      const a = imgData.data[i + 3];

      if (a === 0 || (r === 108 && g === 88 && b === 100)) {
        indices[i / 4] = 0xFF;
      } else {
        const key = (r << 16) | (g << 8) | b;
        if (paletteMap.has(key)) {
          indices[i / 4] = paletteMap.get(key);
        } else {
          // 查找最接近的颜色
          let bestDist = Infinity;
          let bestIdx = 0xFF;
          for (let p = 0; p < 256; p++) {
            const pr = palette[p * 4];
            const pg = palette[p * 4 + 1];
            const pb = palette[p * 4 + 2];
            const dr = r - pr, dg = g - pg, db = b - pb;
            const dist = dr * dr + dg * dg + db * db;
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = p;
            }
          }
          indices[i / 4] = bestIdx;
        }
      }
    }
    return indices;
  }

  function rleEncode(indices, width, height) {
    const result = [];
    // 添加 0x00000002 前缀
    result.push(0x02, 0x00, 0x00, 0x00);
    // 写入 width 和 height
    result.push(width & 0xFF, (width >> 8) & 0xFF);
    result.push(height & 0xFF, (height >> 8) & 0xFF);

    let i = 0;
    const total = width * height;

    while (i < total) {
      if (indices[i] === 0xFF) {
        // 跳过透明像素
        let skip = 0;
        while (i < total && indices[i] === 0xFF && skip < width) {
          skip++;
          i++;
        }
        if (skip > 0) {
          result.push(0x80 + skip);
        }
      } else {
        // 复制非透明像素
        let copy = 0;
        const copyData = [];
        while (i < total && indices[i] !== 0xFF && copy < 255) {
          copyData.push(indices[i]);
          copy++;
          i++;
        }

        // 检查 copy 值是否在跳过范围（0x81-0x80+width）内
        if (copy >= 0x81 && copy <= 0x80 + width) {
          // 拆分为两个复制命令
          const split = copy - 1;
          result.push(split);
          for (let j = 0; j < split; j++) result.push(copyData[j]);
          result.push(1);
          result.push(copyData[split]);
        } else {
          result.push(copy);
          for (let j = 0; j < copy; j++) result.push(copyData[j]);
        }
      }
    }

    return new Uint8Array(result);
  }

  return {
    load,
    loadFromFile,
    parseGopBuffer,
    decodeRLE,
    scaleImageData,
    encodeGOP,
  };
})();
