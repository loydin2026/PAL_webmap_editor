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

  // 将模板自带的 base64 图块数据解码为 ImageData
  function base64ToImageData(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const w = bytes[0] | (bytes[1] << 8);
    const h = bytes[2] | (bytes[3] << 8);
    const data = new Uint8ClampedArray(bytes.slice(4));
    return new ImageData(data, w, h);
  }

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
  function drawTileImage(ctx, x, y, source, zoom) {
    if (!source) return;
    zoom = zoom || 1;
    let temp;
    if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
      temp = source;
    } else {
      // ImageData：使用临时 Canvas 缓存
      temp = source._tempCanvas;
      if (!temp) {
        temp = document.createElement('canvas');
        temp.width = source.width;
        temp.height = source.height;
        const tctx = temp.getContext('2d');
        tctx.imageSmoothingEnabled = false;
        tctx.putImageData(source, 0, 0);
        source._tempCanvas = temp;
      }
    }
    const w = (temp.width || temp.naturalWidth || 64) * zoom;
    const h = (temp.height || temp.naturalHeight || 30) * zoom;
    ctx.drawImage(temp, x, y, w, h);
  }

  // 按高度阈值重画单个图块（用于人物对象遮挡）
  // 参考 MapEx_ReDrawTiles / Map_DrawTile 实现：只有图块高度 >= 阈值时才绘制
  function drawTileWithThreshold(ctx, cameraX, cameraY, zoom, tiles, tx, ty, showL0, showL1, h0Threshold, h1Threshold) {
    if (!MapModule.assert(tx, ty)) return;

    const px = MapModule.tileToPixel(tx, ty).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
    const py = MapModule.tileToPixel(tx, ty).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H;

    // 检查是否在视口内
    if (px * zoom + TILE_W * zoom < 0 || py * zoom + TILE_H * zoom < 0 || px * zoom >= ctx.canvas.width || py * zoom >= ctx.canvas.height) return;

    const word0 = MapModule.getTile(tx, ty, 0);
    const word1 = MapModule.getTile(tx, ty, 1);

    const h0 = MapModule.getLayerHeight(word0);
    const h1 = MapModule.getLayerHeight(word1);

    if (showL0 && h0 >= h0Threshold) {
      const img0 = MapModule.getLayerImage(word0);
      if (img0 >= 0 && img0 < tiles.length) {
        drawTileImage(ctx, px * zoom, py * zoom, tiles[img0], zoom);
      }
    }

    if (showL1 && h1 >= h1Threshold) {
      const img1 = MapModule.getLayerImage(word1);
      if (img1 > 0 && img1 - 1 < tiles.length) {
        drawTileImage(ctx, px * zoom, py * zoom, tiles[img1 - 1], zoom);
      }
    }
  }

  // 绘制地图
  // cameraX, cameraY: 视口左上角的 Tile 坐标
  // tiles: GOP 图块数组 (ImageData 数组)
  // showBarrier: 是否显示障碍标记
  // showObject: 是否显示人物对象
  // objectImg: 人物对象的 ImageData
  // mouseTile: {x, y} 鼠标悬停的 Tile
  // selTiles: Array<{x, y}> 选中的 Tile 列表
  // events: Array<Event> 事件对象列表
  function renderMap(cameraX, cameraY, zoom, tiles, showL0, showL1, showBarrier, showObject, objectImg,
                     mouseTile, selTiles, barrierImg, mouseImg, selImg,
                     previewTemplate, previewPos, showEvent, eventImg, events, selectedEventId, showGrid, showEventChar, getCharImage, loadCharImage) {
    const ctx = backCtx;
    const cw = backCanvas.width;
    const ch = backCanvas.height;

    // 清屏为黑色
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cw, ch);

    // 计算可见范围（根据缩放调整）
    const viewW = Math.ceil(cw / zoom / 32) + 4;
    const viewH = Math.ceil(ch / zoom / 32) + 4;

    const primarySel = (selTiles && selTiles.length > 0) ? selTiles[0] : null;

    // 从 camera 位置开始绘制，先 y 后 x（同原代码）
    for (let ly = 0; ly < viewH; ly++) {
      for (let lx = 0; lx < viewW; lx++) {
        const tx = cameraX + lx;
        const ty = cameraY + ly;
        if (!MapModule.assert(tx, ty)) continue;

        const px = MapModule.tileToPixel(tx, ty).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
        const py = MapModule.tileToPixel(tx, ty).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H;

        // 只绘制在视口内的（使用缩放后的坐标判断）
        if (px * zoom + TILE_W * zoom < 0 || py * zoom + TILE_H * zoom < 0 || px * zoom >= cw || py * zoom >= ch) continue;

        // Layer0
        if (showL0) {
          const img0 = MapModule.getTileImage(tx, ty, 0);
          if (img0 >= 0 && img0 < tiles.length) {
            drawTileImage(ctx, px * zoom, py * zoom, tiles[img0], zoom);
          }
        }

        // Layer1
        if (showL1) {
          const img1 = MapModule.getTileImage(tx, ty, 1);
          if (img1 > 0 && img1 - 1 < tiles.length) {
            drawTileImage(ctx, px * zoom, py * zoom, tiles[img1 - 1], zoom);
          }
        }
      }
    }

    // 绘制人物对象：先画人物覆盖所有图块，然后重画周围三列（使用高度阈值实现遮挡）
    if (showObject && primarySel && MapModule.assert(primarySel.x, primarySel.y)) {
      const objPx = MapModule.tileToPixel(primarySel.x, primarySel.y).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
      const objPy = MapModule.tileToPixel(primarySel.x, primarySel.y).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H - (110 - 32);
      if (objectImg) {
        drawTileImage(ctx, objPx * zoom, objPy * zoom, objectImg, zoom);
      }

      // 重画人物周围的Tile，使用高度阈值：只有高度>=阈值的图块才覆盖人物
      // 参考 MapEx_ReDrawTiles 实现
      // 中心列：阈值 1,3,5,7
      for (let i = 0; i < 4; i++) {
        const tx = primarySel.x;
        const ty = primarySel.y - i;
        const threshold = i * 2 + 1;
        drawTileWithThreshold(ctx, cameraX, cameraY, zoom, tiles, tx, ty, showL0, showL1, threshold, threshold);
      }

      // 西列（左）：阈值 2,4,6,8
      let wx, wy;
      if (primarySel.x % 2 === 0) {
        wx = primarySel.x - 1; wy = primarySel.y - 1;
      } else {
        wx = primarySel.x - 1; wy = primarySel.y;
      }
      for (let i = 0; i < 4; i++) {
        const tx = wx;
        const ty = wy - i;
        const threshold = i * 2 + 2;
        drawTileWithThreshold(ctx, cameraX, cameraY, zoom, tiles, tx, ty, showL0, showL1, threshold, threshold);
      }

      // 北列（右）：阈值 2,4,6,8
      let nx, ny;
      if (primarySel.x % 2 === 0) {
        nx = primarySel.x + 1; ny = primarySel.y - 1;
      } else {
        nx = primarySel.x + 1; ny = primarySel.y;
      }
      for (let i = 0; i < 4; i++) {
        const tx = nx;
        const ty = ny - i;
        const threshold = i * 2 + 2;
        drawTileWithThreshold(ctx, cameraX, cameraY, zoom, tiles, tx, ty, showL0, showL1, threshold, threshold);
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
              drawTileImage(ctx, px * zoom, py * zoom, barrierImg, zoom);
            }
          }
        }
      }
    }

    // 绘制事件标记
    if (showEvent && events && events.length > 0) {
      for (const ev of events) {
        if (!MapModule.assert(ev.x, ev.y)) continue;
        const px = MapModule.tileToPixel(ev.x, ev.y).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
        const py = MapModule.tileToPixel(ev.x, ev.y).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H;
        if (px * zoom + TILE_W * zoom < 0 || py * zoom + TILE_H * zoom < 0 || px * zoom >= cw || py * zoom >= ch) continue;

        // 事件标记图片（选中时闪烁动画，未选中时固定不透明）
        if (eventImg) {
          const isSelected = ev.id === selectedEventId;
          ctx.save();
          if (isSelected) {
            const pulse = (Math.sin(Date.now() / 300) + 1) / 2;
            ctx.globalAlpha = pulse;
          }
          drawTileImage(ctx, px * zoom, py * zoom, eventImg, zoom);
          ctx.restore();
        }

        // 事件人物图像（缩放 200%，底对齐，direction * frames + currFrame + 1 = 图片后缀）
        if (showEventChar && ev.image > 0) {
          const dir = Math.max(0, ev.direction);
          let suffix;
          // 决定有效帧数：frames > 0 时用 frames，否则 framesAuto > 0 时用 framesAuto
          const effectiveFrames = ev.frames > 0 ? ev.frames : (ev.framesAuto > 0 ? ev.framesAuto : 0);
          if (effectiveFrames <= 0) {
            // 无帧动画时固定显示第 1 帧
            suffix = 1;
          } else {
            const frame = Math.max(0, Math.min(ev.currFrame || 0, effectiveFrames - 1));
            suffix = dir * effectiveFrames + frame + 1;
          }
          let charImg = getCharImage ? getCharImage(ev.image, suffix) : null;
          if (!charImg && loadCharImage) {
            loadCharImage(ev.image, suffix);
          }
          if (charImg && charImg.naturalWidth > 0) {
            const charW = charImg.naturalWidth * zoom * 2;
            const charH = charImg.naturalHeight * zoom * 2;
            const charX = px * zoom + TILE_HALF_W * zoom - charW / 2;
            const charY = py * zoom + TILE_H * zoom - charH;
            ctx.drawImage(charImg, charX, charY, charW, charH);
          }
        }

        // 事件 ID 标签
        const cx = px * zoom + TILE_HALF_W * zoom;
        const cy = py * zoom + TILE_HALF_H * zoom;
        ctx.fillStyle = ev.id === selectedEventId ? '#2ecc71' : '#ffffff';
        ctx.font = 'bold 14px Microsoft YaHei';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(ev.id.toString(), cx, cy);

        // 绘制移动路径（从 autoScript 解析，形成闭环）
        if (typeof Editor !== 'undefined' && ev.autoScript > 0) {
          const path = Editor.getEventMovePath(ev.id);
          if (path && path.length > 0) {
            ctx.save();
            ctx.strokeStyle = ev.id === selectedEventId ? '#2ecc71' : '#ff9900';
            ctx.lineWidth = 2 * zoom;
            ctx.setLineDash([6 * zoom, 4 * zoom]);
            ctx.beginPath();
            // 从第一个路径点开始，依次连接所有路径点
            let first = true;
            for (const pt of path) {
              if (MapModule.assert(pt.x, pt.y)) {
                const tpx = MapModule.tileToPixel(pt.x, pt.y).x - MapModule.tileToPixel(cameraX, cameraY).x;
                const tpy = MapModule.tileToPixel(pt.x, pt.y).y - MapModule.tileToPixel(cameraX, cameraY).y;
                if (first) {
                  ctx.moveTo(tpx * zoom, tpy * zoom);
                  first = false;
                } else {
                  ctx.lineTo(tpx * zoom, tpy * zoom);
                }
                // 绘制路径点标记
                ctx.fillStyle = ev.id === selectedEventId ? '#2ecc71' : '#ff9900';
                ctx.fillRect(tpx * zoom - 3 * zoom, tpy * zoom - 3 * zoom, 6 * zoom, 6 * zoom);
              }
            }
            // 闭环：最后一个路径点连回第一个
            if (!first && path.length > 1) {
              const firstPt = path[0];
              if (MapModule.assert(firstPt.x, firstPt.y)) {
                const fpx = MapModule.tileToPixel(firstPt.x, firstPt.y).x - MapModule.tileToPixel(cameraX, cameraY).x;
                const fpy = MapModule.tileToPixel(firstPt.x, firstPt.y).y - MapModule.tileToPixel(cameraX, cameraY).y;
                ctx.lineTo(fpx * zoom, fpy * zoom);
              }
            }
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    }

    // 绘制鼠标悬停标记（蓝色菱形边框，与选中统一）
    if (mouseTile && MapModule.assert(mouseTile.x, mouseTile.y)) {
      const px = MapModule.tileToPixel(mouseTile.x, mouseTile.y).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
      const py = MapModule.tileToPixel(mouseTile.x, mouseTile.y).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H;
      const cx = px * zoom + TILE_HALF_W * zoom;
      const cy = py * zoom + TILE_HALF_H * zoom;
      const hw = TILE_HALF_W * zoom;
      const hh = TILE_HALF_H * zoom;
      ctx.beginPath();
      ctx.moveTo(cx, cy - hh);
      ctx.lineTo(cx + hw, cy);
      ctx.lineTo(cx, cy + hh);
      ctx.lineTo(cx - hw, cy);
      ctx.closePath();
      ctx.strokeStyle = 'rgba(100, 150, 255, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 绘制选中标记（所有选中的 tile，统一蓝色菱形边框）
    if (selTiles && selTiles.length > 0) {
      for (const st of selTiles) {
        if (MapModule.assert(st.x, st.y)) {
          const px = MapModule.tileToPixel(st.x, st.y).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
          const py = MapModule.tileToPixel(st.x, st.y).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H;
          const cx = px * zoom + TILE_HALF_W * zoom;
          const cy = py * zoom + TILE_HALF_H * zoom;
          const hw = TILE_HALF_W * zoom;
          const hh = TILE_HALF_H * zoom;
          ctx.beginPath();
          ctx.moveTo(cx, cy - hh);
          ctx.lineTo(cx + hw, cy);
          ctx.lineTo(cx, cy + hh);
          ctx.lineTo(cx - hw, cy);
          ctx.closePath();
          ctx.strokeStyle = 'rgba(100, 150, 255, 0.9)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    // 绘制模板预览（30% 半透明）
    if (previewTemplate && previewPos && tiles) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      const baseParity = (previewTemplate.baseParity !== undefined ? previewTemplate.baseParity : 0) & 1;
      const destParity = previewPos.x & 1;
      const centerX = Math.floor(previewTemplate.w / 2);
      const centerY = Math.floor(previewTemplate.h / 2);
      const effectiveDestParity = (destParity - (centerX & 1) + 2) & 1;

      // 计算中心 tile 会被补偿多少，预偏移所有 tile 使中心 tile 精确落在鼠标位置
      let centerComp = 0;
      if (baseParity !== effectiveDestParity) {
        const centerAbsParity = (baseParity + centerX) & 1;
        if (centerAbsParity === effectiveDestParity) {
          centerComp = effectiveDestParity - baseParity;
        }
      }

      for (const t of previewTemplate.tiles) {
        let tx = previewPos.x + t.x - centerX;
        let ty = previewPos.y + t.y - centerY - centerComp;
        if (baseParity !== effectiveDestParity) {
          const absParity = (baseParity + t.x) & 1;
          if (absParity === effectiveDestParity) {
            ty += (effectiveDestParity - baseParity);
          }
        }
        if (!MapModule.assert(tx, ty)) continue;
        const px = MapModule.tileToPixel(tx, ty).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
        const py = MapModule.tileToPixel(tx, ty).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H;
        if (t.layer0 >= 0) {
          let img0 = null;
          if (previewTemplate.tileImages && previewTemplate.tileImages[t.layer0]) {
            img0 = base64ToImageData(previewTemplate.tileImages[t.layer0]);
          } else if (t.layer0 >= 0 && t.layer0 < tiles.length) {
            img0 = tiles[t.layer0];
          }
          if (img0) drawTileImage(ctx, px * zoom, py * zoom, img0, zoom);
        }
        if (t.layer1 > 0) {
          const i1 = t.layer1 - 1;
          let img1 = null;
          if (previewTemplate.tileImages && previewTemplate.tileImages[i1]) {
            img1 = base64ToImageData(previewTemplate.tileImages[i1]);
          } else if (i1 >= 0 && i1 < tiles.length) {
            img1 = tiles[i1];
          }
          if (img1) drawTileImage(ctx, px * zoom, py * zoom, img1, zoom);
        }
        if (t.barrier) drawTileImage(ctx, px * zoom, py * zoom, barrierImg, zoom);
      }
      ctx.restore();
    }

    // 绘制网格
    if (showGrid) {
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.35)';
      ctx.lineWidth = 1;
      for (let ly = 0; ly < viewH; ly++) {
        for (let lx = 0; lx < viewW; lx++) {
          const tx = cameraX + lx;
          const ty = cameraY + ly;
          if (!MapModule.assert(tx, ty)) continue;
          const px = MapModule.tileToPixel(tx, ty).x - MapModule.tileToPixel(cameraX, cameraY).x - TILE_HALF_W;
          const py = MapModule.tileToPixel(tx, ty).y - MapModule.tileToPixel(cameraX, cameraY).y - TILE_HALF_H;
          if (px * zoom + TILE_W * zoom < 0 || py * zoom + TILE_H * zoom < 0 || px * zoom >= cw || py * zoom >= ch) continue;

          const cx = px * zoom + TILE_HALF_W * zoom;
          const cy = py * zoom + TILE_HALF_H * zoom;
          const hw = TILE_HALF_W * zoom;
          const hh = TILE_HALF_H * zoom;

          ctx.beginPath();
          ctx.moveTo(cx, cy - hh);
          ctx.lineTo(cx + hw, cy);
          ctx.lineTo(cx, cy + hh);
          ctx.lineTo(cx - hw, cy);
          ctx.closePath();
          ctx.stroke();

          // 在每个格子中心绘制坐标 (x,y)
          const coordText = `(${tx},${ty})`;
          ctx.save();
          const fontSize = Math.max(4, Math.min(14, 10 * zoom));
          ctx.font = `bold ${fontSize}px Microsoft YaHei, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
          ctx.lineWidth = 2;
          ctx.strokeText(coordText, cx, cy);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          ctx.fillText(coordText, cx, cy);
          ctx.restore();
        }
      }
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
