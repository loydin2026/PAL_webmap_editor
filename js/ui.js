const UI = (function () {
  const gopCache = {};
  const mapCache = {};
  let tiles = null;
  let miniTiles = null;
  let gopFileName = '';
  let mapFileName = '';
  let isModified = false;
  let gopList = [];
  let mapList = [];

  // 模板预览状态
  let previewTemplate = null;
  let previewPos = null;

  function init() {
    bindToolbar();
    bindCanvasEvents();
    bindPropertyPanel();
    bindFileInput();
    bindSelects();
    bindDrawers();
  }

  function bindDrawers() {
    document.querySelectorAll('.drawer-header').forEach(header => {
      header.addEventListener('click', () => {
        const drawer = header.parentElement;
        drawer.classList.toggle('collapsed');
      });
    });
    // 默认展开前两个，收起模板
    const drawers = document.querySelectorAll('.drawer');
    if (drawers[2]) drawers[2].classList.add('collapsed');
  }

  function bindSelects() {
    const gopSelect = document.getElementById('gop-select');
    const mapSelect = document.getElementById('map-select');
    gopSelect.addEventListener('change', async () => {
      const name = gopSelect.value;
      if (name) await loadGopByName(name);
    });
    mapSelect.addEventListener('change', async () => {
      const name = mapSelect.value;
      if (name) await loadMapByName(name);
    });
  }

  function fillGopSelect(list) {
    gopList = list;
    const select = document.getElementById('gop-select');
    select.innerHTML = '';
    list.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      select.appendChild(opt);
    });
  }
  function fillMapSelect(list) {
    mapList = list;
    const select = document.getElementById('map-select');
    select.innerHTML = '';
    list.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      select.appendChild(opt);
    });
  }

  async function loadGopByName(name) {
    if (gopCache[name]) {
      tiles = gopCache[name].tiles;
      miniTiles = gopCache[name].miniTiles;
      gopFileName = name;
      buildTileGrid();
      updateStatus('已切换图组: ' + name);
      Renderer.renderMiniMap(miniTiles);
      return;
    }
    try {
      const pal = PaletteModule.getPalette();
      if (!pal) { updateStatus('错误：调色板未加载'); return; }
      const gop = await GopLoader.load('./gop/' + name, pal);
      gopCache[name] = { tiles: gop.tiles, miniTiles: gop.miniTiles };
      tiles = gop.tiles; miniTiles = gop.miniTiles;
      gopFileName = name;
      buildTileGrid();
      updateStatus('图组已加载: ' + name + ' (' + gop.imageCount + ' 图块)');
      Renderer.renderMiniMap(miniTiles);
      const gopSelect = document.getElementById('gop-select');
      if (gopSelect) gopSelect.value = name;
    } catch (e) {
      console.error('加载 GOP 失败:', name, e);
      updateStatus('加载图组失败: ' + name);
    }
  }

  async function loadMapByName(name) {
    if (mapCache[name]) {
      MapModule.loadMap(mapCache[name]);
      isModified = false; mapFileName = name;
      Editor.clearUndoRedo();
      updateStatus('已切换地图: ' + name);
      updateMapStatus();
      Renderer.renderMiniMap(miniTiles);
      const mapSelect = document.getElementById('map-select');
      if (mapSelect) mapSelect.value = name;
      const num = name.match(/(\d+)/);
      if (num) {
        const gopName = 'gop' + num[1].padStart(4, '0');
        if (gopList.includes(gopName) && gopFileName !== gopName) await loadGopByName(gopName);
      }
      return;
    }
    try {
      const response = await fetch('./map/' + name);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const buffer = await response.arrayBuffer();
      mapCache[name] = buffer;
      MapModule.loadMap(buffer);
      isModified = false; mapFileName = name;
      Editor.clearUndoRedo();
      updateStatus('地图已加载: ' + name);
      updateMapStatus();
      Renderer.renderMiniMap(miniTiles);
      const mapSelect = document.getElementById('map-select');
      if (mapSelect) mapSelect.value = name;
      const num = name.match(/(\d+)/);
      if (num) {
        const gopName = 'gop' + num[1].padStart(4, '0');
        if (gopList.includes(gopName) && gopFileName !== gopName) await loadGopByName(gopName);
      }
    } catch (e) {
      console.error('加载 MAP 失败:', name, e);
      updateStatus('加载地图失败: ' + name);
    }
  }

  function bindToolbar() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tool = btn.dataset.tool;
        Editor.setTool(tool);
        // 点击模板工具时，如果没有选中模板，打开模板编辑器
        if (tool === 'template') {
          const tpl = TemplateEditor.getSelected();
          if (!tpl) {
            TemplateEditor.open();
            // 重置为选择工具
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            document.getElementById('btn-select').classList.add('active');
            Editor.setTool('select');
            updateStatus('请先新建或选择模板');
            return;
          }
        }
        updateStatus('当前工具: ' + btn.title);
      });
    });

    document.querySelectorAll('.layer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Editor.setLayer(parseInt(btn.dataset.layer));
        updateStatus('编辑第' + btn.dataset.layer + '层');
      });
    });

    document.getElementById('btn-view-barrier').addEventListener('click', () => {
      const btn = document.getElementById('btn-view-barrier');
      btn.classList.toggle('active');
      Editor.setShowBarrier(btn.classList.contains('active'));
    });
    document.getElementById('btn-view-object').addEventListener('click', () => {
      const btn = document.getElementById('btn-view-object');
      btn.classList.toggle('active');
      Editor.setShowObject(btn.classList.contains('active'));
    });
    document.getElementById('btn-view-l0').addEventListener('click', () => {
      const btn = document.getElementById('btn-view-l0');
      btn.classList.toggle('active');
      Editor.setShowL0(btn.classList.contains('active'));
      const sel = Editor.getSelTile();
      if (sel.x >= 0 && sel.y >= 0) updatePropertyPanel(sel.x, sel.y);
    });
    document.getElementById('btn-view-l1').addEventListener('click', () => {
      const btn = document.getElementById('btn-view-l1');
      btn.classList.toggle('active');
      Editor.setShowL1(btn.classList.contains('active'));
      const sel = Editor.getSelTile();
      if (sel.x >= 0 && sel.y >= 0) updatePropertyPanel(sel.x, sel.y);
    });
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      Editor.setZoom(Editor.getZoom() + 0.25); updateZoomDisplay();
    });
    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      Editor.setZoom(Editor.getZoom() - 0.25); updateZoomDisplay();
    });
    document.getElementById('btn-undo').addEventListener('click', () => {
      if (Editor.undo()) { updateStatus('已撤销'); isModified = true; Renderer.renderMiniMap(miniTiles); }
      else { updateStatus('没有可撤销的操作'); }
    });
    document.getElementById('btn-redo').addEventListener('click', () => {
      if (Editor.redo()) { updateStatus('已重做'); isModified = true; Renderer.renderMiniMap(miniTiles); }
      else { updateStatus('没有可重做的操作'); }
    });
    document.getElementById('btn-new').addEventListener('click', () => {
      if (isModified && !confirm('地图未保存，确定新建吗？')) return;
      MapModule.newMap(); isModified = false; mapFileName = '';
      Editor.clearUndoRedo();
      const mapSelect = document.getElementById('map-select');
      if (mapSelect) mapSelect.value = '';
      updateStatus('新建空白地图'); updateMapStatus();
      Renderer.renderMiniMap(miniTiles);
    });
    document.getElementById('btn-open').addEventListener('click', () => {
      document.getElementById('file-input').click();
    });
    document.getElementById('btn-save').addEventListener('click', saveMapFile);
    document.getElementById('btn-new-template').addEventListener('click', () => {
      TemplateEditor.open();
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (Editor.redo()) { updateStatus('已重做'); isModified = true; Renderer.renderMiniMap(miniTiles); }
          else { updateStatus('没有可重做的操作'); }
        } else {
          if (Editor.undo()) { updateStatus('已撤销'); isModified = true; Renderer.renderMiniMap(miniTiles); }
          else { updateStatus('没有可撤销的操作'); }
        }
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (Editor.redo()) { updateStatus('已重做'); isModified = true; Renderer.renderMiniMap(miniTiles); }
        else { updateStatus('没有可重做的操作'); }
      }
    });
  }

  function bindFileInput() {
    const input = document.getElementById('file-input');
    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const name = file.name.toLowerCase();
      if (name.endsWith('.mkf') || name === 'pat.mkf') {
        try { await PaletteModule.loadFromFile(file); updateStatus('调色板已加载'); }
        catch (err) { alert('加载调色板失败: ' + err.message); }
      } else if (name.startsWith('gop') || name.endsWith('.gop')) {
        try {
          const pal = PaletteModule.getPalette();
          if (!pal) { alert('请先加载 Pat.mkf'); return; }
          const gop = await GopLoader.loadFromFile(file, pal);
          gopCache[file.name] = { tiles: gop.tiles, miniTiles: gop.miniTiles };
          tiles = gop.tiles; miniTiles = gop.miniTiles;
          gopFileName = file.name;
          buildTileGrid();
          updateStatus('图组已加载: ' + file.name);
          Renderer.renderMiniMap(miniTiles);
        } catch (err) { alert('加载图组失败: ' + err.message); }
      } else if (name.startsWith('map') || name.endsWith('.map')) {
        try {
          const buffer = await file.arrayBuffer();
          mapCache[file.name] = buffer;
          MapModule.loadMap(buffer);
          isModified = false; mapFileName = file.name;
          Editor.clearUndoRedo();
          updateStatus('地图已加载: ' + file.name); updateMapStatus();
          Renderer.renderMiniMap(miniTiles);
          const num = name.match(/(\d+)/);
          if (num) { const gopName = 'gop' + num[1].padStart(4, '0'); if (gopList.includes(gopName)) await loadGopByName(gopName); }
        } catch (err) { alert('加载地图失败: ' + err.message); }
      }
      input.value = '';
    });
  }

  function bindCanvasEvents() {
    const canvas = document.getElementById('map-canvas');

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const tile = Editor.screenToTile(e.clientX, e.clientY);
      Editor.setMouseTile(tile.x, tile.y);

      // Shift+点击：添加旧版模板
      if (e.shiftKey) {
        Editor.addToTemplate(tile.x, tile.y);
        updateStatus('模板已添加: ' + tile.x + ',' + tile.y);
        return;
      }

      Editor.setIsMouseDown(true);
      Editor.setSelTile(tile.x, tile.y);

      if (Editor.getTool() === Editor.TOOLS.SELECT) {
        Editor.setIsDragging(true);
        Editor.setLastDrag(e.clientX, e.clientY);
      } else if (Editor.getTool() === Editor.TOOLS.TEMPLATE) {
        const tpl = TemplateEditor.getSelected();
        if (tpl) {
          Editor.pushUndo();
          const baseParity = (tpl.baseParity !== undefined ? tpl.baseParity : 0) & 1;
          const destParity = tile.x & 1;
          // 放置模板
          for (const t of tpl.tiles) {
            let tx = tile.x + t.x;
            let ty = tile.y + t.y;
            if (baseParity !== destParity) {
              if ((t.x & 1) === baseParity) {
                ty -= 1;
              }
            }
            if (!MapModule.assert(tx, ty)) continue;
            MapModule.setTile(tx, ty, 0, t.layer0);
            MapModule.setTile(tx, ty, 1, t.layer1);
            MapModule.setTileBarrierValue(tx, ty, t.barrier);
          }
          isModified = true;
          updateStatus('模板已放置');
        }
      } else {
        Editor.pushUndo();
        if (Editor.applyEdit(tile.x, tile.y)) isModified = true;
      }
      updatePropertyPanel(tile.x, tile.y);
    });

    canvas.addEventListener('mousemove', (e) => {
      const tile = Editor.screenToTile(e.clientX, e.clientY);
      Editor.setMouseTile(tile.x, tile.y);
      updateStatusPos(tile.x, tile.y);

      // 模板预览
      if (Editor.getTool() === Editor.TOOLS.TEMPLATE) {
        const tpl = TemplateEditor.getSelected();
        if (tpl) {
          previewTemplate = tpl;
          previewPos = { x: tile.x, y: tile.y };
        } else {
          previewTemplate = null;
          previewPos = null;
        }
      } else {
        previewTemplate = null;
        previewPos = null;
      }

      if (Editor.getIsMouseDown() && !Editor.getIsDragging()) {
        if (Editor.getTool() !== Editor.TOOLS.TEMPLATE) {
          if (Editor.applyEdit(tile.x, tile.y)) isModified = true;
        }
      }

      if (Editor.getIsDragging()) {
        const last = Editor.getLastDrag();
        const dx = last.x - e.clientX;
        const dy = last.y - e.clientY;
        const zoom = Editor.getZoom();
        const tileDx = Math.round(dx / zoom / 32);
        const tileDy = Math.round(dy / zoom / 32);
        if (tileDx !== 0 || tileDy !== 0) {
          const cam = Editor.getCamera();
          Editor.setCamera(cam.x + tileDx, cam.y + tileDy);
          Editor.setLastDrag(e.clientX, e.clientY);
        }
      }
    });

    canvas.addEventListener('mouseup', () => { Editor.setIsMouseDown(false); Editor.setIsDragging(false); Editor.clearUndoPushed(); });
    canvas.addEventListener('mouseleave', () => { Editor.setIsMouseDown(false); Editor.setIsDragging(false); Editor.clearUndoPushed(); Editor.setMouseTile(-1, -1); previewTemplate = null; });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); Editor.setZoom(Editor.getZoom() + (e.deltaY > 0 ? -0.25 : 0.25)); updateZoomDisplay(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); const tile = Editor.screenToTile(e.clientX, e.clientY); Editor.setSelTile(tile.x, tile.y); updatePropertyPanel(tile.x, tile.y); });
  }

  function bindPropertyPanel() {
    document.getElementById('btn-apply-attr').addEventListener('click', () => {
      const sel = Editor.getSelTile();
      if (!MapModule.assert(sel.x, sel.y)) return;
      Editor.pushUndo();
      if (Editor.getShowL0()) {
        MapModule.setTileImage(sel.x, sel.y, 0, parseInt(document.getElementById('attr-image0').value) || 0);
        MapModule.setTileHeight(sel.x, sel.y, 0, parseInt(document.getElementById('attr-height0').value) || 0);
      }
      if (Editor.getShowL1()) {
        MapModule.setTileImage(sel.x, sel.y, 1, parseInt(document.getElementById('attr-image1').value) || 0);
        MapModule.setTileHeight(sel.x, sel.y, 1, parseInt(document.getElementById('attr-height1').value) || 0);
      }
      MapModule.setTileBarrierValue(sel.x, sel.y, document.getElementById('attr-barrier').checked);
      isModified = true; updateStatus('属性已应用'); Renderer.renderMiniMap(miniTiles);
    });
  }

  function buildTileGrid() {
    const grid = document.getElementById('tile-grid');
    grid.innerHTML = '';
    if (!tiles) return;
    for (let i = 0; i < tiles.length; i++) {
      const div = document.createElement('div');
      div.className = 'tile-thumb';
      div.dataset.id = i;
      const c = document.createElement('canvas');
      c.width = tiles[i].width; c.height = tiles[i].height;
      c.getContext('2d').putImageData(tiles[i], 0, 0);
      div.appendChild(c);
      const idLabel = document.createElement('span');
      idLabel.className = 'tile-id'; idLabel.textContent = i;
      div.appendChild(idLabel);
      div.addEventListener('click', () => {
        document.querySelectorAll('.tile-thumb').forEach(t => t.classList.remove('selected'));
        div.classList.add('selected');
        Editor.setSelectedTile(i);
        TemplateEditor.setSelectedTile(i);
        document.getElementById('selected-tile-id').textContent = i;
      });
      grid.appendChild(div);
    }
  }

  function refreshTemplateList() {
    const list = document.getElementById('template-list');
    list.innerHTML = '';
    const templates = TemplateEditor.getTemplates();
    const gopTiles = tiles;
    templates.forEach((tpl, idx) => {
      const div = document.createElement('div');
      div.className = 'template-item' + (idx === TemplateEditor.getSelected() ? ' selected' : '');
      div.dataset.idx = idx;

      // 生成缩略图
      const c = document.createElement('canvas');
      c.width = 96; c.height = 64;
      const tctx = c.getContext('2d');
      tctx.fillStyle = '#000'; tctx.fillRect(0, 0, 96, 64);
      if (gopTiles) {
        let minTx = Infinity, minTy = Infinity;
        tpl.tiles.forEach(t => { minTx = Math.min(minTx, t.x); minTy = Math.min(minTy, t.y); });
        const offX = 48 - (tpl.w * 32) / 2;
        const offY = 32 - (tpl.h * 16) / 2;
        tpl.tiles.forEach(t => {
          const px = offX + (t.x - minTx) * 32;
          const py = offY + (t.y - minTy) * 16;
          const i0 = MapModule.getLayerImage(t.layer0);
          if (i0 >= 0 && i0 < gopTiles.length) drawTileImage(tctx, px, py, gopTiles[i0]);
          const i1 = MapModule.getLayerImage(t.layer1);
          if (i1 > 0 && i1 - 1 < gopTiles.length) drawTileImage(tctx, px, py, gopTiles[i1 - 1]);
        });
      }
      div.appendChild(c);

      const nameLabel = document.createElement('span');
      nameLabel.className = 'template-name'; nameLabel.textContent = tpl.name;
      div.appendChild(nameLabel);

      // 编辑按钮
      const editBtn = document.createElement('button');
      editBtn.className = 'template-edit-btn';
      editBtn.textContent = '编辑';
      editBtn.title = '编辑模板';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        TemplateEditor.open(idx);
        updateStatus('正在编辑模板: ' + tpl.name);
      });
      div.appendChild(editBtn);

      div.addEventListener('click', () => {
        document.querySelectorAll('.template-item').forEach(t => t.classList.remove('selected'));
        div.classList.add('selected');
        TemplateEditor.selectTemplate(idx);
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-template').classList.add('active');
        Editor.setTool('template');
        updateStatus('已选中模板: ' + tpl.name + '，点击地图放置');
      });
      list.appendChild(div);
    });
  }

  function drawTileImage(ctx, x, y, imageData) {
    if (!imageData) return;
    let tmp = imageData._tempCanvas;
    if (!tmp) {
      tmp = document.createElement('canvas');
      tmp.width = imageData.width; tmp.height = imageData.height;
      tmp.getContext('2d').putImageData(imageData, 0, 0);
      imageData._tempCanvas = tmp;
    }
    ctx.drawImage(tmp, x, y);
  }

  function updatePropertyPanel(x, y) {
    if (!MapModule.assert(x, y)) return;
    document.getElementById('attr-xy').textContent = x + ', ' + y;

    const showL0 = Editor.getShowL0();
    const showL1 = Editor.getShowL1();

    document.getElementById('attr-image0').value = MapModule.getTileImage(x, y, 0);
    document.getElementById('attr-image1').value = MapModule.getTileImage(x, y, 1);
    document.getElementById('attr-height0').value = MapModule.getTileHeight(x, y, 0);
    document.getElementById('attr-height1').value = MapModule.getTileHeight(x, y, 1);
    document.getElementById('attr-barrier').checked = MapModule.getTileBarrier(x, y);

    // 根据图层显示状态控制属性行可见性
    document.getElementById('attr-image0').closest('.attr-row').style.display = showL0 ? '' : 'none';
    document.getElementById('attr-image1').closest('.attr-row').style.display = showL1 ? '' : 'none';
    document.getElementById('attr-height0').closest('.attr-row').style.display = showL0 ? '' : 'none';
    document.getElementById('attr-height1').closest('.attr-row').style.display = showL1 ? '' : 'none';
  }

  function saveMapFile() {
    const buffer = MapModule.saveMap();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = mapFileName || 'map0001';
    a.click(); URL.revokeObjectURL(url);
    isModified = false; updateStatus('地图已保存');
  }

  function updateStatus(msg) { document.getElementById('status-msg').textContent = msg; }
  function updateStatusPos(x, y) { document.getElementById('status-pos').textContent = 'X: ' + x + ', Y: ' + y; }
  function updateMapStatus() {
    const cam = Editor.getCamera();
    document.getElementById('status-camera').textContent = 'Camera: ' + cam.x + ', ' + cam.y;
    document.getElementById('status-map').textContent = mapFileName || '未加载地图';
  }
  function updateZoomDisplay() { document.getElementById('zoom-level').textContent = Math.round(Editor.getZoom() * 100) + '%'; }

  function getTiles() { return tiles; }
  function getMiniTiles() { return miniTiles; }
  function getPreviewTemplate() { return previewTemplate; }
  function getPreviewPos() { return previewPos; }
  function isMapModified() { return isModified; }
  function setMapModified(v) { isModified = v; }

  return {
    init, fillGopSelect, fillMapSelect, loadGopByName, loadMapByName,
    buildTileGrid, refreshTemplateList,
    updateStatus, updateStatusPos, updateMapStatus, updateZoomDisplay, updatePropertyPanel,
    getTiles, getMiniTiles, getPreviewTemplate, getPreviewPos, isMapModified, setMapModified
  };
})();
