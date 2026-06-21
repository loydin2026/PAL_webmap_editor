const TemplateEditor = (function() {
  let isOpen = false;
  let canvas = null;
  let ctx = null;
  let isMouseDown = false;

  // 模板数据: key="x,y" -> {layer0, layer1, barrier}
  let data = {};
  let minX = 0, maxX = 1, minY = 0, maxY = 1;

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

  function init() {
    canvas = document.getElementById('template-canvas');
    ctx = canvas.getContext('2d');
    canvas.width = 700;
    canvas.height = 400;
    bindEvents();
  }

  function bindEvents() {
    document.querySelectorAll('.t-tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.t-tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        tTool = btn.dataset.tmode;
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
  }

  function open(targetIdx = -1) {
    isOpen = true;
    editMode = targetIdx >= 0;
    editIdx = targetIdx;
    document.getElementById('template-modal').classList.remove('hidden');

    if (editMode && editIdx >= 0 && editIdx < savedTemplates.length) {
      // 编辑现有模板
      const tpl = savedTemplates[editIdx];
      document.getElementById('template-name').value = tpl.name;
      data = {};
      minX = 0; maxX = tpl.w - 1; minY = 0; maxY = tpl.h - 1;
      for (const t of tpl.tiles) {
        data[t.x + ',' + t.y] = { layer0: t.layer0 > 0 ? t.layer0 : -1, layer1: t.layer1, barrier: t.barrier };
      }
    } else {
      // 新建模板
      data = {}; minX = 0; maxX = 1; minY = 0; maxY = 1;
      undoStack.length = 0; redoStack.length = 0;
      document.getElementById('template-name').value = '模板' + (savedTemplates.length + 1);
    }
    selTileX = -1; selTileY = -1;
    mouseTileX = -1; mouseTileY = -1;

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
      c.width = gopTiles[i].width; c.height = gopTiles[i].height;
      c.getContext('2d').putImageData(gopTiles[i], 0, 0);
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
    const dminX = minX - 1, dminY = minY - 1, dmaxX = maxX + 1, dmaxY = maxY + 1;
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
      const key = tile.x + ',' + tile.y;
      const oldV = data[key] ? { ...data[key] } : { layer0: -1, layer1: 0, barrier: false };
      apply(tile.x, tile.y);
      const newV = data[key] ? { ...data[key] } : { layer0: -1, layer1: 0, barrier: false };
      if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
        undoStack.push({ x: tile.x, y: tile.y, oldV, newV });
        redoStack.length = 0;
      }
      render(); updateInfo();
    }
  }

  function apply(tx, ty) {
    if (tx < minX - 1 || tx > maxX + 1 || ty < minY - 1 || ty > maxY + 1) return;
    if (tx < minX) minX = tx; if (tx > maxX) maxX = tx;
    if (ty < minY) minY = ty; if (ty > maxY) maxY = ty;
    const k = tx + ',' + ty;
    if (!data[k]) data[k] = { layer0: -1, layer1: 0, barrier: false };
    if (tTool === 'pen') {
      if (selectedTile >= 0) {
        if (tLayer === 0) data[k].layer0 = selectedTile;
        else data[k].layer1 = selectedTile + 1;
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
    tilePositions = []; // 每次渲染时重置
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const { cx, cy, ox, oy } = getCamera();
    const cp = MapModule.tileToPixel(cx, cy);
    const gopTiles = UI.getTiles();

    for (let ty = minY - 1; ty <= maxY + 1; ty++) {
      for (let tx = minX - 1; tx <= maxX + 1; tx++) {
        const p = MapModule.tileToPixel(tx, ty);
        const px = p.x - cp.x + ox, py = p.y - cp.y + oy;
        tilePositions.push({ tx, ty, px, py }); // 记录位置供 onMouse 使用

        const inR = tx >= minX && tx <= maxX && ty >= minY && ty <= maxY;
        const k = tx + ',' + ty;
        const t = data[k];
        if (inR && t && gopTiles) {
          if (showL0 && t.layer0 >= 0) {
            const i0 = MapModule.getLayerImage(t.layer0);
            if (i0 >= 0 && i0 < gopTiles.length) drawImg(ctx, px - 32, py - 15, gopTiles[i0]);
          }
          if (showL1 && t.layer1 > 0) {
            const i1 = MapModule.getLayerImage(t.layer1);
            if (i1 > 0 && i1 - 1 < gopTiles.length) drawImg(ctx, px - 32, py - 15, gopTiles[i1 - 1]);
          }
          if (t.barrier) drawImg(ctx, px - 32, py - 15, Editor.barrierImg);
        }
        // 绘制菱形网格线（等距 tile 的实际形状）
        drawDiamond(ctx, px, py, 64, 30, inR ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)');
      }
    }

    // 绘制鼠标悬停提示图（bitmap1.png）
    if (mouseTileX >= 0 && mouseTileY >= 0) {
      const p = MapModule.tileToPixel(mouseTileX, mouseTileY);
      const px = p.x - cp.x + ox, py = p.y - cp.y + oy;
      if (Editor.mouseImg) {
        drawImg(ctx, px - 32, py - 15, Editor.mouseImg);
      }
    }

    // 绘制选中提示图（bitmap2.png）
    if (selTileX >= 0 && selTileY >= 0) {
      const p = MapModule.tileToPixel(selTileX, selTileY);
      const px = p.x - cp.x + ox, py = p.y - cp.y + oy;
      if (Editor.selImg) {
        drawImg(ctx, px - 32, py - 15, Editor.selImg);
      }
    }
  }

  function drawDiamond(c, cx, cy, w, h, color) {
    c.strokeStyle = color;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(cx, cy - h / 2);      // 上
    c.lineTo(cx + w / 2, cy);      // 右
    c.lineTo(cx, cy + h / 2);      // 下
    c.lineTo(cx - w / 2, cy);      // 左
    c.closePath();
    c.stroke();
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
            layer0: t.layer0 >= 0 ? t.layer0 : 0,
            layer1: t.layer1 > 0 ? t.layer1 : 0,
            barrier: t.barrier
          });
        }
      }
    }
    if (tplTiles.length === 0) { alert('模板为空'); return; }

    if (editMode && editIdx >= 0 && editIdx < savedTemplates.length) {
      // 更新现有模板
      savedTemplates[editIdx] = { name, tiles: tplTiles, w: maxX - minX + 1, h: maxY - minY + 1, baseParity: minX % 2 };
      selIdx = editIdx;
    } else {
      // 添加新模板
      savedTemplates.push({ name, tiles: tplTiles, w: maxX - minX + 1, h: maxY - minY + 1, baseParity: minX % 2 });
      selIdx = savedTemplates.length - 1;
    }
    editMode = false; editIdx = -1;

    if (typeof UI !== 'undefined' && UI.refreshTemplateList) UI.refreshTemplateList();
    close();
  }

  function getTemplates() { return savedTemplates; }
  function getSelected() { return selIdx >= 0 ? savedTemplates[selIdx] : null; }
  function selectTemplate(idx) { selIdx = idx; }
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

  return { init, open, close, isOpened, getTemplates, getSelected, selectTemplate, setSelectedTile };
})();