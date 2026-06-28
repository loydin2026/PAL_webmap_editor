const TemplateEditor = (function() {
  // 图块数据编码/解码辅助函数
  function imageDataToBase64(imageData) {
    const w = imageData.width;
    const h = imageData.height;
    const data = new Uint8Array(imageData.data);
    const header = new Uint8Array(4);
    header[0] = w & 0xFF;
    header[1] = (w >> 8) & 0xFF;
    header[2] = h & 0xFF;
    header[3] = (h >> 8) & 0xFF;
    const combined = new Uint8Array(header.length + data.length);
    combined.set(header);
    combined.set(data, header.length);
    let binary = '';
    for (let i = 0; i < combined.length; i++) {
      binary += String.fromCharCode(combined[i]);
    }
    return btoa(binary);
  }

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

  let isOpen = false;
  let canvas = null;
  let ctx = null;
  let isMouseDown = false;

  // 模板数据: key="x,y" -> {layer0, layer1, barrier}
  let data = {};
  let minX = 0, maxX = 1, minY = 0, maxY = 1;
  let baseParity = 0; // 模板基点在地图中的奇偶性（0=偶数列, 1=奇数列）

  let tTool = 'pen'; // pen, erase, barrier
  let tLayer = 0;
  let selectedTile = -1;
  let showL0 = true;
  let showL1 = true;

  const undoStack = [];
  const redoStack = [];
  let savedTemplates = [];
  let selIdx = -1;

  let tilePositions = []; // {tx, ty, px, py} 渲染时记录每个 tile 的像素位置
  let editMode = false;
  let editIdx = -1;
  let mouseTileX = -1;
  let mouseTileY = -1;
  let selTileX = -1;
  let selTileY = -1;

  // 模板编辑器专用的图块图像缓存，优先使用模板自带的 tileImages，避免 GOP 切换后错乱
  let editorTileImages = null; // {id: ImageData}

  function init() {
    canvas = document.getElementById('template-canvas');
    ctx = canvas.getContext('2d');
    bindEvents();
    resizeCanvas();
    window.addEventListener('resize', () => {
      if (isOpen) resizeCanvas();
    });
  }

  function resizeCanvas() {
    const wrap = canvas ? canvas.parentElement : null;
    if (!wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    // 只在尺寸变化时重置，避免闪烁
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      if (isOpen) render();
    }
  }

  function bindEvents() {
    document.querySelectorAll('.t-tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.t-tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tTool = btn.dataset.tmode;
        // 更新提示文本
        const hint = document.getElementById('template-hint');
        if (hint) {
          if (tTool === 'select') hint.textContent = '💡 点击图块查看/编辑属性';
          else if (tTool === 'pen') hint.textContent = '💡 左键绘制 · 右键删除 · 外圈可自动扩展';
          else if (tTool === 'erase') hint.textContent = '💡 左键擦除当前图层 · 外圈可自动扩展';
          else if (tTool === 'barrier') hint.textContent = '💡 左键切换障碍标记';
        }
      });
    });
    document.querySelectorAll('.t-layer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.t-layer-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tLayer = parseInt(btn.dataset.tlayer);
      });
    });
    document.getElementById('t-btn-undo').addEventListener('click', undo);
    document.getElementById('t-btn-redo').addEventListener('click', redo);
    document.getElementById('t-btn-save').addEventListener('click', saveTemplate);
    document.getElementById('btn-close-template').addEventListener('click', close);
    canvas.addEventListener('mousedown', e => { isMouseDown = true; selTileX = mouseTileX; selTileY = mouseTileY; onMouse(e); });
    canvas.addEventListener('mousemove', e => { onMouse(e); });
    canvas.addEventListener('mouseup', () => { isMouseDown = false; });
    canvas.addEventListener('mouseleave', () => { isMouseDown = false; mouseTileX = -1; mouseTileY = -1; });
    document.getElementById('t-btn-view-l0').addEventListener('click', () => {
      const btn = document.getElementById('t-btn-view-l0');
      btn.classList.toggle('active');
      showL0 = btn.classList.contains('active');
      render();
    });
    document.getElementById('t-btn-view-l1').addEventListener('click', () => {
      const btn = document.getElementById('t-btn-view-l1');
      btn.classList.toggle('active');
      showL1 = btn.classList.contains('active');
      render();
    });

    // 高度输入框编辑
    const h0Input = document.getElementById('t-l0-height');
    const h1Input = document.getElementById('t-l1-height');
    if (h0Input) {
      h0Input.addEventListener('change', () => {
        if (selTileX < 0 || selTileY < 0) return;
        const k = selTileX + ',' + selTileY;
        const h = parseInt(h0Input.value) || 0;
        if (!data[k]) data[k] = { layer0: -1, height0: 0, layer1: 0, height1: 0, barrier: false };
        data[k].height0 = Math.max(0, Math.min(15, h));
        render(); updateInfo();
      });
    }
    if (h1Input) {
      h1Input.addEventListener('change', () => {
        if (selTileX < 0 || selTileY < 0) return;
        const k = selTileX + ',' + selTileY;
        const h = parseInt(h1Input.value) || 0;
        if (!data[k]) data[k] = { layer0: -1, height0: 0, layer1: 0, height1: 0, barrier: false };
        data[k].height1 = Math.max(0, Math.min(15, h));
        render(); updateInfo();
      });
    }
  }

  function open(targetIdx = -1) {
    isOpen = true;
    editMode = targetIdx >= 0;
    editIdx = targetIdx;
    document.getElementById('template-modal').classList.remove('hidden');
    editorTileImages = null;

    if (editMode && editIdx >= 0 && editIdx < savedTemplates.length) {
      // 编辑现有模板
      const tpl = savedTemplates[editIdx];
      document.getElementById('template-name').value = tpl.name;
      data = {};
      baseParity = tpl.baseParity || 0;
      minX = 0; maxX = tpl.w - 1; minY = 0; maxY = tpl.h - 1;
      for (const t of tpl.tiles) {
        data[t.x + ',' + t.y] = {
          layer0: t.layer0,
          height0: t.height0 || 0,
          layer1: t.layer1,
          height1: t.height1 || 0,
          barrier: t.barrier
        };
      }
      // 将模板自带的 tileImages 转换为 ImageData 缓存，避免 GOP 切换后图块错乱
      if (tpl.tileImages) {
        editorTileImages = {};
        for (const [id, base64] of Object.entries(tpl.tileImages)) {
          editorTileImages[id] = base64ToImageData(base64);
        }
      }
    } else {
      // 新建模板
      data = {}; baseParity = 0; minX = 0; maxX = 1; minY = 0; maxY = 1;
      undoStack.length = 0; redoStack.length = 0;
      document.getElementById('template-name').value = '模板' + (savedTemplates.length + 1);
    }
    selTileX = -1; selTileY = -1;
    mouseTileX = -1; mouseTileY = -1;

    resizeCanvas();
    buildTileGrid();
    render(); updateInfo();
  }

  function buildTileGrid() {
    const grid = document.getElementById('template-tile-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const gopTiles = UI.getTiles();
    if (!gopTiles) return;
    for (let i = 0; i < gopTiles.length; i++) {
      const div = document.createElement('div');
      div.className = 'tile-thumb' + (i === selectedTile ? ' selected' : '');
      div.dataset.id = i;
      const c = document.createElement('canvas');
      // 优先使用模板自带的图块图像，避免 GOP 切换后错乱
      const tileImg = editorTileImages && editorTileImages[i] ? editorTileImages[i] : gopTiles[i];
      c.width = tileImg.width; c.height = tileImg.height;
      c.getContext('2d').putImageData(tileImg, 0, 0);
      div.appendChild(c);
      const idLabel = document.createElement('span');
      idLabel.className = 'tile-id'; idLabel.textContent = i;
      div.appendChild(idLabel);
      div.addEventListener('click', () => {
        document.querySelectorAll('#template-tile-grid .tile-thumb').forEach(t => t.classList.remove('selected'));
        div.classList.add('selected');
        selectedTile = i;
        document.getElementById('template-cur-tile').textContent = i;
      });
      grid.appendChild(div);
    }
  }
  function close() { isOpen = false; editMode = false; editIdx = -1; document.getElementById('template-modal').classList.add('hidden'); }
  function isOpened() { return isOpen; }

  function getCamera() {
    const dminX = minX - 1 + baseParity, dminY = minY - 1, dmaxX = maxX + 1 + baseParity, dmaxY = maxY + 1;
    const p1 = MapModule.tileToPixel(dminX, dminY);
    const p4 = MapModule.tileToPixel(dmaxX, dmaxY);
    const cw = p4.x - p1.x + 64, ch = p4.y - p1.y + 30;
    return {
      cx: dminX, cy: dminY,
      ox: (canvas.width - cw) / 2, oy: (canvas.height - ch) / 2,
      cw, ch
    };
  }

  function onMouse(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // 使用 tilePositions 做菱形检测，找到鼠标所在的 tile
    let tile = null;
    let bestDist = Infinity;
    for (const t of tilePositions) {
      const dx = Math.abs(mx - t.px);
      const dy = Math.abs(my - t.py);
      const dist = dx / 32 + dy / 15;
      if (dist <= 1.0) {
        tile = { x: t.tx, y: t.ty };
        break;
      }
      if (dist < bestDist) {
        bestDist = dist;
        tile = { x: t.tx, y: t.ty };
      }
    }

    if (!tile) {
      document.getElementById('template-sel-tile').textContent = '-, -';
      mouseTileX = -1; mouseTileY = -1;
      return;
    }

    mouseTileX = tile.x; mouseTileY = tile.y;
    document.getElementById('template-sel-tile').textContent = tile.x + ', ' + tile.y;

    if (isMouseDown && e.button === 0) {
      selTileX = tile.x; selTileY = tile.y;
      if (tTool === 'select') {
        // 选择工具：只更新选中状态，不修改数据
        render(); updateInfo();
      } else {
        const key = tile.x + ',' + tile.y;
        const oldV = data[key] ? { ...data[key] } : { layer0: -1, height0: 0, layer1: 0, height1: 0, barrier: false };
        apply(tile.x, tile.y);
        const newV = data[key] ? { ...data[key] } : { layer0: -1, height0: 0, layer1: 0, height1: 0, barrier: false };
        if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
          undoStack.push({ x: tile.x, y: tile.y, oldV, newV });
          redoStack.length = 0;
        }
        render(); updateInfo();
      }
    }
  }

  function apply(tx, ty) {
    if (tx < minX - 1 || tx > maxX + 1 || ty < minY - 1 || ty > maxY + 1) return;
    if (tx < minX) minX = tx; if (tx > maxX) maxX = tx;
    if (ty < minY) minY = ty; if (ty > maxY) maxY = ty;
    const k = tx + ',' + ty;
    if (!data[k]) data[k] = { layer0: -1, height0: 0, layer1: 0, height1: 0, barrier: false };
    if (tTool === 'pen') {
      if (selectedTile >= 0) {
        if (tLayer === 0) {
          data[k].layer0 = selectedTile;
          if (data[k].height0 === undefined) data[k].height0 = 0;
        } else {
          data[k].layer1 = selectedTile + 1;
          if (data[k].height1 === undefined) data[k].height1 = 0;
        }
      }
    } else if (tTool === 'erase') {
      if (tLayer === 0) data[k].layer0 = -1;
      else data[k].layer1 = 0;
      // 擦除后如果所有数据都是默认未设置，删除该 tile 的 key（完全透明）
      if (data[k].layer0 < 0 && data[k].layer1 <= 0 && !data[k].barrier) {
        delete data[k];
      }
    } else if (tTool === 'barrier') {
      data[k].barrier = !data[k].barrier;
      // 如果 barrier 被清除且所有数据为默认未设置，删除 key
      if (!data[k].barrier && data[k].layer0 < 0 && data[k].layer1 <= 0) {
        delete data[k];
      }
    }
    recalcBounds();
  }

  function recalcBounds() {
    const keys = Object.keys(data);
    if (keys.length === 0) {
      // 没有任何数据，恢复默认 2x2 边界
      minX = 0; maxX = 1; minY = 0; maxY = 1;
      baseParity = 0;
      return;
    }
    let newMinX = Infinity, newMaxX = -Infinity, newMinY = Infinity, newMaxY = -Infinity;
    for (const k of keys) {
      const [x, y] = k.split(',').map(Number);
      newMinX = Math.min(newMinX, x);
      newMaxX = Math.max(newMaxX, x);
      newMinY = Math.min(newMinY, y);
      newMaxY = Math.max(newMaxY, y);
    }
    minX = newMinX; maxX = newMaxX; minY = newMinY; maxY = newMaxY;
    // baseParity 是模板的固有属性，编辑过程中保持不变（只在 open 时从模板加载）
  }

  function undo() {
    if (undoStack.length === 0) return;
    const a = undoStack.pop();
    const k = a.x + ',' + a.y;
    if (a.oldV.layer0 < 0 && a.oldV.layer1 <= 0 && !a.oldV.barrier) delete data[k];
    else data[k] = { ...a.oldV };
    recalcBounds();
    redoStack.push(a); render(); updateInfo();
  }
  function redo() {
    if (redoStack.length === 0) return;
    const a = redoStack.pop();
    const k = a.x + ',' + a.y;
    if (a.newV.layer0 < 0 && a.newV.layer1 <= 0 && !a.newV.barrier) delete data[k];
    else data[k] = { ...a.newV };
    recalcBounds();
    undoStack.push(a); render(); updateInfo();
  }

  function render() {
    if (!ctx) return;
    tilePositions = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0c0c10';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const canvasW = canvas.width;
    const canvasH = canvas.height;

    // 计算数据中心的像素坐标，让模板自动居中
    let dataMinX = Infinity, dataMaxX = -Infinity, dataMinY = Infinity, dataMaxY = -Infinity;
    for (const k of Object.keys(data)) {
      const [x, y] = k.split(',').map(Number);
      dataMinX = Math.min(dataMinX, x);
      dataMaxX = Math.max(dataMaxX, x);
      dataMinY = Math.min(dataMinY, y);
      dataMaxY = Math.max(dataMaxY, y);
    }
    let midX = 0, midY = 0;
    if (Object.keys(data).length > 0) {
      midX = Math.round((dataMinX + dataMaxX) / 2);
      midY = Math.round((dataMinY + dataMaxY) / 2);
    }
    const midPixel = MapModule.tileToPixel(midX + baseParity, midY);
    const offsetX = canvasW / 2 - midPixel.x;
    const offsetY = canvasH / 2 - midPixel.y;

    const gopTiles = UI.getTiles();

    // 计算铺满画布所需的 tile 范围
    const cols = Math.ceil(canvasW / 32) + 6;
    const rows = Math.ceil(canvasH / 32) + 6;
    const startX = midX - Math.floor(cols / 2);
    const endX   = midX + Math.floor(cols / 2);
    const startY = midY - Math.floor(rows / 2);
    const endY   = midY + Math.floor(rows / 2);

    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        const actualX = tx + baseParity;
        const p = MapModule.tileToPixel(actualX, ty);
        const px = offsetX + p.x;
        const py = offsetY + p.y;

        // 视口裁剪
        if (px + 32 < 0 || px - 32 > canvasW || py + 16 < 0 || py - 16 > canvasH) continue;

        tilePositions.push({ tx, ty, px, py });

        const k = tx + ',' + ty;
        const t = data[k];
        const inR = tx >= minX && tx <= maxX && ty >= minY && ty <= maxY;
        const isOrigin = tx === 0 && ty === 0;

        // 菱形网格线（仅描边，无填充），只显示网格线，不显示边界提示
        drawDiamond(ctx, px, py, 64, 32, 'rgba(255,255,255,0.15)', null);

        // 绘制图块数据
        if (t && (gopTiles || editorTileImages)) {
          if (showL0 && t.layer0 >= 0) {
            const i0 = t.layer0;
            const img0 = editorTileImages && editorTileImages[i0] ? editorTileImages[i0]
              : (gopTiles && i0 >= 0 && i0 < gopTiles.length ? gopTiles[i0] : null);
            if (img0) drawImg(ctx, px - 32, py - 16, img0);
          }
          if (showL1 && t.layer1 > 0) {
            const i1 = t.layer1 - 1;
            const img1 = editorTileImages && editorTileImages[i1] ? editorTileImages[i1]
              : (gopTiles && i1 >= 0 && i1 < gopTiles.length ? gopTiles[i1] : null);
            if (img1) drawImg(ctx, px - 32, py - 16, img1);
          }
          if (t.barrier) drawImg(ctx, px - 32, py - 16, Editor.barrierImg);
        }
      }
    }

    // 鼠标悬停提示（绿色菱形）
    if (mouseTileX >= 0 && mouseTileY >= 0) {
      const p = MapModule.tileToPixel(mouseTileX + baseParity, mouseTileY);
      const px = offsetX + p.x;
      const py = offsetY + p.y;
      drawDiamond(ctx, px, py, 64, 32, 'rgba(0, 255, 0, 0.75)', 'rgba(0, 255, 0, 0.25)');
    }

    // 选中提示（黄色菱形）
    if (selTileX >= 0 && selTileY >= 0) {
      const p = MapModule.tileToPixel(selTileX + baseParity, selTileY);
      const px = offsetX + p.x;
      const py = offsetY + p.y;
      drawDiamond(ctx, px, py, 64, 32, 'rgba(255, 220, 0, 0.8)', 'rgba(255, 220, 0, 0.2)');
    }
  }

  function drawDiamond(c, cx, cy, w, h, strokeColor, fillColor) {
    c.beginPath();
    c.moveTo(cx, cy - h / 2);      // 上
    c.lineTo(cx + w / 2, cy);      // 右
    c.lineTo(cx, cy + h / 2);      // 下
    c.lineTo(cx - w / 2, cy);      // 左
    c.closePath();
    if (fillColor) {
      c.fillStyle = fillColor;
      c.fill();
    }
    if (strokeColor) {
      c.strokeStyle = strokeColor;
      c.lineWidth = 1;
      c.stroke();
    }
  }

  function drawImg(c, x, y, source) {
    if (!source) return;
    if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
      c.drawImage(source, x, y);
    } else {
      // ImageData
      let tmp = source._tempCanvas;
      if (!tmp) {
        tmp = document.createElement('canvas');
        tmp.width = source.width; tmp.height = source.height;
        tmp.getContext('2d').putImageData(source, 0, 0);
        source._tempCanvas = tmp;
      }
      c.drawImage(tmp, x, y);
    }
  }

  function updateInfo() {
    document.getElementById('template-grid-size').textContent = (maxX - minX + 1) + '×' + (maxY - minY + 1);
    const selEl = document.getElementById('template-sel-tile');
    const l0IdEl = document.getElementById('t-l0-id');
    const l1IdEl = document.getElementById('t-l1-id');
    const h0Input = document.getElementById('t-l0-height');
    const h1Input = document.getElementById('t-l1-height');
    if (selTileX >= 0 && selTileY >= 0) {
      selEl.textContent = selTileX + ', ' + selTileY;
      const k = selTileX + ',' + selTileY;
      const t = data[k];
      if (t) {
        if (l0IdEl) l0IdEl.textContent = t.layer0 >= 0 ? t.layer0 : '-';
        if (l1IdEl) l1IdEl.textContent = t.layer1 > 0 ? (t.layer1 - 1) : '-';
        if (h0Input) h0Input.value = t.height0 || 0;
        if (h1Input) h1Input.value = t.height1 || 0;
      } else {
        if (l0IdEl) l0IdEl.textContent = '-';
        if (l1IdEl) l1IdEl.textContent = '-';
        if (h0Input) h0Input.value = 0;
        if (h1Input) h1Input.value = 0;
      }
    } else {
      selEl.textContent = '-, -';
      if (l0IdEl) l0IdEl.textContent = '-';
      if (l1IdEl) l1IdEl.textContent = '-';
      if (h0Input) h0Input.value = 0;
      if (h1Input) h1Input.value = 0;
    }
  }

  function saveTemplate() {
    const name = document.getElementById('template-name').value.trim() || '模板' + (savedTemplates.length + 1);
    const tplTiles = [];
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const k = tx + ',' + ty;
        const t = data[k];
        if (t && (t.layer0 >= 0 || t.layer1 > 0 || t.barrier)) {
          tplTiles.push({
            x: tx - minX, y: ty - minY,
            layer0: t.layer0,
            height0: t.height0 || 0,
            layer1: t.layer1,
            height1: t.height1 || 0,
            barrier: t.barrier
          });
        }
      }
    }
    if (tplTiles.length === 0) { alert('模板为空'); return; }

    const sourceGop = (typeof UI !== 'undefined' && UI.getGopFileName) ? UI.getGopFileName() : '';
    const gopTiles = (typeof UI !== 'undefined' && UI.getTiles) ? UI.getTiles() : null;

    // 收集模板中用到的图块图像数据
    const tileImages = {};
    if (gopTiles) {
      const usedIds = new Set();
      for (const t of tplTiles) {
        if (t.layer0 >= 0) usedIds.add(t.layer0);
        if (t.layer1 > 0) usedIds.add(t.layer1 - 1); // layer1 存储的是 id + 1
      }
      for (const id of usedIds) {
        // 优先使用编辑器中已有的图块图像（保持原始 GOP 的图块）
        if (editorTileImages && editorTileImages[id]) {
          tileImages[id] = imageDataToBase64(editorTileImages[id]);
        } else if (id >= 0 && id < gopTiles.length) {
          tileImages[id] = imageDataToBase64(gopTiles[id]);
        }
      }
    }

    const template = {
      name, tiles: tplTiles, w: maxX - minX + 1, h: maxY - minY + 1,
      baseParity: baseParity, sourceGop, tileImages
    };

    if (editMode && editIdx >= 0 && editIdx < savedTemplates.length) {
      savedTemplates[editIdx] = template;
      selIdx = editIdx;
    } else {
      savedTemplates.push(template);
      selIdx = savedTemplates.length - 1;
    }
    editMode = false; editIdx = -1;

    if (typeof UI !== 'undefined' && UI.refreshTemplateList) UI.refreshTemplateList();
    close();
  }

  function getTemplates() { return savedTemplates; }
  function getSelected() { return selIdx >= 0 ? savedTemplates[selIdx] : null; }
  function selectTemplate(idx) { selIdx = idx; }

  let selectedTemplateIndices = new Set();
  function toggleTemplateSelection(idx) {
    if (selectedTemplateIndices.has(idx)) {
      selectedTemplateIndices.delete(idx);
    } else {
      selectedTemplateIndices.add(idx);
    }
  }
  function clearTemplateSelection() { selectedTemplateIndices.clear(); }
  function getSelectedTemplateIndices() { return Array.from(selectedTemplateIndices); }
  function isTemplateSelected(idx) { return selectedTemplateIndices.has(idx); }
  function deleteSelectedTemplates() {
    const indices = Array.from(selectedTemplateIndices).sort((a, b) => b - a);
    for (const idx of indices) {
      if (idx >= 0 && idx < savedTemplates.length) {
        savedTemplates.splice(idx, 1);
      }
    }
    selectedTemplateIndices.clear();
    if (selIdx >= savedTemplates.length) selIdx = savedTemplates.length - 1;
    if (savedTemplates.length === 0) selIdx = -1;
    if (typeof UI !== 'undefined' && UI.refreshTemplateList) UI.refreshTemplateList();
  }
  function deleteTemplateByIndex(idx) {
    if (idx >= 0 && idx < savedTemplates.length) {
      savedTemplates.splice(idx, 1);
      if (selIdx >= savedTemplates.length) selIdx = savedTemplates.length - 1;
      if (savedTemplates.length === 0) selIdx = -1;
      selectedTemplateIndices.clear();
      if (typeof UI !== 'undefined' && UI.refreshTemplateList) UI.refreshTemplateList();
    }
  }

  function setSelectedTile(id) {
    selectedTile = id;
    const grid = document.getElementById('template-tile-grid');
    if (grid) {
      grid.querySelectorAll('.tile-thumb').forEach(t => {
        t.classList.toggle('selected', parseInt(t.dataset.id) === id);
      });
    }
    const curTile = document.getElementById('template-cur-tile');
    if (curTile) curTile.textContent = id;
  }

  return { init, open, close, isOpened, getTemplates, getSelected, selectTemplate, setSelectedTile, buildTileGrid, toggleTemplateSelection, clearTemplateSelection, getSelectedTemplateIndices, isTemplateSelected, deleteSelectedTemplates, deleteTemplateByIndex, base64ToImageData };
})();