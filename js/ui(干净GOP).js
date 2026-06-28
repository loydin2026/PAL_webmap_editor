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

  // ========== SSS 二进制打包工具 ==========
  function packEventObjects(events) {
    const buf = new ArrayBuffer(events.length * 32);
    const dv = new DataView(buf);
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const off = i * 32;
      dv.setUint16(off,      ev.vanishTime        || 0, true);
      dv.setUint16(off + 2,  ev.pixelX            || 0, true);
      dv.setUint16(off + 4,  ev.pixelY            || 0, true);
      dv.setUint16(off + 6,  ev.layer             || 0, true);
      dv.setUint16(off + 8,  ev.triggerScript     || 0, true);
      dv.setUint16(off + 10, ev.autoScript         || 0, true);
      dv.setUint16(off + 12, ev.objStatus          || 0, true);
      dv.setUint16(off + 14, ev.triggerMethod      || 0, true);
      dv.setUint16(off + 16, ev.image              || 0, true);
      dv.setUint16(off + 18, ev.frames             || 0, true);
      dv.setUint16(off + 20, ev.direction          || 0, true);
      dv.setUint16(off + 22, ev.currFrame          || 0, true);
      dv.setUint16(off + 24, ev.scrJmpCount        || 0, true);
      dv.setUint16(off + 26, ev.imagePtrOffset     || 0, true);
      dv.setUint16(off + 28, ev.framesAuto         || 0, true);
      dv.setUint16(off + 30, ev.scrJmpCountAuto    || 0, true);
    }
    return new Uint8Array(buf);
  }

  function packSceneEntries(scenes) {
    const buf = new ArrayBuffer(scenes.length * 8);
    const dv = new DataView(buf);
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const off = i * 8;
      dv.setUint16(off,     sc.mapID        || 0, true);
      dv.setUint16(off + 2, sc.scriptEnter  || 0, true);
      dv.setUint16(off + 4, sc.scriptLeave  || 0, true);
      dv.setUint16(off + 6, sc.firstEventID || 0, true);
    }
    return new Uint8Array(buf);
  }

  function enmkf(subfiles) {
    const n = subfiles.length;
    const headerSize = (n + 1) * 4;
    const offsets = [headerSize];
    let current = headerSize;
    for (const sf of subfiles) {
      current += sf.length;
      offsets.push(current);
    }
    const headerBuf = new ArrayBuffer(headerSize);
    const dv = new DataView(headerBuf);
    for (let i = 0; i < offsets.length; i++) {
      dv.setUint32(i * 4, offsets[i], true);
    }
    const parts = [new Uint8Array(headerBuf)];
    for (const sf of subfiles) {
      parts.push(sf instanceof Uint8Array ? sf : new Uint8Array(sf));
    }
    const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLen);
    let pos = 0;
    for (const p of parts) {
      result.set(p, pos);
      pos += p.length;
    }
    return result;
  }

  function tileToPalPixel(tx, ty) {
    return {
      pixelX: tx * 16,
      pixelY: ty * 16 + ((tx & 1) * 8)
    };
  }

  function convertEventToSss(ev) {
    const pos = tileToPalPixel(ev.x, ev.y);
    return {
      vanishTime: ev.vanishTime || 0,
      pixelX: pos.pixelX,
      pixelY: pos.pixelY,
      layer: ev.layer || 0,
      triggerScript: ev.triggerScript || 0,
      autoScript: ev.autoScript || 0,
      objStatus: ev.objStatus || 0,
      triggerMethod: ev.triggerMethod || 0,
      image: ev.image || 0,
      frames: ev.frames || 0,
      direction: ev.direction || 0,
      currFrame: ev.currFrame || 0,
      scrJmpCount: ev.scrJmpCount || 0,
      imagePtrOffset: ev.imagePtrOffset || 0,
      framesAuto: ev.framesAuto || 0,
      scrJmpCountAuto: ev.scrJmpCountAuto || 0
    };
  }

  function buildSssFromEditor(exportAll) {
    const events = Editor.getEvents();
    if (events.length === 0) return null;

    const num = mapFileName.match(/(\d+)/);
    const mapId = num ? parseInt(num[1]) : 0;

    if (!exportAll) {
      // 只导出当前场景
      return {
        version: 1,
        source: "SSS.MKF",
        scenes: [{
          sceneID: 0,
          mapID: mapId,
          scriptEnter: 0,
          scriptLeave: 0,
          firstEventID: 0,
          events: events.map(ev => convertEventToSss(ev))
        }]
      };
    }

    // 导出全部：未改动的场景保持原样，当前场景原地更新
    if (!sssJsonData || !sssJsonData.scenes || !Array.isArray(sssJsonData.scenes)) {
      return buildSssFromEditor(false);
    }

    const outputData = JSON.parse(JSON.stringify(sssJsonData));
    const sceneIdx = outputData.scenes.findIndex(s => s.mapID === mapId);

    if (sceneIdx < 0) {
      // 当前地图不在原始数据中，追加新场景
      const newSceneId = outputData.scenes.length > 0
        ? Math.max(...outputData.scenes.map(s => s.sceneID)) + 1
        : 0;
      outputData.scenes.push({
        sceneID: newSceneId,
        mapID: mapId,
        scriptEnter: 0,
        scriptLeave: 0,
        firstEventID: 0,
        events: events.map(ev => convertEventToSss(ev))
      });
    } else {
      const scene = outputData.scenes[sceneIdx];
      const originalEvents = scene.events || [];

      // 按 originalIdx 分组编辑器事件
      const modifiedMap = new Map();
      const addedEvents = [];
      for (const ev of events) {
        if (ev.originalIdx !== undefined) {
          modifiedMap.set(ev.originalIdx, ev);
        } else {
          addedEvents.push(ev);
        }
      }

      // 重建场景事件：保留未改动的、替换已改动的、追加新增的
      const newEvents = [];
      for (let i = 0; i < originalEvents.length; i++) {
        if (modifiedMap.has(i)) {
          newEvents.push(convertEventToSss(modifiedMap.get(i)));
        } else {
          newEvents.push(originalEvents[i]);
        }
      }
      for (const ev of addedEvents) {
        newEvents.push(convertEventToSss(ev));
      }
      scene.events = newEvents;
    }

    // 重新计算所有场景的 firstEventID 和事件 id
    outputData.scenes.sort((a, b) => a.sceneID - b.sceneID);
    let nextEventId = 0;
    for (const sc of outputData.scenes) {
      sc.firstEventID = nextEventId;
      for (let i = 0; i < sc.events.length; i++) {
        sc.events[i].id = nextEventId + i;
        sc.events[i].sceneID = sc.sceneID;
        sc.events[i].mapID = sc.mapID;
      }
      nextEventId += sc.events.length;
    }
    return outputData;
  }

  function sssToMkf(sssData) {
    const scenes = [...sssData.scenes].sort((a, b) => a.sceneID - b.sceneID);
    const allEvents = [];
    const rebuiltScenes = [];
    for (const sc of scenes) {
      const events = sc.events || [];
      const firstId = allEvents.length;
      rebuiltScenes.push({
        sceneID: sc.sceneID,
        mapID: sc.mapID || 0,
        scriptEnter: sc.scriptEnter || 0,
        scriptLeave: sc.scriptLeave || 0,
        firstEventID: firstId
      });
      allEvents.push(...events);
    }
    const eventsData = packEventObjects(allEvents);
    const scenesData = packSceneEntries(rebuiltScenes);

    // 如果加载过原始 SSS.MKF，保留所有原始子文件，只替换前两个
    if (sssMkfSubfiles && sssMkfSubfiles.length > 2) {
      const newSubfiles = [...sssMkfSubfiles];
      newSubfiles[0] = eventsData;
      newSubfiles[1] = scenesData;
      return enmkf(newSubfiles);
    }
    return enmkf([eventsData, scenesData]);
  }

  // ========== 导出范围选择对话框 ==========
  function showExportDialog(title, options) {
    return new Promise((resolve) => {
      const dialog = document.getElementById('export-dialog');
      const titleEl = document.getElementById('export-dialog-title');
      const bodyEl = document.getElementById('export-dialog-options');
      const closeBtn = document.getElementById('export-dialog-close');

      if (!dialog || !titleEl || !bodyEl) { resolve(null); return; }

      titleEl.textContent = title;
      bodyEl.innerHTML = '';

      // 生成选项按钮
      options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.textContent = opt.label;
        if (opt.secondary) btn.className = 'secondary';
        btn.addEventListener('click', () => {
          dialog.classList.add('hidden');
          resolve(opt.value);
        });
        bodyEl.appendChild(btn);
      });

      // 取消按钮
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = '取消';
      cancelBtn.className = 'cancel';
      cancelBtn.addEventListener('click', () => {
        dialog.classList.add('hidden');
        resolve(null);
      });
      bodyEl.appendChild(cancelBtn);

      // 关闭按钮
      const onClose = () => {
        dialog.classList.add('hidden');
        resolve(null);
      };
      closeBtn.onclick = onClose;

      // 点击背景关闭
      dialog.onclick = (e) => {
        if (e.target === dialog) onClose();
      };

      dialog.classList.remove('hidden');
    });
  }

  // ========== SSS.MKF 二进制解析 ==========
  function demkf(data) {
    const dv = new DataView(data);
    if (data.byteLength < 4) return [];
    const headerSize = dv.getUint32(0, true);
    if (headerSize < 8 || headerSize > data.byteLength || headerSize % 4 !== 0) return [];
    const count = headerSize / 4;
    const offsets = [];
    for (let i = 0; i < count; i++) {
      offsets.push(dv.getUint32(i * 4, true));
    }
    const files = [];
    for (let i = 0; i < offsets.length - 1; i++) {
      const start = offsets[i];
      const end = offsets[i + 1];
      if (start > data.byteLength) {
        files.push(new Uint8Array(0));
        continue;
      }
      files.push(new Uint8Array(data.slice(start, Math.min(end, data.byteLength))));
    }
    const lastStart = offsets[offsets.length - 1];
    if (lastStart < data.byteLength) {
      files.push(new Uint8Array(data.slice(lastStart)));
    }
    return files;
  }

  function parseEventObjects(data) {
    const objects = [];
    if (data.byteLength < 32) return objects;
    const count = Math.floor(data.byteLength / 32);
    const dv = new DataView(data);
    for (let i = 0; i < count; i++) {
      const off = i * 32;
      objects.push({
        id: i,
        vanishTime: dv.getUint16(off, true),
        pixelX: dv.getUint16(off + 2, true),
        pixelY: dv.getUint16(off + 4, true),
        layer: dv.getUint16(off + 6, true),
        triggerScript: dv.getUint16(off + 8, true),
        autoScript: dv.getUint16(off + 10, true),
        objStatus: dv.getUint16(off + 12, true),
        triggerMethod: dv.getUint16(off + 14, true),
        image: dv.getUint16(off + 16, true),
        frames: dv.getUint16(off + 18, true),
        direction: dv.getUint16(off + 20, true),
        currFrame: dv.getUint16(off + 22, true),
        scrJmpCount: dv.getUint16(off + 24, true),
        imagePtrOffset: dv.getUint16(off + 26, true),
        framesAuto: dv.getUint16(off + 28, true),
        scrJmpCountAuto: dv.getUint16(off + 30, true)
      });
    }
    return objects;
  }

  function parseSceneEntries(data) {
    const entries = [];
    if (data.byteLength < 8) return entries;
    const count = Math.floor(data.byteLength / 8);
    const dv = new DataView(data);
    for (let i = 0; i < count; i++) {
      const off = i * 8;
      entries.push({
        sceneID: i,
        mapID: dv.getUint16(off, true),
        scriptEnter: dv.getUint16(off + 2, true),
        scriptLeave: dv.getUint16(off + 4, true),
        firstEventID: dv.getUint16(off + 6, true)
      });
    }
    return entries;
  }

  function buildSceneEvents(scenes, events) {
    const result = [];
    for (const scene of scenes) {
      const scene_id = scene.sceneID;
      const first_id = scene.firstEventID;
      let next_first = null;
      for (const s of scenes) {
        if (s.sceneID === scene_id + 1) {
          next_first = s.firstEventID;
          break;
        }
      }
      const scene_events = [];
      if (first_id < events.length) {
        const end_id = next_first !== null ? next_first : events.length;
        for (let i = first_id; i < Math.min(end_id, events.length); i++) {
          const ev = { ...events[i] };
          ev.sceneID = scene_id;
          ev.mapID = scene.mapID;
          scene_events.push(ev);
        }
      }
      result.push({ ...scene, events: scene_events });
    }
    return result;
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

  // SSS JSON 缓存（按场景分组的事件数据）
  let sssJsonData = null;

  // 原始 SSS.MKF 子文件缓存（用于导出时保留未修改的子文件）
  let sssMkfSubfiles = null;

  // 跨图组图块导入去重缓存：key = `${sourceGop}:${oldId}`, value = newId in current GOP
  const crossGopImportMap = new Map();

  // 模板预览状态
  let previewTemplate = null;
  let previewPos = null;

  function autoLoadSssMkf() {
    fetch('SSS.MKF')
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then(async (buffer) => {
        try {
          const subfiles = demkf(buffer);
          if (subfiles.length < 2) return;
          sssMkfSubfiles = subfiles;
          const events = parseEventObjects(subfiles[0].buffer);
          const scenes = parseSceneEntries(subfiles[1].buffer);
          const sceneEvents = buildSceneEvents(scenes, events);
          sssJsonData = { version: 1, source: 'SSS.MKF', scenes: sceneEvents };
          const maxId = events.length > 0 ? Math.max(...events.map(ev => ev.id)) : -1;
          Editor.setNextEventId(maxId + 1);

          const num = mapFileName.match(/(\d+)/);
          const mapId = num ? parseInt(num[1]) : -1;
          let matchedScene = null;
          if (mapId >= 0) {
            matchedScene = sceneEvents.find(s => s.mapID === mapId);
          }
          if (!matchedScene) {
            matchedScene = sceneEvents.find(s => s.mapID > 0 && (s.events || []).length > 0);
          }
          if (matchedScene) {
            const convertedEvents = (matchedScene.events || []).map((ev, idx) => {
              if (typeof ev.pixelX === 'number' && typeof ev.pixelY === 'number') {
                if (ev.pixelX === 0 && ev.pixelY === 0) return null;
                const tile = MapModule.pixelToTile(ev.pixelX * 2, ev.pixelY * 2);
                return { ...ev, x: tile.x, y: tile.y, originalIdx: idx };
              }
              return ev;
            }).filter(ev => ev !== null);
            Editor.setEvents(convertedEvents);
            updateEventList();
            updateStatus('已自动加载 SSS.MKF：场景 #' + matchedScene.sceneID + ' 的 ' + convertedEvents.length + ' 个事件');
            isModified = true;
          }
        } catch (err) {
          console.error('自动加载 SSS.MKF 失败:', err);
        }
      })
      .catch(err => {
        console.error('SSS.MKF 未找到或加载失败:', err);
      });
  }

  function init() {
    // 注册 tile 快照/恢复给撤销系统
    Editor.setTileSnapshotProvider(snapshotTiles);
    Editor.setTileRestoreProvider(restoreTiles);

    bindToolbar();
    bindCanvasEvents();
    bindPropertyPanel();
    bindFileInput();
    bindSelects();
    bindDrawers();
    bindTabs();
    bindCreateTemplateButton();
    bindTemplateActions();
    bindDraggablePanel();
    // 初始化左侧面板为图块/模板模式（默认工具是 select）
    updateLeftPanelVisibility('select');
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

function bindDraggablePanel() {
    const panel = document.getElementById('info-panel');
    const header = document.getElementById('drag-header');
	const closeBtn = document.getElementById('drag-close');
	if (!panel || !header) return;
	
	let isDragging = false;
	let startX = 0, startY = 0;
	let initialLeft = 0, initialTop = 0;
	
	header.addEventListener('mousedown', (e) => {
		isDragging = true;
		startX = e.clientX;
		startY = e.clientY;
		const rect = panel.getBoundingClientRect();
		const parentRect = panel.parentElement.getBoundingClientRect();
		initialLeft = rect.left - parentRect.left;
		initialTop = rect.top - parentRect.top;
		panel.style.transition = 'none';
		});

	document.addEventListener('mousemove', (e) => {
		if (!isDragging) return;
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		panel.style.left = (initialLeft + dx) + 'px';
		panel.style.top = (initialTop + dy) + 'px';
		panel.style.right = 'auto';
		});
		
		document.addEventListener('mouseup', () => {
			if (isDragging) {
				isDragging = false;
				panel.style.transition = '';
				}
				});
				
	    if (closeBtn) {
			closeBtn.addEventListener('click', () => {
				panel.style.display = 'none';
				});
			}
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

  function bindTabs() {
    document.querySelectorAll('#tile-tabs-header .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#tile-tabs-header .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.getElementById('tab-content-tile').classList.toggle('hidden', tab !== 'tile');
        document.getElementById('tab-content-template').classList.toggle('hidden', tab !== 'template');
      });
    });
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
    // 1. 先提取对应的 GOP 编号并预加载，避免切换地图后图块数据不匹配导致花屏
    const num = name.match(/(\d+)/);
    let gopLoaded = false;
    if (num) {
      const gopName = 'gop' + num[1].padStart(4, '0');
      if (gopList.includes(gopName) && gopFileName !== gopName) {
        await loadGopByName(gopName);
        gopLoaded = true;
      }
    }

    // 2. 加载地图数据
    if (mapCache[name]) {
      MapModule.loadMap(mapCache[name]);
      isModified = false; mapFileName = name;
      Editor.clearUndoRedo();
      updateStatus('已切换地图: ' + name);
    } else {
      try {
        const response = await fetch('./map/' + name);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const buffer = await response.arrayBuffer();
        mapCache[name] = buffer;
        MapModule.loadMap(buffer);
        isModified = false; mapFileName = name;
        Editor.clearUndoRedo();
        updateStatus('地图已加载: ' + name);
      } catch (e) {
        console.error('加载 MAP 失败:', name, e);
        updateStatus('加载地图失败: ' + name);
        return;
      }
    }

    // 3. 统一更新 UI 状态与渲染
    updateMapStatus();
    Renderer.renderMiniMap(miniTiles);
    const mapSelect = document.getElementById('map-select');
    if (mapSelect) mapSelect.value = name;

    // 4. 如果已加载 SSS JSON，尝试自动匹配当前地图的场景
    if (sssJsonData && sssJsonData.scenes) {
      const num = name.match(/(\d+)/);
      const mapId = num ? parseInt(num[1]) : -1;
      if (mapId >= 0) {
        const matchedScene = sssJsonData.scenes.find(s => s.mapID === mapId);
        if (matchedScene) {
          const convertedEvents = (matchedScene.events || []).map(ev => {
            if (typeof ev.pixelX === 'number' && typeof ev.pixelY === 'number') {
              if (ev.pixelX === 0 && ev.pixelY === 0) return null;
              // SSS 使用 16 像素/tile 的原始游戏坐标，需转换为 32 像素/tile
              const tile = MapModule.pixelToTile(ev.pixelX * 2, ev.pixelY * 2);
              return { ...ev, x: tile.x, y: tile.y };
            }
            return ev;
          }).filter(ev => ev !== null);
          Editor.setEvents(convertedEvents);
          updateEventList();
          updateStatus('地图 ' + name + ' 自动匹配场景 #' + matchedScene.sceneID + ' (' + convertedEvents.length + ' 事件)');
        } else {
          Editor.clearEvents();
          updateEventList();
        }
      }
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
        // 切换事件工具时更新属性面板显示
        updatePropertyPanelVisibility(tool);
        updateLeftPanelVisibility(tool);
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

    document.getElementById('chk-view-barrier').addEventListener('change', (e) => {
      Editor.setShowBarrier(e.target.checked);
    });
    document.getElementById('chk-view-object').addEventListener('change', (e) => {
      Editor.setShowObject(e.target.checked);
    });
    document.getElementById('chk-view-event').addEventListener('change', (e) => {
      Editor.setShowEvents(e.target.checked);
    });
    document.getElementById('chk-view-grid').addEventListener('change', (e) => {
      Editor.setShowGrid(e.target.checked);
    });
    document.getElementById('chk-view-event-char').addEventListener('change', (e) => {
      const checked = e.target.checked;
      Editor.setShowEventChar(checked);
      if (checked) {
        // 按需加载当前地图中所有事件人物的当前方向 char 帧
        const events = Editor.getEvents();
        for (const ev of events) {
          if (ev.image > 0) {
            let suffix;
            if (ev.frames === 0) {
              // frames=0 时固定显示第 1 帧（id-1），不播放动画
              suffix = 1;
            } else {
              const dir = Math.max(0, ev.direction);
              const effectiveFrames = Math.max(1, ev.frames);
              const frame = Math.max(0, Math.min(ev.currFrame || 0, effectiveFrames - 1));
              suffix = dir * effectiveFrames + frame + 1;
            }
            Editor.loadCharImage(ev.image, suffix);
          }
        }
      }
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
    document.getElementById('btn-export-gop-mkf').addEventListener('click', exportGopToMkf);
    document.getElementById('btn-export-map-mkf').addEventListener('click', exportMapToMkf);
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
      // 事件复制
      if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        if (Editor.copyEvent()) {
          updateStatus('已复制事件 #' + Editor.getSelectedEventId());
        } else {
          updateStatus('没有可复制的事件（请先选中一个事件）');
        }
      }
      // 事件粘贴
      if (e.ctrlKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        if (!Editor.hasCopiedEvent()) {
          updateStatus('剪贴板为空，先 Ctrl+C 复制一个事件');
          return;
        }
        const mouseTile = Editor.getMouseTile();
        const tx = mouseTile.x >= 0 ? mouseTile.x : (Editor.getSelTile().x >= 0 ? Editor.getSelTile().x : 0);
        const ty = mouseTile.y >= 0 ? mouseTile.y : (Editor.getSelTile().y >= 0 ? Editor.getSelTile().y : 0);
        if (!MapModule.assert(tx, ty)) {
          updateStatus('无法粘贴到无效位置');
          return;
        }
        Editor.pushUndo();
        const newId = Editor.pasteEvent(tx, ty);
        if (newId !== null) {
          Editor.setSelectedEventId(newId);
          updateEventPropertyPanel(Editor.getEvent(newId));
          updateEventList();
          isModified = true;
          updateStatus('已粘贴事件 #' + newId + ' 到 (' + tx + ',' + ty + ')');
        } else {
          updateStatus('粘贴失败');
        }
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

    // 事件导入（支持纯事件数组和 SSS 场景格式）
    const eventImportBtn = document.getElementById('btn-import-events');
    const eventImportInput = document.getElementById('event-import-input');
    if (eventImportBtn && eventImportInput) {
      eventImportBtn.addEventListener('click', () => eventImportInput.click());
      eventImportInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const data = JSON.parse(reader.result);
            
            // 格式1: SSS JSON (包含 scenes 数组)
            if (data.scenes && Array.isArray(data.scenes)) {
              // 存储 SSS JSON 数据供地图切换时自动匹配
              sssJsonData = data;
              
              // 询问加载哪个场景，或自动匹配当前地图
              const mapNum = mapFileName.match(/(\d+)/);
              const mapId = mapNum ? parseInt(mapNum[1]) : -1;
              
              // 尝试匹配当前地图
              let matchedScene = null;
              if (mapId >= 0) {
                matchedScene = data.scenes.find(s => s.mapID === mapId);
              }
              
              // 转换事件坐标（pixelX/pixelY → tile x/y）
              function convertSssEvent(ev, idx) {
                if (typeof ev.pixelX === 'number' && typeof ev.pixelY === 'number') {
                  // 过滤无效事件（像素坐标为 0,0 的可能是未设置位置的事件）
                  if (ev.pixelX === 0 && ev.pixelY === 0) return null;
                  // SSS 使用 16 像素/tile 的原始游戏坐标，需转换为 32 像素/tile
                  const tile = MapModule.pixelToTile(ev.pixelX * 2, ev.pixelY * 2);
                  return {
                    ...ev,
                    x: tile.x,
                    y: tile.y,
                    originalIdx: idx
                  };
                }
                return ev;
              }
              
              if (matchedScene) {
                const convertedEvents = (matchedScene.events || []).map((ev, idx) => convertSssEvent(ev, idx)).filter(ev => ev !== null);
                Editor.setEvents(convertedEvents);
                updateEventList();
                updateStatus('已加载场景 #' + matchedScene.sceneID + ' 的 ' + convertedEvents.length + ' 个事件');
                isModified = true;
              } else {
                // 列出有事件的非空场景供选择（限制前 30 个）
                const nonEmptyScenes = data.scenes.filter(s => s.mapID > 0 && (s.events || []).length > 0).slice(0, 30);
                const sceneList = nonEmptyScenes.map(s => 
                  '场景 #' + s.sceneID + ' (mapID=' + s.mapID + ', 事件=' + (s.events || []).length + ')'
                ).join('\n');
                const totalScenes = data.scenes.filter(s => s.mapID > 0 && (s.events || []).length > 0).length;
                const hint = totalScenes > 30 ? '（共 ' + totalScenes + ' 个场景，仅显示前 30 个）' : '';
                const sceneId = prompt('当前地图未匹配到场景，请手动选择场景ID:\n' + sceneList + '\n' + hint + '\n\n输入场景ID:');
                if (sceneId !== null) {
                  const scene = data.scenes.find(s => s.sceneID === parseInt(sceneId));
                  if (scene && scene.events) {
                    const convertedEvents = scene.events.map((ev, idx) => convertSssEvent(ev, idx)).filter(ev => ev !== null);
                    Editor.setEvents(convertedEvents);
                    updateEventList();
                    updateStatus('已加载场景 #' + scene.sceneID + ' 的 ' + convertedEvents.length + ' 个事件');
                    isModified = true;
                  } else {
                    alert('无效的场景ID');
                  }
                }
              }
              return;
            }
            
            // 格式2: 纯事件数组
            if (Array.isArray(data.events)) {
              Editor.setEvents(data.events);
              updateEventList();
              updateStatus('已导入 ' + data.events.length + ' 个事件');
              isModified = true;
            } else {
              alert('无效的事件文件格式');
            }
          } catch (err) {
            alert('导入失败: ' + err.message);
          }
        };
        reader.readAsText(file);
        eventImportInput.value = '';
      });
    }

    // 加载原始 SSS.MKF 二进制文件
    const loadMkfBtn = document.getElementById('btn-load-mkf');
    const mkfLoadInput = document.getElementById('mkf-load-input');
    if (loadMkfBtn && mkfLoadInput) {
      loadMkfBtn.addEventListener('click', () => mkfLoadInput.click());
      mkfLoadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const buffer = await file.arrayBuffer();
          const subfiles = demkf(buffer);
          if (subfiles.length < 2) {
            alert('SSS.MKF 子文件数量不足（需要至少2个）');
            return;
          }
          sssMkfSubfiles = subfiles;

          // 解析事件和场景（假设 subfile 0 = events, subfile 1 = scenes）
          const events = parseEventObjects(subfiles[0].buffer);
          const scenes = parseSceneEntries(subfiles[1].buffer);
          const sceneEvents = buildSceneEvents(scenes, events);

          sssJsonData = {
            version: 1,
            source: file.name,
            scenes: sceneEvents
          };

          // 尝试匹配当前地图
          const num = mapFileName.match(/(\d+)/);
          const mapId = num ? parseInt(num[1]) : -1;
          let matchedScene = null;
          if (mapId >= 0) {
            matchedScene = sceneEvents.find(s => s.mapID === mapId);
          }

          function convertSssEvent(ev, idx) {
            if (typeof ev.pixelX === 'number' && typeof ev.pixelY === 'number') {
              if (ev.pixelX === 0 && ev.pixelY === 0) return null;
              const tile = MapModule.pixelToTile(ev.pixelX * 2, ev.pixelY * 2);
              return { ...ev, x: tile.x, y: tile.y, originalIdx: idx };
            }
            return ev;
          }

          if (matchedScene) {
            const convertedEvents = (matchedScene.events || []).map((ev, idx) => convertSssEvent(ev, idx)).filter(ev => ev !== null);
            Editor.setEvents(convertedEvents);
            updateEventList();
            updateStatus('已加载 SSS.MKF：场景 #' + matchedScene.sceneID + ' 的 ' + convertedEvents.length + ' 个事件（共 ' + subfiles.length + ' 个子文件）');
            isModified = true;
          } else {
            // 列出有事件的非空场景供选择
            const nonEmptyScenes = sceneEvents.filter(s => s.mapID > 0 && (s.events || []).length > 0).slice(0, 30);
            const sceneList = nonEmptyScenes.map(s =>
              '场景 #' + s.sceneID + ' (mapID=' + s.mapID + ', 事件=' + (s.events || []).length + ')'
            ).join('\n');
            const totalScenes = sceneEvents.filter(s => s.mapID > 0 && (s.events || []).length > 0).length;
            const hint = totalScenes > 30 ? '（共 ' + totalScenes + ' 个场景，仅显示前 30 个）' : '';
            const sceneId = prompt('当前地图未匹配到场景，请手动选择场景ID:\n' + sceneList + '\n' + hint + '\n\n输入场景ID:');
            if (sceneId !== null) {
              const scene = sceneEvents.find(s => s.sceneID === parseInt(sceneId));
              if (scene && scene.events) {
                const convertedEvents = scene.events.map((ev, idx) => convertSssEvent(ev, idx)).filter(ev => ev !== null);
                Editor.setEvents(convertedEvents);
                updateEventList();
                updateStatus('已加载 SSS.MKF：场景 #' + scene.sceneID + ' 的 ' + convertedEvents.length + ' 个事件（共 ' + subfiles.length + ' 个子文件）');
                isModified = true;
              } else {
                alert('无效的场景ID');
              }
            }
          }
        } catch (err) {
          alert('加载 SSS.MKF 失败: ' + err.message);
        }
        mkfLoadInput.value = '';
      });
    }

    // 事件导出（SSS-compatible JSON 格式）
    const eventExportBtn = document.getElementById('btn-export-events');
    if (eventExportBtn) {
      eventExportBtn.addEventListener('click', async () => {
        const scope = await showExportDialog('导出事件 JSON', [
          { label: '🗂️  导出全部场景（含未改动）', value: 'all' },
          { label: '📍 只导出当前地图场景', value: 'current' },
        ]);
        if (!scope) return;
        const exportAll = scope === 'all';
        const outputData = buildSssFromEditor(exportAll);
        if (!outputData) {
          updateStatus('没有事件可导出');
          return;
        }
        const blob = new Blob([JSON.stringify(outputData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (mapFileName || 'events') + (exportAll ? '.sss.json' : '.scene.json');
        a.click();
        URL.revokeObjectURL(url);
        const totalEvents = outputData.scenes.reduce((sum, s) => sum + (s.events || []).length, 0);
        updateStatus('已导出 JSON（' + (exportAll ? '全部' : '当前地图') + '）：' + totalEvents + ' 个事件，' + outputData.scenes.length + ' 个场景');
      });
    }

    // 事件导出 MKF 二进制（浏览器内直接生成 SSS.MKF）
    const eventExportMkfBtn = document.getElementById('btn-export-mkf');
    if (eventExportMkfBtn) {
      eventExportMkfBtn.addEventListener('click', async () => {
        const scope = await showExportDialog('导出事件 MKF', [
          { label: '🗂️  导出全部场景（含未改动）', value: 'all' },
          { label: '📍 只导出当前地图场景', value: 'current' },
        ]);
        if (!scope) return;
        const exportAll = scope === 'all';
        const outputData = buildSssFromEditor(exportAll);
        if (!outputData) {
          updateStatus('没有事件可导出');
          return;
        }
        try {
          const mkfData = sssToMkf(outputData);
          const blob = new Blob([mkfData], { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = (mapFileName || 'SSS') + (exportAll ? '.mkf' : '.scene.mkf');
          a.click();
          URL.revokeObjectURL(url);
          const totalEvents = outputData.scenes.reduce((sum, s) => sum + (s.events || []).length, 0);
          updateStatus('已导出 MKF（' + (exportAll ? '全部' : '当前地图') + '）：' + totalEvents + ' 个事件，' + outputData.scenes.length + ' 个场景，' + mkfData.length + ' 字节');
        } catch (err) {
          console.error('导出 MKF 失败:', err);
          updateStatus('导出 MKF 失败: ' + err.message);
        }
      });
    }

    // 导出地图（抽屉按钮）
    const mapExportBtn = document.getElementById('btn-export-map');
    if (mapExportBtn) {
      mapExportBtn.addEventListener('click', async () => {
        const scope = await showExportDialog('导出地图', [
          { label: '📍 导出当前地图', value: 'current' },
        ]);
        if (!scope) return;
        const buffer = MapModule.saveMap();
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = mapFileName || 'map0001';
        a.click();
        URL.revokeObjectURL(url);
        isModified = false;
        updateStatus('地图已导出: ' + (mapFileName || 'map0001'));
      });
    }

    // 导出图块集（抽屉按钮，使用对话框）
    const exportGopBtn = document.getElementById('btn-export-gop');
    if (exportGopBtn) {
      exportGopBtn.addEventListener('click', async () => {
        if (!tiles || tiles.length === 0) {
          updateStatus('当前没有图块集可导出');
          return;
        }
        const scope = await showExportDialog('导出图块集', [
          { label: '📍 导出当前图块集', value: 'current' },
        ]);
        if (!scope) return;
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
          a.download = gopFileName || 'gop0001';
          a.click();
          URL.revokeObjectURL(url);
          updateStatus('图块集已导出: ' + (gopFileName || 'gop0001') + ' (' + tiles.length + ' 图块)');
        } catch (err) {
          updateStatus('图块集导出失败: ' + err.message);
        }
      });
    }
    // 属性面板显示/隐藏
    const togglePanelBtn = document.getElementById('btn-toggle-panel');
    if (togglePanelBtn) {
      togglePanelBtn.addEventListener('click', () => {
        const panel = document.getElementById('info-panel');
        if (panel) {
          const isVisible = panel.style.display !== 'none';
          panel.style.display = isVisible ? 'none' : 'block';
          togglePanelBtn.classList.toggle('active', !isVisible);
          updateStatus(isVisible ? '属性面板已隐藏' : '属性面板已显示');
        }
      });
    }
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

      // Ctrl+点击：开始框选（加选模式，不清除之前选择）
      if (e.ctrlKey && !e.shiftKey) {
        Editor.startBoxSelect(tile.x, tile.y, 'add');
        return;
      }

      // Ctrl+Shift+点击：toggle 框选（已选取消，未选添加）
      if (e.ctrlKey && e.shiftKey) {
        Editor.startBoxSelect(tile.x, tile.y, 'toggle');
        return;
      }

      // Shift+点击：toggle 单点
      if (e.shiftKey && !e.ctrlKey) {
        Editor.toggleSelTile(tile.x, tile.y);
        updatePropertyPanelMulti();
        updateStatus('Toggle: ' + tile.x + ',' + tile.y + ' (已选 ' + Editor.getSelectedTileCount() + ' 个)');
        return;
      }

      // 普通点击/拖动：记录起点，不立即执行（SELECT 工具延迟到 mouseup 判定）
      Editor.setIsMouseDown(true);
      Editor.setMouseDownPos(e.clientX, e.clientY, tile.x, tile.y);

      if (Editor.getTool() !== Editor.TOOLS.SELECT) {
        // 非 SELECT 工具：立即执行单选和操作

        if (Editor.getTool() === Editor.TOOLS.EVENT) {
          // 事件工具：放置事件
          const existing = Editor.findEventAt(tile.x, tile.y);
          if (existing) {
            // 选中已有事件
            Editor.setSelectedEventId(existing.id);
            updateEventPropertyPanel(existing);
            updateEventList();
            updateStatus('选中事件 #' + existing.id + ' at ' + tile.x + ',' + tile.y);
          } else {
            // 新建事件
            Editor.pushUndo();
            const id = Editor.addEvent({ x: tile.x, y: tile.y });
            Editor.setSelectedEventId(id);
            updateEventPropertyPanel(Editor.getEvent(id));
            updateEventList();
            isModified = true;
            updateStatus('添加事件 #' + id + ' at ' + tile.x + ',' + tile.y);
          }
          return;
        }

        Editor.setSelTile(tile.x, tile.y);
        updatePropertyPanel(tile.x, tile.y);

        if (Editor.getTool() === Editor.TOOLS.TEMPLATE) {
          const tpl = TemplateEditor.getSelected();
          if (tpl) {
            (async () => {
              Editor.pushUndo();
              const adapted = await prepareTemplateForPlacement(tpl);
              if (!adapted) return;
              const baseParity = (adapted.baseParity !== undefined ? adapted.baseParity : 0) & 1;
              const destParity = tile.x & 1;
              const centerX = Math.floor(adapted.w / 2);
              const centerY = Math.floor(adapted.h / 2);
              const effectiveDestParity = (destParity - (centerX & 1) + 2) & 1;

              // 计算中心 tile 会被补偿多少，预偏移所有 tile 使中心 tile 精确落在鼠标位置
              let centerComp = 0;
              if (baseParity !== effectiveDestParity) {
                const centerAbsParity = (baseParity + centerX) & 1;
                if (centerAbsParity === effectiveDestParity) {
                  centerComp = effectiveDestParity - baseParity;
                }
              }

              for (const t of adapted.tiles) {
                let tx = tile.x + t.x - centerX;
                let ty = tile.y + t.y - centerY - centerComp;
                if (baseParity !== effectiveDestParity) {
                  const absParity = (baseParity + t.x) & 1;
                  if (absParity === effectiveDestParity) {
                    ty += (effectiveDestParity - baseParity);
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
      if (!e.deltaY || !Number.isFinite(e.deltaY)) return;
      Editor.setZoom(Editor.getZoom() + (e.deltaY > 0 ? -0.5 : 0.5));
      updateZoomDisplay();
    }, { passive: false });

    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const tile = Editor.screenToTile(e.clientX, e.clientY);
      Editor.setSelTile(tile.x, tile.y);
      updatePropertyPanel(tile.x, tile.y);
    });

    // 小地图点击定位
    const minimapCanvas = document.getElementById('minimap-canvas');
    if (minimapCanvas) {
      minimapCanvas.addEventListener('click', (e) => {
        const rect = minimapCanvas.getBoundingClientRect();
        const nx = (e.clientX - rect.left) / rect.width;
        const ny = (e.clientY - rect.top) / rect.height;
        const tx = Math.max(0, Math.min(Math.floor(nx * MapModule.MAP_WIDTH), MapModule.MAP_WIDTH - 1));
        const ty = Math.max(0, Math.min(Math.floor(ny * MapModule.MAP_HEIGHT), MapModule.MAP_HEIGHT - 1));
        Editor.setCamera(tx, ty);
        updateStatus('小地图定位到 (' + tx + ',' + ty + ')');
      });
    }
  }

  function computeBoxSelection(canvas) {
    const state = Editor.getBoxSelectState();
    if (!state) return;

    const sx = state.startTile.x;
    const sy = state.startTile.y;
    const ex = state.currentTile.x;
    const ey = state.currentTile.y;

    // 将 tile 坐标变换到等距轴对齐坐标 (u, v)
    // 使得框选两个点形成的矩形在视觉坐标中等距轴对齐
    function toUV(tx, ty) {
      const parity = tx & 1;
      return {
        u: (tx + 2 * ty + 2 + parity) >> 1,
        v: (tx - 2 * ty - parity) >> 1
      };
    }

    const startUV = toUV(sx, sy);
    const endUV = toUV(ex, ey);

    const minU = Math.min(startUV.u, endUV.u);
    const maxU = Math.max(startUV.u, endUV.u);
    const minV = Math.min(startUV.v, endUV.v);
    const maxV = Math.max(startUV.v, endUV.v);

    const boxTiles = new Set();

    for (let u = minU; u <= maxU; u++) {
      for (let v = minV; v <= maxV; v++) {
        const tx = u + v - 1;
        const ty = (u - v - 1 - (tx & 1)) >> 1;
        if (tx >= 0 && tx < MapModule.MAP_WIDTH && ty >= 0 && ty < MapModule.MAP_HEIGHT) {
          boxTiles.add(tx + ',' + ty);
        }
      }
    }

    // 根据模式应用
    if (state.mode === 'add') {
      // 实时跟随：恢复基础选择 + 当前框选区域，超出范围的 tile 自动移除
      Editor.clearSelTiles();
      Editor.getBoxSelectBaseTiles().forEach(k => {
        const [x, y] = k.split(',').map(Number);
        Editor.addSelTile(x, y);
      });
      boxTiles.forEach(k => {
        const [x, y] = k.split(',').map(Number);
        Editor.addSelTile(x, y);
      });
    } else if (state.mode === 'toggle') {
      boxTiles.forEach(k => {
        const [x, y] = k.split(',').map(Number);
        Editor.toggleSelTile(x, y);
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

    // 事件属性应用
    const eventInputs = [
      'attr-event-trigger-script',
      'attr-event-auto-script',
      'attr-event-trigger-method',
      'attr-event-image',
      'attr-event-frames',
      'attr-event-direction',
      'attr-event-status',
      'attr-event-vanish'
    ];
    eventInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', applyEventProperties);
      }
    });
  }

  function applyEventProperties() {
    const id = Editor.getSelectedEventId();
    if (id < 0) return;
    const ev = Editor.getEvent(id);
    if (!ev) return;

    const updates = {
      triggerScript: parseInt(document.getElementById('attr-event-trigger-script').value) || 0,
      autoScript: parseInt(document.getElementById('attr-event-auto-script').value) || 0,
      triggerMethod: parseInt(document.getElementById('attr-event-trigger-method').value) || 0,
      image: parseInt(document.getElementById('attr-event-image').value) || 0,
      frames: (() => {
        const v = parseInt(document.getElementById('attr-event-frames').value);
        return isNaN(v) ? 1 : v;
      })(),
      direction: parseInt(document.getElementById('attr-event-direction').value) || 0,
      objStatus: parseInt(document.getElementById('attr-event-status').value) || 0,
      vanishTime: parseInt(document.getElementById('attr-event-vanish').value) || 0,
    };

    Editor.pushUndo();
    Editor.updateEvent(id, updates);
    isModified = true;
    updateEventList();
    updateStatus('事件 #' + id + ' 属性已更新');

    // 图像或方向变化时，预加载当前方向的所有 char 帧
    if (updates.image > 0) {
      if (ev.image !== updates.image || ev.frames !== updates.frames || ev.direction !== updates.direction) {
        if (updates.frames === 0) {
          // frames=0 时只加载第 1 帧
          Editor.loadCharImage(updates.image, 1);
        } else {
          const effectiveFrames = Math.max(1, updates.frames);
          for (let i = 0; i < effectiveFrames; i++) {
            const suffix = updates.direction * effectiveFrames + i + 1;
            Editor.loadCharImage(updates.image, suffix);
          }
        }
      }
    }
  }

  function updateLeftPanelVisibility(tool) {
    const tabHeader = document.getElementById('tile-tabs-header');
    const tabContentTile = document.getElementById('tab-content-tile');
    const tabContentTemplate = document.getElementById('tab-content-template');
    const eventSection = document.getElementById('event-section');
    if (!tabHeader || !tabContentTile || !tabContentTemplate || !eventSection) return;

    if (tool === 'event') {
      tabHeader.style.display = 'none';
      tabContentTile.classList.add('hidden');
      tabContentTemplate.classList.add('hidden');
      eventSection.classList.remove('hidden');
    } else {
      tabHeader.style.display = '';
      eventSection.classList.add('hidden');
      if (tool === 'template') {
        tabContentTile.classList.add('hidden');
        tabContentTemplate.classList.remove('hidden');
        document.querySelectorAll('#tile-tabs-header .tab-btn').forEach(b => b.classList.remove('active'));
        const tplTab = document.querySelector('#tile-tabs-header .tab-btn[data-tab="template"]');
        if (tplTab) tplTab.classList.add('active');
      } else {
        tabContentTile.classList.remove('hidden');
        tabContentTemplate.classList.add('hidden');
        document.querySelectorAll('#tile-tabs-header .tab-btn').forEach(b => b.classList.remove('active'));
        const tileTab = document.querySelector('#tile-tabs-header .tab-btn[data-tab="tile"]');
        if (tileTab) tileTab.classList.add('active');
      }
    }
  }

  function updatePropertyPanelVisibility(tool) {
    const eventGroup = document.getElementById('attr-group-event');
    const layerGroup = document.querySelectorAll('.attr-group')[1]; // 图层组
    const barrierGroup = document.querySelectorAll('.attr-group')[2]; // 障碍组

    if (tool === 'event') {
      if (eventGroup) eventGroup.style.display = '';
      if (layerGroup) layerGroup.style.display = 'none';
      if (barrierGroup) barrierGroup.style.display = 'none';
    } else {
      if (eventGroup) eventGroup.style.display = 'none';
      if (layerGroup) layerGroup.style.display = '';
      if (barrierGroup) barrierGroup.style.display = '';
    }
  }

  function updateEventPropertyPanel(ev) {
    if (!ev) {
      document.getElementById('attr-event-id').textContent = '-1';
      document.getElementById('attr-xy').textContent = '-1, -1';
      return;
    }
    document.getElementById('attr-event-id').textContent = ev.id;
    document.getElementById('attr-xy').textContent = ev.x + ', ' + ev.y;
    document.getElementById('attr-event-trigger-script').value = ev.triggerScript;
    document.getElementById('attr-event-auto-script').value = ev.autoScript;
    document.getElementById('attr-event-trigger-method').value = ev.triggerMethod;
    document.getElementById('attr-event-image').value = ev.image;
    document.getElementById('attr-event-frames').value = ev.frames;
    document.getElementById('attr-event-direction').value = ev.direction;
    document.getElementById('attr-event-status').value = ev.objStatus;
    document.getElementById('attr-event-vanish').value = ev.vanishTime;
  }

  function updateEventList() {
    const list = document.getElementById('event-list');
    if (!list) return;
    list.innerHTML = '';
    const events = Editor.getEvents();
    if (events.length === 0) {
      list.innerHTML = '<div class="event-empty">暂无事件</div>';
      return;
    }
    events.forEach(ev => {
      const div = document.createElement('div');
      div.className = 'event-item' + (ev.id === Editor.getSelectedEventId() ? ' selected' : '');
      div.dataset.id = ev.id;
      div.innerHTML = '<span class="event-item-id">#' + ev.id + '</span>' +
        '<span class="event-item-pos">(' + ev.x + ',' + ev.y + ')</span>' +
        '<span class="event-item-script">S:' + ev.triggerScript + '</span>';
      div.addEventListener('click', () => {
        Editor.setSelectedEventId(ev.id);
        updateEventPropertyPanel(ev);
        updateEventList();
        // 将相机居中到事件位置
        const canvas = document.getElementById('map-canvas');
        if (canvas) {
          const zoom = Editor.getZoom();
          const visibleTilesX = Math.floor(canvas.width / (32 * zoom));
          const visibleTilesY = Math.floor(canvas.height / (16 * zoom));
          Editor.setCamera(ev.x - Math.floor(visibleTilesX / 2), ev.y - Math.floor(visibleTilesY / 4));
        }
        updateStatus('选中事件 #' + ev.id);
      });
      div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (confirm('删除事件 #' + ev.id + ' ?')) {
          Editor.pushUndo();
          Editor.removeEvent(ev.id);
          updateEventList();
          updateEventPropertyPanel(null);
          isModified = true;
          updateStatus('已删除事件');
        }
      });
      list.appendChild(div);
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
        deleteBtn.textContent = selectedCount > 0 ? '❌ 删除选中 (' + selectedCount + ')' : '❌ 删除选中';
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
      const baseParity = (tpl.baseParity !== undefined ? tpl.baseParity : 0) & 1;
      // 使用等距坐标计算所有 tile 的像素范围，确保缩略图排列正确
      let minPx = Infinity, minPy = Infinity, maxPx = -Infinity, maxPy = -Infinity;
      tpl.tiles.forEach(t => {
        const p = MapModule.tileToPixel(t.x + baseParity, t.y);
        minPx = Math.min(minPx, p.x); minPy = Math.min(minPy, p.y);
        maxPx = Math.max(maxPx, p.x); maxPy = Math.max(maxPy, p.y);
      });
      const cx = (minPx + maxPx) / 2;
      const cy = (minPy + maxPy) / 2;
      const offX = 48 - cx;
      const offY = 32 - cy;
      tpl.tiles.forEach(t => {
        const p = MapModule.tileToPixel(t.x + baseParity, t.y);
        const px = offX + p.x - 32;  // tileToPixel 返回中心，drawTileImage 需要左上角
        const py = offY + p.y - 16;
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

        // 预适配模板（只缓存选中模板，不导入图块，导入延迟到放置时）
        if (cachedTemplateIdx !== idx) {
          cachedAdaptedTemplate = tpl;
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

  function snapshotTiles() {
    if (!tiles || !miniTiles) return null;
    return {
      tiles: tiles.map(img => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height)),
      miniTiles: miniTiles.map(img => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height))
    };
  }

  function restoreTiles(snapshot) {
    if (!snapshot) return;
    tiles.length = 0;
    miniTiles.length = 0;
    snapshot.tiles.forEach(img => tiles.push(img));
    snapshot.miniTiles.forEach(img => miniTiles.push(img));
    // 清除跨图组导入缓存，因为图块已恢复旧状态，旧的映射全部失效
    crossGopImportMap.clear();
    // 清除模板适配缓存，下次应用时需要重新适配
    cachedAdaptedTemplate = null;
    cachedTemplateIdx = -1;
    // 刷新图块面板
    buildTileGrid();
    // 刷新小地图
    Renderer.renderMiniMap(miniTiles);
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

    // 如果当前格子有事件，显示事件属性
    const ev = Editor.findEventAt(x, y);
    const eventGroup = document.getElementById('attr-group-event');
    if (ev && eventGroup) {
      eventGroup.style.display = '';
      Editor.setSelectedEventId(ev.id);
      updateEventPropertyPanel(ev);
      updateEventList();
    } else if (eventGroup) {
      eventGroup.style.display = 'none';
      Editor.setSelectedEventId(-1);
    }
  }

  let mapFileHandle = null; // File System Access API 文件句柄

  function saveMapFile() {
    const buffer = MapModule.saveMap();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });

    (async () => {
      // 如果已持有文件句柄，直接覆盖
      if (mapFileHandle && typeof mapFileHandle.createWritable === 'function') {
        try {
          const writable = await mapFileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          isModified = false;
          updateStatus('地图已保存');
          return;
        } catch (e) {
          console.warn('文件句柄失效:', e);
          mapFileHandle = null;
        }
      }

      // 尝试使用 File System Access API
      try {
        if (window.showSaveFilePicker) {
          const handle = await window.showSaveFilePicker({
            suggestedName: mapFileName || 'map0001',
            types: [{ description: 'MAP 文件', accept: { 'application/octet-stream': ['.map', ''] } }]
          });
          mapFileHandle = handle;
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          isModified = false;
          updateStatus('地图已保存');
          return;
        }
      } catch (e) {
        if (e.name === 'AbortError') return; // 用户取消
        console.warn('File System Access API 不可用，回退到下载方式:', e);
        // 继续执行下载方式
      }

      // 回退到传统下载方式
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = mapFileName || 'map0001';
      a.click(); URL.revokeObjectURL(url);
      isModified = false;
      updateStatus('地图已保存');
    })();
  }

  function saveMapAs() {
    const buffer = MapModule.saveMap();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });

    (async () => {
      try {
        if (window.showSaveFilePicker) {
          const handle = await window.showSaveFilePicker({
            suggestedName: mapFileName || 'map0001',
            types: [{ description: 'MAP 文件', accept: { 'application/octet-stream': ['.map', ''] } }]
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          mapFileHandle = handle; // 另存为后更新当前文件句柄
          isModified = false;
          updateStatus('地图已另存为');
          return;
        }
      } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('File System Access API 不可用，回退到下载方式:', e);
      }

      // 回退到传统下载方式
      const name = prompt('请输入另存为的文件名（不含扩展名）：', mapFileName || 'map0001');
      if (!name) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      a.click(); URL.revokeObjectURL(url);
      isModified = false;
      updateStatus('地图已另存为: ' + name);
    })();
  }

  // 将目录中所有 GOP 文件打包为 MKF（导出当前编辑状态，含跨组导入的新图块）
  async function exportGopToMkf() {
    if (!gopList || gopList.length === 0) {
      updateStatus('没有 GOP 文件可导出');
      return;
    }
    updateStatus('正在打包 GOP.MKF...');
    try {
      const palette = PaletteModule.getPalette();
      const subfiles = [];
      for (const name of gopList) {
        if (gopCache[name] && gopCache[name].tiles) {
          // 已加载到内存，重新编码（包含跨组导入的新图块）
          const encoded = GopLoader.encodeGOP(gopCache[name].tiles, palette);
          subfiles.push(new Uint8Array(encoded));
        } else {
          // 未加载过，直接使用原始文件
          const res = await fetch('./gop/' + name);
          if (!res.ok) {
            console.warn('GOP 文件获取失败:', name);
            subfiles.push(new Uint8Array(0));
            continue;
          }
          const buf = await res.arrayBuffer();
          let data = new Uint8Array(buf);
          // 检测并去掉外部工具（如旧版 cut.exe）添加的 4 字节长度前缀
          if (data.length > 4) {
            const dv = new DataView(data.buffer, data.byteOffset, 4);
            const prefixLen = dv.getUint32(0, true);
            if (prefixLen === data.length - 4) {
              data = new Uint8Array(data.slice(4));
            }
          }
          subfiles.push(data);
        }
      }
      // 兼容 cut.c/mak.c 工具链：最后一个子文件设为空（不写入数据）
      if (subfiles.length > 0) {
        subfiles[subfiles.length - 1] = new Uint8Array(0);
      }

      const mkfData = enmkf(subfiles);
      const blob = new Blob([mkfData], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'GOP.MKF';
      a.click(); URL.revokeObjectURL(url);
      updateStatus('GOP.MKF 已导出 (' + gopList.length + ' 个子文件, 最后一个为空以兼容 cut.c, 含当前编辑状态)');
    } catch (e) {
      console.error('导出 GOP.MKF 失败:', e);
      updateStatus('导出 GOP.MKF 失败: ' + e.message);
    }
  }

  // 将目录中所有 MAP 文件打包为 MKF（导出当前编辑状态，跳过全 0 空占位符，使用 YJ1 压缩）
  async function exportMapToMkf() {
    if (!mapList || mapList.length === 0) {
      updateStatus('没有 MAP 文件可导出');
      return;
    }
    console.log('exportMapToMkf: mapList=', mapList.length, 'items:', mapList);
    updateStatus('正在打包 MAP.MKF...');
    try {
      const subfiles = [];
      let skipped = 0;
      let compressedCount = 0;
      let totalRaw = 0;
      let totalCompressed = 0;
      for (const name of mapList) {
        let buffer;
        let source = '';
        if (name === mapFileName) {
          // 当前正在编辑的地图，导出内存中的最新状态
          buffer = new Uint8Array(MapModule.saveMap());
          source = 'memory';
        } else if (mapCache[name]) {
          // 已加载过但当前不是编辑状态，使用缓存
          buffer = new Uint8Array(mapCache[name]);
          source = 'cache';
        } else {
          // 未加载过，直接使用原始文件
          const url = './map/' + name;
          console.log('exportMapToMkf: fetching', url);
          const res = await fetch(url);
          if (!res.ok) {
            console.warn('MAP 文件获取失败:', name, 'status=', res.status);
            subfiles.push(new Uint8Array(0));
            continue;
          }
          buffer = new Uint8Array(await res.arrayBuffer());
          source = 'fetch';
        }
        // 统一 MAP 数据大小：标准 PAL MAP 为 65536 字节，旧文件可能包含 templateData 为 131072 字节
        const MAP_STANDARD_SIZE = 128 * 128 * 2 * 2; // 65536
        if (buffer.length > MAP_STANDARD_SIZE) {
          console.log('exportMapToMkf:', name, 'truncating', buffer.length, '->', MAP_STANDARD_SIZE, '(removing templateData)');
          buffer = buffer.slice(0, MAP_STANDARD_SIZE);
        }
        console.log('exportMapToMkf:', name, 'source=', source, 'length=', buffer.length, 'first4=', Array.from(buffer.slice(0, 4)));

        // 跳过全 0 的空占位符（原始 MKF 中很多子文件是 0 字节占位符）
        if (buffer.length > 0 && buffer.every(b => b === 0)) {
          console.log('exportMapToMkf:', name, 'skipped (all zeros)');
          skipped++;
          subfiles.push(new Uint8Array(0)); // 保持索引位置一致
        } else if (buffer.length > 0) {
          // 使用 YJ1 压缩
          totalRaw += buffer.length;
          const compressed = YJ1Compress.compress(buffer);
          totalCompressed += compressed.length;
          compressedCount++;
          console.log('exportMapToMkf:', name, 'compressed', buffer.length, '->', compressed.length);
          subfiles.push(compressed);
        } else {
          console.log('exportMapToMkf:', name, 'empty buffer');
          subfiles.push(new Uint8Array(0));
        }
      }
      // 兼容 cut.c/mak.c 工具链：最后一个子文件设为空（不写入数据）
      if (subfiles.length > 0) {
        subfiles[subfiles.length - 1] = new Uint8Array(0);
      }

      console.log('exportMapToMkf: subfiles count=', subfiles.length, 'compressed=', compressedCount, 'skipped=', skipped);
      const mkfData = enmkf(subfiles);
      const blob = new Blob([mkfData], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'MAP.MKF';
      a.click(); URL.revokeObjectURL(url);
      const ratio = totalRaw > 0 ? Math.round((1 - totalCompressed / totalRaw) * 100) : 0;
      updateStatus('MAP.MKF 已导出 (' + mapList.length + ' 个子文件, 压缩 ' + compressedCount + ' 个, 最后一个为空以兼容 cut.c, 压缩率 ' + ratio + '%)');
    } catch (e) {
      console.error('导出 MAP.MKF 失败:', e);
      updateStatus('导出 MAP.MKF 失败: ' + e.message);
    }
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
    getGopFileName: () => gopFileName,
    autoLoadSssMkf
  };
})();
