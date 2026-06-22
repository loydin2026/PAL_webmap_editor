const Renderer = (function () {
  const TILE_W = 64;  // 放大后的图块宽度
  const TILE_H = 30;  // 放大后的图块高度
  const TILE_HALF_W = 32;
  const TILE_HALF_H = 16;  // 与原始 C++ 代码一致：Map_DrawTile 中 yDest -= 16

  let mapCanvas = null;
  let mapCtx = null;
  let miniCanvas = null;
  let miniCtx = null;
  let backCanvas = null;
  let backCtx = null;

  // 颜色键（透明色）RGB(108, 88, 100)
  const COLOR_KEY_R = 108;
  const COLOR_KEY_G = 88;
  const COLOR_KEY_B = 100;

  function init(mapCanvasId, miniCanvasId) {
    mapCanvas = document.getElementById(mapCanvasId);
    mapCtx = mapCanvas.getContext('2d', { alpha: false });
    mapCtx.imageSmoothingEnabled = false;
    miniCanvas = document.getElementById(miniCanvasId);
    miniCtx = miniCanvas.getContext('2d');
    miniCtx.imageSmoothingEnabled = false;

    backCanvas = document.createElement('canvas');
    backCanvas.width = 1024;
    backCanvas.height = 768;
    backCtx = backCanvas.getContext('2d', { alpha: false });
    backCtx.imageSmoothingEnabled = false;
  }

  function resize(w, h) {
    mapCanvas.width = w;
    mapCanvas.height = h;
    mapCtx.imageSmoothingEnabled = false;
    backCanvas.width = w;
    backCanvas.height = h;
    backCtx.imageSmoothingEnabled = false;
  }

  // 绘制一个图块（支持 ImageData 和 Image/Canvas 两种类型）
  function drawTileImage(ctx, x, y, source) {
    if (!source) return;
    if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
      ctx.drawImage(source, x, y);
    } else {
      // ImageData：使用临时 Canvas 缓存
      let temp = source._tempCanvas;
      if (!temp) {
        temp = document.createElement('canvas');
        temp.width = source.width;
        temp.height = source.height;
        const tctx = temp.getContext('2d');
        tctx.imageSmoothingEnabled = false;
        tctx.putImageData(source, 0, 0);
        source._tempCanvas = temp;
      }
      ctx.drawImage(temp, x, y);
    }
  }

  // 绘制地图
  // cameraX, cameraY: 视口左上角的 Tile 坐标
  // tiles: GOP 图块数组 (ImageData 数组)
  // showBarrier: 是否显示障碍标记
  // showObject: 是否显示人物对象
  // objectImg: 人物对象的 ImageData
  // mouseTile: {x, y} 鼠标悬停的 Tile
  // selTile: {x, y} 选中的 Tile
  // barrierImg: 障碍标记的 ImageData
  // mouseImg: 鼠标悬停标记的 ImageData
  // selImg: 选中标记的 ImageData
  function renderMap(cameraX, cameraY, tiles, showL0, showL1, showBarrier, showObject, objectImg,
                     mouseTile, selTile, barrierImg, mouseImg, selImg,
                     previewTemplate, previewPos) {
    const ctx = backCtx;
    const cw = backCanvas.width;
    const ch = backCanvas.height;

    // 清屏为黑色
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cw, ch);

    // 计算可见范围（根据容器尺寸动态计算）
    const viewW = Math.ceil(cw / 32) + 4;
    const viewH = Math.ceil(ch / 32) + 4;

    // 从 camera 位置开始绘制，先 y 后 x（同原代码）
    for (let ly = 0; ly < viewH; ly++) {
      for (let lx = 0; lx < viewW; lx++) {
        const tx = cameraX + lx;
        const ty = cameraY + ly;
        if (!MapModule.assert(tx, ty)) continue;

        const px = MapModule.tileToPixel(tx, ty).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
        const py = MapModule.tileToPixel(tx, ty).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H;

        // 只绘制在视口内的
        if (px + TILE_W < 0 || py + TILE_H < 0 || px >= cw || py >= ch) continue;

        // Layer0
        if (showL0) {
          const img0 = MapModule.getTileImage(tx, ty, 0);
          if (img0 >= 0 && img0 < tiles.length) {
            drawTileImage(ctx, px, py, tiles[img0]);
          }
        }

        // Layer1
        if (showL1) {
          const img1 = MapModule.getTileImage(tx, ty, 1);
          if (img1 > 0 && img1 - 1 < tiles.length) {
            drawTileImage(ctx, px, py, tiles[img1 - 1]);
          }
        }
      }
    }

    // 绘制人物对象（在选中的 Tile 上，向上偏移 110-32=78 像素）
    if (showObject && selTile && MapModule.assert(selTile.x, selTile.y)) {
      const px = MapModule.tileToPixel(selTile.x, selTile.y).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
      const py = MapModule.tileToPixel(selTile.x, selTile.y).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H - (110 - 32);
      if (objectImg) {
        drawTileImage(ctx, px, py, objectImg);
      }
    }

    // 绘制障碍标记
    if (showBarrier) {
      for (let ly = 0; ly < viewH; ly++) {
        for (let lx = 0; lx < viewW; lx++) {
          const tx = cameraX + lx;
          const ty = cameraY + ly;
          if (!MapModule.assert(tx, ty)) continue;
          if (MapModule.getTileBarrier(tx, ty)) {
            const px = MapModule.tileToPixel(tx, ty).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
            const py = MapModule.tileToPixel(tx, ty).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H;
            if (barrierImg) {
              drawTileImage(ctx, px, py, barrierImg);
            }
          }
        }
      }
    }

    // 绘制鼠标悬停标记
    if (mouseTile && MapModule.assert(mouseTile.x, mouseTile.y)) {
      const px = MapModule.tileToPixel(mouseTile.x, mouseTile.y).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
      const py = MapModule.tileToPixel(mouseTile.x, mouseTile.y).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H;
      if (mouseImg) {
        drawTileImage(ctx, px, py, mouseImg);
      }
    }

    // 绘制选中标记
    if (selTile && MapModule.assert(selTile.x, selTile.y)) {
      const px = MapModule.tileToPixel(selTile.x, selTile.y).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
      const py = MapModule.tileToPixel(selTile.x, selTile.y).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H;
      if (selImg) {
        drawTileImage(ctx, px, py, selImg);
      }
    }

    // 绘制模板预览（30% 半透明）
    if (previewTemplate && previewPos && tiles) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      for (const t of previewTemplate.tiles) {
        const tx = previewPos.x + t.x;
        const ty = previewPos.y + t.y;
        if (!MapModule.assert(tx, ty)) continue;
        const px = MapModule.tileToPixel(tx, ty).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
        const py = MapModule.tileToPixel(tx, ty).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H;
        const img0 = MapModule.getLayerImage(t.layer0);
        if (img0 >= 0 && img0 < tiles.length) drawTileImage(ctx, px, py, tiles[img0]);
        const img1 = MapModule.getLayerImage(t.layer1);
        if (img1 > 0 && img1 - 1 < tiles.length) drawTileImage(ctx, px, py, tiles[img1 - 1]);
        if (t.barrier) drawTileImage(ctx, px, py, barrierImg);
      }
      ctx.restore();
    }

    // 拷贝到主 Canvas
    mapCtx.drawImage(backCanvas, 0, 0);
  }

  // 绘制小地图
  function renderMiniMap(miniTiles) {
    if (!miniCtx || !miniTiles) return;
    const w = MapModule.MAP_WIDTH;
    const h = MapModule.MAP_HEIGHT;
    const imgData = miniCtx.createImageData(w, h);
    const pixels = imgData.data;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const imgIdx = MapModule.getTileImage(x, y, 0);
        const px = (y * w + x) * 4;
        if (imgIdx >= 0 && imgIdx < miniTiles.length) {
          const mini = miniTiles[imgIdx];
          pixels[px + 0] = mini.data[0];
          pixels[px + 1] = mini.data[1];
          pixels[px + 2] = mini.data[2];
          pixels[px + 3] = 255;
        } else {
          pixels[px + 0] = 0;
          pixels[px + 1] = 0;
          pixels[px + 2] = 0;
          pixels[px + 3] = 255;
        }
      }
    }
    miniCtx.putImageData(imgData, 0, 0);
  }

  // 在小地图上绘制相机框
  function drawMiniMapCamera(cameraX, cameraY, viewW, viewH) {
    if (!miniCtx) return;
    // 保存当前图像
    const current = miniCtx.getImageData(0, 0, 128, 128);
    // 绘制矩形框
    miniCtx.strokeStyle = '#00ff00';
    miniCtx.lineWidth = 1;
    miniCtx.strokeRect(cameraX, cameraY, viewW, viewH);
    // 稍后恢复？实际上我们需要重新绘制小地图来更新
    // 这个函数在每次小地图重绘时调用
  }

  return {
    init,
    resize,
    renderMap,
    renderMiniMap,
    drawMiniMapCamera,
  };
})();
