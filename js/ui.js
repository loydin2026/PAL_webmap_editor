const UI = (function () {
  // 图块数据编码辅助函数
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

  const gopCache = {};
  const mapCache = {};
  let tiles = null;
  let miniTiles = null;
  let gopFileName = '';
  let mapFileName = '';
  let isModified = false;
  let gopList = [];
  let mapList = [];

  // 跨图组图块导入去重缓存：key = `${sourceGop}:${oldId}`, value = newId in current GOP
  const crossGopImportMap = new Map();

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
    bindCreateTemplateButton();
  }

  function bindCreateTemplateButton() {
    const btn = document.getElementById('btn-create-template');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const tplData = Editor.createTemplateFromSelection();
      if (!tplData) {
        updateStatus('没有选中的图块，无法创建模板');
        return;
      }
      const templates = TemplateEditor.getTemplates();
      const name = '区域模板' + (templates.length + 1);
      const tileImages = {};
      if (tiles) {
        const usedIds = new Set();
        for (const t of tplData.tiles) {
          if (t.layer0 >= 0) usedIds.add(t.layer0);
          if (t.layer1 > 0) usedIds.add(t.layer1 - 1);
        }
        for (const id of usedIds) {
          if (id >= 0 && id < tiles.length) {
            tileImages[id] = imageDataToBase64(tiles[id]);
          }
        }
      }
      templates.push({
        name,
        tiles: tplData.tiles,
        w: tplData.w,
        h: tplData.h,
        baseParity: tplData.baseParity,
        sourceGop: gopFileName,
        tileImages
      });
      TemplateEditor.selectTemplate(templates.length - 1);
      if (typeof UI !== 'undefined' && UI.refreshTemplateList) UI.refreshTemplateList();
      updateStatus('已从选中区域创建模板: ' + name + ' (' + tplData.tiles.length + ' 图块)');
    });
  }

  function bindTemplateActions() {
    // 删除选中模板
    const deleteBtn = document.getElementById('btn-delete-templates');
    if (deleteBtn) {
      deleteBtn.removeAttribute('disabled');
      deleteBtn.addEventListener('click', () => {
        const count = TemplateEditor.getSelectedTemplateIndices().length;
        if (count === 0) {
          updateStatus('请先选中要删除的模板');
          return;
        }
        if (!confirm('确定删除 ' + count + ' 个模板吗？')) return;
        TemplateEditor.deleteSelectedTemplates();
        updateStatus('已删除 ' + count + ' 个模板');
      });
    }

    // 导出模板为 JSON
    const exportBtn = document.getElementById('btn-export-templates');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const templates = TemplateEditor.getTemplates();
        if (templates.length === 0) {
          updateStatus('没有模板可导出');
          return;
        }
        const data = {
          version: 2,
          exportDate: new Date().toISOString(),
          templates: templates.map(t => ({
            name: t.name,
            tiles: t.tiles,
            w: t.w,
            h: t.h,
            baseParity: t.baseParity,
            sourceGop: t.sourceGop || '',
            tileImages: t.tileImages || {}
          }))
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'templates.json';
        a.click();
        URL.revokeObjectURL(url);
        updateStatus('已导出 ' + templates.length + ' 个模板');
      });
    }

    // 导入模板
    const importBtn = document.getElementById('btn-import-templates');
    const importInput = document.getElementById('template-import-input');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', () => importInput.click());
      importInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result);
            if (!data.templates || !Array.isArray(data.templates)) {
              updateStatus('导入失败：无效的文件格式');
              return;
            }
            const templates = TemplateEditor.getTemplates();
            let added = 0;
            for (const t of data.templates) {
              if (!t.tiles || !Array.isArray(t.tiles)) continue;
              templates.push({
                name: t.name || '导入模板' + (templates.length + 1),
                tiles: t.tiles,
                w: t.w || 1,
                h: t.h || 1,
                baseParity: t.baseParity || 0,
                sourceGop: t.sourceGop || '',
                tileImages: t.tileImages || {}
              });
              added++;
            }
            refreshTemplateList();
            updateStatus('成功导入 ' + added + ' 个模板');
          } catch (err) {
            updateStatus('导入失败：' + err.message);
          }
        };
        reader.readAsText(file);
        importInput.value = '';
      });
    }

    // 导出图块集为 GOP
    const exportGopBtn = document.getElementById('btn-export-gop');
    if (exportGopBtn) {
      exportGopBtn.addEventListener('click', () => {
        if (!tiles || tiles.length === 0) {
          updateStatus('当前没有图块集可导出');
          return;
        }
        const pal = PaletteModule.getPalette();
        if (!pal) {
          updateStatus('无法导出：调色板未加载');
          return;
        }
        try {
          const buffer = GopLoader.encodeGOP(tiles, pal);
          const blob = new Blob([buffer], { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = (gopFileName || 'gop0001') + '.gop';
          a.click();
          URL.revokeObjectURL(url);
          updateStatus('图块集已导出: ' + (gopFileName || 'gop0001') + '.gop (' + tiles.length + ' 图块)');
        } catch (err) {
          updateStatus('图块集导出失败: ' + err.message);
        }
      });
    }
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
    const paletteSelect = document.getElementById('palette-select');
    gopSelect.addEventListener('change', async () => {
      const name = gopSelect.value;
      if (name) await loadGopByName(name);
    });
    mapSelect.addEventListener('change', async () => {
      const name = mapSelect.value;
      if (name) await loadMapByName(name);
    });
    if (paletteSelect) {
      paletteSelect.addEventListener('change', async () => {
        const idx = parseInt(paletteSelect.value) || 0;
        await switchPalette(idx);
      });
    }
  }

  function fillPaletteSelect() {
    const count = PaletteModule.getPaletteCount();
    const select = document.getElementById('palette-select');
    if (!select) return;
    select.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = '色板 ' + i;
      select.appendChild(opt);
    }
  }

  async function switchPalette(index) {
    const ok = PaletteModule.setPaletteIndex(index);
    if (!ok) return;
    // 清除 GOP 缓存，强制使用新色板重新加载
    Object.keys(gopCache).forEach(key => delete gopCache[key]);
    // 清除跨图组导入缓存，避免旧映射指向错误图块
    crossGopImportMap.clear();
    // 清除所有模板的适配标记，确保色板切换后重新适配
    const templates = TemplateEditor.getTemplates();
    for (const t of templates) {
      if (t) t._adaptedFor = null;
    }
    invalidateTemplateCache();
    // 重新加载当前图组
    if (gopFileName) {
      await loadGopByName(gopFileName);
    }
    // 如果模板编辑器已打开，刷新其图块网格
    if (TemplateEditor.isOpened && TemplateEditor.isOpened()) {
      TemplateEditor.buildTileGrid();
    }
    updateStatus('已切换色板: ' + index);
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
      invalidateTemplateCache();
      crossGopImportMap.clear();
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
      invalidateTemplateCache();
      crossGopImportMap.clear();
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
    document.getElementById('layer-toggle-0').addEventListener('click', () => {
      const item = document.getElementById('layer-toggle-0');
      item.classList.toggle('active');
      Editor.setShowL0(item.classList.contains('active'));
      if (Editor.getSelectedTileCount() > 1) {
        updatePropertyPanelMulti();
      } else {
        const sel = Editor.getSelTile();
        if (sel.x >= 0 && sel.y >= 0) updatePropertyPanel(sel.x, sel.y);
      }
    });
    document.getElementById('layer-toggle-1').addEventListener('click', () => {
      const item = document.getElementById('layer-toggle-1');
      item.classList.toggle('active');
      Editor.setShowL1(item.classList.contains('active'));
      if (Editor.getSelectedTileCount() > 1) {
        updatePropertyPanelMulti();
      } else {
        const sel = Editor.getSelTile();
        if (sel.x >= 0 && sel.y >= 0) updatePropertyPanel(sel.x, sel.y);
      }
    });
    document.getElementById('btn-zoom-in').addEventListener('click', () => {
      Editor.setZoom(Editor.getZoom() + 0.5); updateZoomDisplay();
    });
    document.getElementById('btn-zoom-out').addEventListener('click', () => {
      Editor.setZoom(Editor.getZoom() - 0.5); updateZoomDisplay();
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
    document.getElementById('btn-save-as').addEventListener('click', saveMapAs);
    document.getElementById('btn-new-template').addEventListener('click', () => {
      TemplateEditor.open();
    });

    // 模板操作：删除、导入、导出
    bindTemplateActions();

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

      // Alt+点击：开始减选框选（框到哪里取消到哪里）
      if (e.altKey) {
        Editor.startBoxSelect(tile.x, tile.y, 'subtract');
        return;
      }

      // Ctrl+点击：开始框选（不拖动则视为普通点击，由 mousemove 判定）
      if (e.ctrlKey && !e.shiftKey) {
        Editor.startBoxSelect(tile.x, tile.y, 'replace');
        return;
      }

      // Ctrl+Shift+点击：减选
      if (e.ctrlKey && e.shiftKey) {
        Editor.removeSelTile(tile.x, tile.y);
        updatePropertyPanelMulti();
        updateStatus('减选: ' + tile.x + ',' + tile.y + ' (已选 ' + Editor.getSelectedTileCount() + ' 个)');
        return;
      }

      // Shift+点击：加选
      if (e.shiftKey && !e.ctrlKey) {
        Editor.addSelTile(tile.x, tile.y);
        updatePropertyPanelMulti();
        updateStatus('加选: ' + tile.x + ',' + tile.y + ' (已选 ' + Editor.getSelectedTileCount() + ' 个)');
        return;
      }

      // 普通点击/拖动：记录起点，不立即执行（SELECT 工具延迟到 mouseup 判定）
      Editor.setIsMouseDown(true);
      Editor.setMouseDownPos(e.clientX, e.clientY, tile.x, tile.y);

      if (Editor.getTool() !== Editor.TOOLS.SELECT) {
        // 非 SELECT 工具：立即执行单选和操作
        Editor.setSelTile(tile.x, tile.y);
        updatePropertyPanel(tile.x, tile.y);

        if (Editor.getTool() === Editor.TOOLS.TEMPLATE) {
          const tpl = TemplateEditor.getSelected();
          if (tpl) {
            (async () => {
              const adapted = await prepareTemplateForPlacement(tpl);
              if (!adapted) return;
              Editor.pushUndo();
              const baseParity = (adapted.baseParity !== undefined ? adapted.baseParity : 0) & 1;
              const destParity = tile.x & 1;
              for (const t of adapted.tiles) {
                let tx = tile.x + t.x;
                let ty = tile.y + t.y;
                if (baseParity !== destParity) {
                  const absParity = (baseParity + t.x) & 1;
                  if (absParity === destParity) {
                    ty += (destParity - baseParity);
                  }
                }
                if (!MapModule.assert(tx, ty)) continue;
                if (t.layer0 >= 0) {
                  const tile = MapModule.setLayerImage(MapModule.getTile(tx, ty, 0), t.layer0);
                  MapModule.setTile(tx, ty, 0, MapModule.setLayerHeight(tile, t.height0 || 0));
                }
                if (t.layer1 > 0) {
                  const tile = MapModule.setLayerImage(MapModule.getTile(tx, ty, 1), t.layer1);
                  MapModule.setTile(tx, ty, 1, MapModule.setLayerHeight(tile, t.height1 || 0));
                }
                MapModule.setTileBarrierValue(tx, ty, t.barrier);
              }
              isModified = true;
              updateStatus('模板已放置');
            })();
          }
        } else {
          Editor.pushUndo();
          if (Editor.applyEdit(tile.x, tile.y)) isModified = true;
        }
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const tile = Editor.screenToTile(e.clientX, e.clientY);
      Editor.setMouseTile(tile.x, tile.y);
      updateStatusPos(tile.x, tile.y);

      // 框选实时更新
      if (Editor.isBoxSelectingActive()) {
        Editor.updateBoxSelect(tile.x, tile.y);
        computeBoxSelection(canvas);
        updatePropertyPanelMulti();
        return;
      }

      // SELECT 工具：mousedown 后未判定为拖动，检查阈值
      if (Editor.getIsMouseDown() && Editor.getTool() === Editor.TOOLS.SELECT && !Editor.getIsDragging()) {
        if (Editor.isDragThresholdReached(e.clientX, e.clientY)) {
          Editor.setIsDragging(true);
          Editor.setLastDrag(e.clientX, e.clientY);
        }
      }

      // 模板预览
      if (Editor.getTool() === Editor.TOOLS.TEMPLATE) {
        const tpl = cachedAdaptedTemplate || TemplateEditor.getSelected();
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

      // 非 SELECT 工具：mousedown 时直接绘制
      if (Editor.getIsMouseDown() && !Editor.getIsDragging()) {
        if (Editor.getTool() !== Editor.TOOLS.TEMPLATE && Editor.getTool() !== Editor.TOOLS.SELECT) {
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
          // 强制以 2-tile 的偶数倍移动，避免被 setCamera 截断导致拖不动
          Editor.setCamera(cam.x + tileDx * 2, cam.y + tileDy * 2);
          Editor.setLastDrag(e.clientX, e.clientY);
        }
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      if (Editor.isBoxSelectingActive()) {
        Editor.endBoxSelect();
        const count = Editor.getSelectedTileCount();
        updateStatus('框选完成，已选 ' + count + ' 个图块');
        return;
      }

      // SELECT 工具且未判定为拖动 → 判定为点击，执行单选
      if (Editor.getIsMouseDown() && Editor.getTool() === Editor.TOOLS.SELECT && !Editor.getIsDragging()) {
        const pos = Editor.getMouseDownPos();
        Editor.setSelTile(pos.tileX, pos.tileY);
        updatePropertyPanel(pos.tileX, pos.tileY);
      }

      Editor.setIsMouseDown(false);
      Editor.setIsDragging(false);
      Editor.clearUndoPushed();
    });

    canvas.addEventListener('mouseleave', () => {
      if (Editor.isBoxSelectingActive()) {
        Editor.endBoxSelect();
      }
      // SELECT 工具未拖动时离开，不触发单选，直接清理状态
      Editor.setIsMouseDown(false);
      Editor.setIsDragging(false);
      Editor.clearUndoPushed();
      Editor.setMouseTile(-1, -1);
      previewTemplate = null;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      Editor.setZoom(Editor.getZoom() + (e.deltaY > 0 ? -0.5 : 0.5));
      updateZoomDisplay();
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const tile = Editor.screenToTile(e.clientX, e.clientY);
      Editor.setSelTile(tile.x, tile.y);
      updatePropertyPanel(tile.x, tile.y);
    });
  }

  function computeBoxSelection(canvas) {
    const state = Editor.getBoxSelectState();
    if (!state) return;

    const sx = state.startTile.x;
    const sy = state.startTile.y;
    const ex = state.currentTile.x;
    const ey = state.currentTile.y;

    const dx = ex - sx;
    const dy = ey - sy;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    const boxTiles = new Set();

    if (adx >= ady) {
      // x 为主方向（水平或斜向）
      const minX = Math.min(sx, ex);
      const maxX = Math.max(sx, ex);

      for (let x = Math.max(0, minX); x <= Math.min(MapModule.MAP_WIDTH - 1, maxX); x++) {
        const idealY = dx === 0 ? sy : sy + (x - sx) * dy / dx;
        const d = Math.min(Math.abs(x - sx), Math.abs(x - ex));

        let yMin, yMax;
        if (d === 0) {
          // 端点：只选连线上的 tile
          const rounded = Math.round(idealY);
          yMin = yMax = rounded;
        } else if (d === 1) {
          const rounded = Math.round(idealY);
          const isInteger = Math.abs(idealY - rounded) < 0.001;
          if (isInteger) {
            // idealY 为整数：根据 x 奇偶性向一侧扩展 1 格
            if (x % 2 === 1) {
              // 奇数 x：向下扩展（y 减小）
              yMin = rounded - 1;
              yMax = rounded;
            } else {
              // 偶数 x：向上扩展（y 增大）
              yMin = rounded;
              yMax = rounded + 1;
            }
          } else {
            // idealY 为半整数（如 7.5）：只取 floor，不扩展
            yMin = yMax = Math.floor(idealY);
          }
        } else {
          // d >= 2：向 idealY 对称扩展
          const rounded = Math.round(idealY);
          yMin = rounded - (d - 1);
          yMax = rounded + (d - 1);
        }

        for (let y = Math.max(0, yMin); y <= Math.min(MapModule.MAP_HEIGHT - 1, yMax); y++) {
          boxTiles.add(x + ',' + y);
        }
      }
    } else {
      // y 为主方向（垂直或更陡的斜向）
      const minY = Math.min(sy, ey);
      const maxY = Math.max(sy, ey);
      const isPureVertical = (dx === 0);

      for (let y = Math.max(0, minY); y <= Math.min(MapModule.MAP_HEIGHT - 1, maxY); y++) {
        const idealX = isPureVertical ? sx : sx + (y - sy) * dx / dy;
        const d = Math.min(Math.abs(y - sy), Math.abs(y - ey));

        let xMin, xMax;
        if (d === 0) {
          const rounded = Math.round(idealX);
          xMin = xMax = rounded;
        } else if (d === 1 && !isPureVertical) {
          const rounded = Math.round(idealX);
          const isInteger = Math.abs(idealX - rounded) < 0.001;
          if (isInteger) {
            // idealX 为整数：根据 y 奇偶性向一侧扩展 1 格
            if (y % 2 === 1) {
              xMin = rounded - 1;
              xMax = rounded;
            } else {
              xMin = rounded;
              xMax = rounded + 1;
            }
          } else {
            xMin = xMax = Math.floor(idealX);
          }
        } else {
          if (isPureVertical) {
            // 纯垂直：不扩展
            xMin = xMax = Math.round(idealX);
          } else {
            const rounded = Math.round(idealX);
            xMin = rounded - (d - 1);
            xMax = rounded + (d - 1);
          }
        }

        for (let x = Math.max(0, xMin); x <= Math.min(MapModule.MAP_WIDTH - 1, xMax); x++) {
          boxTiles.add(x + ',' + y);
        }
      }
    }

    // 根据模式应用
    if (state.mode === 'replace') {
      Editor.clearSelTiles();
      boxTiles.forEach(k => {
        const [x, y] = k.split(',').map(Number);
        Editor.addSelTile(x, y);
      });
    } else if (state.mode === 'add') {
      boxTiles.forEach(k => {
        const [x, y] = k.split(',').map(Number);
        Editor.addSelTile(x, y);
      });
    } else if (state.mode === 'subtract') {
      boxTiles.forEach(k => {
        const [x, y] = k.split(',').map(Number);
        Editor.removeSelTile(x, y);
      });
    }
  }

  function updatePropertyPanelMulti() {
    const count = Editor.getSelectedTileCount();
    document.getElementById('attr-xy').textContent = '已选择 ' + count + ' 个图块';
    // 多选时：显示创建模板按钮，隐藏单个属性行
    document.getElementById('attr-row-template').style.display = '';
    document.querySelectorAll('.attr-row-single').forEach(el => el.style.display = 'none');
    document.getElementById('btn-apply-attr').style.display = 'none';
  }

  function bindPropertyPanel() {
    document.getElementById('btn-apply-attr').addEventListener('click', () => {
      const count = Editor.getSelectedTileCount();
      if (count === 0) return;
      const selTiles = Editor.getSelectedTiles();
      Editor.pushUndo();
      let applied = 0;
      for (const t of selTiles) {
        if (!MapModule.assert(t.x, t.y)) continue;
        if (Editor.getShowL0()) {
          const img0 = parseInt(document.getElementById('attr-image0').value);
          if (!isNaN(img0)) MapModule.setTileImage(t.x, t.y, 0, img0);
          const h0 = parseInt(document.getElementById('attr-height0').value);
          if (!isNaN(h0)) MapModule.setTileHeight(t.x, t.y, 0, h0);
        }
        if (Editor.getShowL1()) {
          const img1 = parseInt(document.getElementById('attr-image1').value);
          if (!isNaN(img1)) MapModule.setTileImage(t.x, t.y, 1, img1);
          const h1 = parseInt(document.getElementById('attr-height1').value);
          if (!isNaN(h1)) MapModule.setTileHeight(t.x, t.y, 1, h1);
        }
        MapModule.setTileBarrierValue(t.x, t.y, document.getElementById('attr-barrier').checked);
        applied++;
      }
      isModified = true;
      updateStatus('属性已应用到 ' + applied + ' 个图块');
      Renderer.renderMiniMap(miniTiles);
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
    let lastSelectedIdx = -1;

    function updateDeleteBtn() {
      const deleteBtn = document.getElementById('btn-delete-templates');
      if (deleteBtn) {
        const selectedCount = TemplateEditor.getSelectedTemplateIndices().length;
        deleteBtn.textContent = selectedCount > 0 ? '删除选中 (' + selectedCount + ')' : '删除选中';
        if (selectedCount === 0) {
          deleteBtn.setAttribute('disabled', 'disabled');
        } else {
          deleteBtn.removeAttribute('disabled');
        }
      }
    }

    templates.forEach((tpl, idx) => {
      const div = document.createElement('div');
      const isSelected = TemplateEditor.isTemplateSelected(idx);
      const isActive = idx === TemplateEditor.getSelected() && !isSelected;
      div.className = 'template-item' + (isSelected || isActive ? ' selected' : '');
      div.dataset.idx = idx;

      // 生成缩略图
      const c = document.createElement('canvas');
      c.width = 96; c.height = 64;
      const tctx = c.getContext('2d');
      tctx.fillStyle = '#000'; tctx.fillRect(0, 0, 96, 64);
      let minTx = Infinity, minTy = Infinity;
      tpl.tiles.forEach(t => { minTx = Math.min(minTx, t.x); minTy = Math.min(minTy, t.y); });
      const offX = 48 - (tpl.w * 32) / 2;
      const offY = 32 - (tpl.h * 16) / 2;
      tpl.tiles.forEach(t => {
        const px = offX + (t.x - minTx) * 32;
        const py = offY + (t.y - minTy) * 16;
        // layer0
        if (t.layer0 >= 0) {
          let img0 = null;
          if (tpl.tileImages && tpl.tileImages[t.layer0]) {
            img0 = TemplateEditor.base64ToImageData(tpl.tileImages[t.layer0]);
          } else if (gopTiles && t.layer0 < gopTiles.length) {
            img0 = gopTiles[t.layer0];
          }
          if (img0) drawTileImage(tctx, px, py, img0);
        }
        // layer1
        if (t.layer1 > 0) {
          const i1 = t.layer1 - 1;
          let img1 = null;
          if (tpl.tileImages && tpl.tileImages[i1]) {
            img1 = TemplateEditor.base64ToImageData(tpl.tileImages[i1]);
          } else if (gopTiles && i1 < gopTiles.length) {
            img1 = gopTiles[i1];
          }
          if (img1) drawTileImage(tctx, px, py, img1);
        }
      });
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

      div.addEventListener('click', async (e) => {
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+点击：多选切换
          TemplateEditor.toggleTemplateSelection(idx);
          div.classList.toggle('selected', TemplateEditor.isTemplateSelected(idx));
          lastSelectedIdx = idx;
          updateDeleteBtn();
          return;
        }
        if (e.shiftKey && lastSelectedIdx >= 0) {
          // Shift+点击：范围选择
          const start = Math.min(lastSelectedIdx, idx);
          const end = Math.max(lastSelectedIdx, idx);
          for (let i = start; i <= end; i++) {
            if (!TemplateEditor.isTemplateSelected(i)) TemplateEditor.toggleTemplateSelection(i);
          }
          // 刷新所有项的选中状态
          document.querySelectorAll('.template-item').forEach((item, i) => {
            item.classList.toggle('selected', TemplateEditor.isTemplateSelected(i));
          });
          updateDeleteBtn();
          return;
        }
        // 普通点击：单选并设置为当前模板
        TemplateEditor.clearTemplateSelection();
        document.querySelectorAll('.template-item').forEach(t => t.classList.remove('selected'));
        div.classList.add('selected');
        TemplateEditor.selectTemplate(idx);
        lastSelectedIdx = idx;

        // 预适配模板（跨图组导入）
        if (cachedTemplateIdx !== idx) {
          cachedAdaptedTemplate = await prepareTemplateForPlacement(tpl);
          cachedTemplateIdx = idx;
        }

        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('btn-template').classList.add('active');
        Editor.setTool('template');
        updateStatus('已选中模板: ' + tpl.name + '，点击地图放置');
        updateDeleteBtn();
      });
      list.appendChild(div);
    });

    updateDeleteBtn();
  }

  // 跨图组导入核心函数
  function imageDataEqual(a, b) {
    if (!a || !b) return false;
    if (a.width !== b.width || a.height !== b.height) return false;
    const ad = a.data, bd = b.data;
    if (ad.length !== bd.length) return false;
    for (let i = 0; i < ad.length; i++) {
      if (ad[i] !== bd[i]) return false;
    }
    return true;
  }

  async function prepareTemplateForPlacement(tpl) {
    if (!tpl.sourceGop || tpl.sourceGop === gopFileName) return tpl;

    const currentTiles = tiles;
    const currentMiniTiles = miniTiles;
    if (!currentTiles) return tpl;

    // 检查是否已在本图组中适配过
    if (tpl._adaptedFor === gopFileName) return tpl;

    const usedIds = new Set();
    for (const t of tpl.tiles) {
      if (t.layer0 >= 0) usedIds.add(t.layer0);
      if (t.layer1 > 0) usedIds.add(t.layer1 - 1);
    }

    const idMap = new Map();
    let importedCount = 0;
    for (const oldId of usedIds) {
      const cacheKey = tpl.sourceGop + ':' + oldId;
      if (crossGopImportMap.has(cacheKey)) {
        idMap.set(oldId, crossGopImportMap.get(cacheKey));
        continue;
      }

      if (currentTiles.length >= 512) {
        updateStatus('错误：图块数已达512上限，无法导入模板所需图块');
        return null;
      }

      // 优先从源 GOP 加载（确保使用当前色板），否则回退到模板缓存
      let sourceImage = null;
      let sourceGopData = gopCache[tpl.sourceGop];
      if (!sourceGopData && tpl.sourceGop !== gopFileName) {
        try {
          const pal = PaletteModule.getPalette();
          const gop = await GopLoader.load('./gop/' + tpl.sourceGop, pal);
          sourceGopData = { tiles: gop.tiles, miniTiles: gop.miniTiles };
          gopCache[tpl.sourceGop] = sourceGopData;
        } catch (e) {
          updateStatus('无法加载源图组 ' + tpl.sourceGop + '，回退到模板缓存');
        }
      }
      if (sourceGopData && oldId < sourceGopData.tiles.length) {
        sourceImage = sourceGopData.tiles[oldId];
      } else if (tpl.tileImages && tpl.tileImages[oldId]) {
        sourceImage = TemplateEditor.base64ToImageData(tpl.tileImages[oldId]);
      }

      if (!sourceImage) {
        idMap.set(oldId, oldId);
        continue;
      }

      currentTiles.push(sourceImage);
      currentMiniTiles.push(sourceImage); // 缩略图直接用原图
      const newId = currentTiles.length - 1;
      idMap.set(oldId, newId);
      crossGopImportMap.set(cacheKey, newId);
      importedCount++;
    }

    if (importedCount > 0) {
      buildTileGrid();
      updateStatus('已导入 ' + importedCount + ' 个新图块到当前图组');
    }

    const newTiles = tpl.tiles.map(t => ({
      ...t,
      layer0: t.layer0 >= 0 ? (idMap.get(t.layer0) ?? t.layer0) : -1,
      layer1: t.layer1 > 0 ? ((idMap.get(t.layer1 - 1) ?? (t.layer1 - 1)) + 1) : 0
    }));
    return { ...tpl, tiles: newTiles, sourceGop: gopFileName, _adaptedFor: gopFileName };
  }

  let cachedAdaptedTemplate = null;
  let cachedTemplateIdx = -1;

  function invalidateTemplateCache() {
    cachedAdaptedTemplate = null;
    cachedTemplateIdx = -1;
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
    // 单选时：隐藏创建模板按钮，显示单个属性行
    document.getElementById('attr-row-template').style.display = 'none';
    document.querySelectorAll('.attr-row-single').forEach(el => el.style.display = '');
    document.getElementById('btn-apply-attr').style.display = '';

    const showL0 = Editor.getShowL0();
    const showL1 = Editor.getShowL1();

    document.getElementById('attr-image0').value = MapModule.getTileImage(x, y, 0);
    document.getElementById('attr-image1').value = MapModule.getTileImage(x, y, 1);
    document.getElementById('attr-height0').value = MapModule.getTileHeight(x, y, 0);
    document.getElementById('attr-height1').value = MapModule.getTileHeight(x, y, 1);
    document.getElementById('attr-barrier').checked = MapModule.getTileBarrier(x, y);

    // 根据图层显示状态控制属性行可见性
    document.getElementById('attr-image0').closest('.attr-row-single').style.display = showL0 ? '' : 'none';
    document.getElementById('attr-image1').closest('.attr-row-single').style.display = showL1 ? '' : 'none';
    document.getElementById('attr-height0').closest('.attr-row-single').style.display = showL0 ? '' : 'none';
    document.getElementById('attr-height1').closest('.attr-row-single').style.display = showL1 ? '' : 'none';
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

  function saveMapAs() {
    const buffer = MapModule.saveMap();
    const name = prompt('请输入另存为的文件名（不含扩展名）：', mapFileName || 'map0001');
    if (!name) return;
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    a.click(); URL.revokeObjectURL(url);
    isModified = false; updateStatus('地图已另存为: ' + name);
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
    init, fillGopSelect, fillMapSelect, fillPaletteSelect, loadGopByName, loadMapByName,
    buildTileGrid, refreshTemplateList,
    updateStatus, updateStatusPos, updateMapStatus, updateZoomDisplay, updatePropertyPanel, updatePropertyPanelMulti,
    getTiles, getMiniTiles, getPreviewTemplate, getPreviewPos, isMapModified, setMapModified,
    getGopFileName: () => gopFileName
  };
})();
