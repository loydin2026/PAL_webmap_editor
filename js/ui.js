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

      // 重建场景事件：保留未改动的、替换已改动的、追加新增的；已删除的事件不再保留
      const newEvents = [];
      for (let i = 0; i < originalEvents.length; i++) {
        if (modifiedMap.has(i)) {
          newEvents.push(convertEventToSss(modifiedMap.get(i)));
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

    // 如果事件总数变化了，自动修复脚本中的事件引用
    const oldTotal = sssJsonData.scenes.reduce((sum, s) => sum + (s.events || []).length, 0);
    const newTotal = outputData.scenes.reduce((sum, s) => sum + (s.events || []).length, 0);
    if (oldTotal !== newTotal && typeof SssScriptLoader !== 'undefined' && SssScriptLoader.isLoaded()) {
      const currentScene = sssJsonData.scenes.find(s => s.mapID === mapId);
      if (currentScene) {
        const oldSceneCount = (currentScene.events || []).length;
        const newScene = outputData.scenes.find(s => s.mapID === mapId);
        const newSceneCount = (newScene.events || []).length;
        const delta = newSceneCount - oldSceneCount;
        if (delta !== 0) {
          const insertIndex = currentScene.firstEventID + oldSceneCount;
          SssScriptLoader.fixEventReferences(insertIndex, delta);
          console.log('事件引用自动修复: insertIndex=' + insertIndex + ', delta=' + delta);
        }
      }
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
      // 如果脚本有修改，替换脚本子文件（索引4 = 第5个子文件）
      if (typeof SssScriptLoader !== 'undefined' && SssScriptLoader.isModified()) {
        const modifiedScript = SssScriptLoader.getModifiedData();
        if (modifiedScript) {
          newSubfiles[4] = new Uint8Array(modifiedScript);
          console.log('脚本数据已修改，导出时包含修改后的脚本');
        }
      }
      // 如果 M.MSG 有修改，更新索引子文件（索引3 = 第4个子文件）
      if (msgDataCache && msgDataCache.externalIndex && msgDataCache.indexRaw && msgDataCache.modified) {
        newSubfiles[3] = msgDataCache.indexRaw;
        console.log('M.MSG 索引已修改，导出时包含更新后的索引');
      }
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
          // 加载脚本数据到 SssScriptLoader（第5个子文件 = 索引4）
          if (subfiles.length > 4 && typeof SssScriptLoader !== 'undefined') {
            SssScriptLoader.load(subfiles[4].buffer);
            console.log('SSS 脚本数据已加载:', subfiles[4].buffer.byteLength, '字节');
          }
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
          // 自动加载 M.MSG 和 WORD.DAT
          autoLoadMsgAndWord();
          // SSS 数据已更新，清除缓存以便下次打开面板时重新构建
          sssDataCache = null;
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
    bindScriptEditor();
    bindSssDataPanel();
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
      gopCache[name] = {
        tiles: gop.tiles,
        miniTiles: gop.miniTiles,
        rawTileData: gop.rawTileData,
        modified: false
      };
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
              sssDataCache = null; // 清除缓存以便重新构建
              
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
          sssDataCache = null; // 清除缓存以便重新构建

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
        // MKF 导出必须包含所有场景，否则其他场景的数据会丢失
        const outputData = buildSssFromEditor(true);
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
          a.download = (mapFileName || 'SSS') + '.mkf';
          a.click();
          URL.revokeObjectURL(url);
          const totalEvents = outputData.scenes.reduce((sum, s) => sum + (s.events || []).length, 0);
          updateStatus('已导出 MKF（全部）：' + totalEvents + ' 个事件，' + outputData.scenes.length + ' 个场景，' + mkfData.length + ' 字节');
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
          let buffer;
          if (gopCache[gopFileName] && gopCache[gopFileName].rawTileData) {
            // 有原始 RLE 数据，直接拼接，不重新编码（字节级一致）
            buffer = GopLoader.encodeGOPFromRaw(gopCache[gopFileName].rawTileData);
          } else {
            // 没有原始数据，回退到重新编码
            buffer = GopLoader.encodeGOP(tiles, pal);
          }
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

    // 删除选中图块
    const deleteTileBtn = document.getElementById('btn-delete-tile');
    if (deleteTileBtn) {
      deleteTileBtn.addEventListener('click', deleteSelectedTile);
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
      'attr-event-vanish',
      'attr-event-frames-auto',
      'attr-event-scr-jmp-auto'
    ];
    eventInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', applyEventProperties);
      }
    });

    // 播放按钮
    const playBtn = document.getElementById('btn-event-play');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        const id = Editor.getSelectedEventId();
        if (id < 0) return;
        const ev = Editor.getEvent(id);
        if (!ev) return;
        ev.moving = !ev.moving;
        updateEventPropertyPanel(ev);
        updateStatus('事件 #' + id + (ev.moving ? ' 开始移动' : ' 停止移动'));
      });
    }

    // 事件ID选择（同一tile多个事件时切换）
    const idSelect = document.getElementById('attr-event-id');
    if (idSelect) {
      idSelect.addEventListener('change', () => {
        const newId = parseInt(idSelect.value);
        if (newId >= 0) {
          Editor.setSelectedEventId(newId);
          const ev = Editor.getEvent(newId);
          updateEventPropertyPanel(ev);
          updateEventList();
          updateStatus('选中事件 #' + newId);
        }
      });
    }

    // 脚本编辑按钮
    const editTriggerBtn = document.getElementById('btn-edit-trigger-script');
    if (editTriggerBtn) {
      editTriggerBtn.addEventListener('click', () => {
        const addr = parseInt(document.getElementById('attr-event-trigger-script').value) || 0;
        openScriptEditor(addr, '触发脚本');
      });
    }
    const editAutoBtn = document.getElementById('btn-edit-auto-script');
    if (editAutoBtn) {
      editAutoBtn.addEventListener('click', () => {
        const addr = parseInt(document.getElementById('attr-event-auto-script').value) || 0;
        openScriptEditor(addr, '自动脚本');
      });
    }
    // 新建脚本按钮
    const newTriggerBtn = document.getElementById('btn-new-trigger-script');
    if (newTriggerBtn) {
      newTriggerBtn.addEventListener('click', () => {
        if (typeof SssScriptLoader === 'undefined' || !SssScriptLoader.isLoaded()) {
          alert('脚本数据未加载，请先加载 SSS.MKF');
          return;
        }
        const newAddr = SssScriptLoader.createNewScript();
        if (newAddr < 0) {
          alert('创建新脚本失败');
          return;
        }
        document.getElementById('attr-event-trigger-script').value = newAddr;
        applyEventProperties();
        openScriptEditor(newAddr, '触发脚本（新）');
        updateStatus('已创建新触发脚本，地址: 0x' + newAddr.toString(16).toUpperCase());
      });
    }
    const newAutoBtn = document.getElementById('btn-new-auto-script');
    if (newAutoBtn) {
      newAutoBtn.addEventListener('click', () => {
        if (typeof SssScriptLoader === 'undefined' || !SssScriptLoader.isLoaded()) {
          alert('脚本数据未加载，请先加载 SSS.MKF');
          return;
        }
        const newAddr = SssScriptLoader.createNewScript();
        if (newAddr < 0) {
          alert('创建新脚本失败');
          return;
        }
        document.getElementById('attr-event-auto-script').value = newAddr;
        applyEventProperties();
        openScriptEditor(newAddr, '自动脚本（新）');
        updateStatus('已创建新自动脚本，地址: 0x' + newAddr.toString(16).toUpperCase());
      });
    }
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
    const idSelect = document.getElementById('attr-event-id');
    if (!ev) {
      idSelect.innerHTML = '<option value="-1">-1</option>';
      document.getElementById('attr-xy').textContent = '-1, -1';
      const playBtn = document.getElementById('btn-event-play');
      if (playBtn) {
        playBtn.textContent = '▶ 播放';
        playBtn.style.background = '#3498db';
      }
      return;
    }
    // 检查同一 tile 是否有多个事件
    const tileEvents = Editor.getEventsAtTile ? Editor.getEventsAtTile(ev.x, ev.y) : [ev];
    idSelect.innerHTML = '';
    if (tileEvents.length > 1) {
      for (const e of tileEvents) {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = '#' + e.id + ' (Layer=' + e.layer + ')';
        if (e.id === ev.id) opt.selected = true;
        idSelect.appendChild(opt);
      }
    } else {
      const opt = document.createElement('option');
      opt.value = ev.id;
      opt.textContent = String(ev.id);
      opt.selected = true;
      idSelect.appendChild(opt);
    }
    document.getElementById('attr-xy').textContent = ev.x + ', ' + ev.y;
    document.getElementById('attr-event-trigger-script').value = ev.triggerScript;
    document.getElementById('attr-event-auto-script').value = ev.autoScript;
    document.getElementById('attr-event-trigger-method').value = ev.triggerMethod;
    document.getElementById('attr-event-image').value = ev.image;
    document.getElementById('attr-event-frames').value = ev.frames;
    document.getElementById('attr-event-direction').value = ev.direction;
    document.getElementById('attr-event-status').value = ev.objStatus;
    const playBtn = document.getElementById('btn-event-play');
    if (playBtn) {
      playBtn.textContent = ev.moving ? '⏸ 暂停' : '▶ 播放';
      playBtn.style.background = ev.moving ? '#e74c3c' : '#3498db';
    }
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
        '<span class="event-item-script">S:' + ev.triggerScript + (ev.autoScript ? '/A:' + ev.autoScript : '') + '</span>';
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
        updateDeleteTileBtn();
      });
      grid.appendChild(div);
    }
    // 恢复选中状态
    const selectedId = Editor.getSelectedTile();
    if (selectedId >= 0 && selectedId < tiles.length) {
      const sel = grid.querySelector('.tile-thumb[data-id="' + selectedId + '"]');
      if (sel) sel.classList.add('selected');
    }
    updateDeleteTileBtn();
  }

  function updateDeleteTileBtn() {
    const btn = document.getElementById('btn-delete-tile');
    if (btn) {
      const id = Editor.getSelectedTile();
      if (id >= 0 && tiles && id < tiles.length) {
        btn.removeAttribute('disabled');
      } else {
        btn.setAttribute('disabled', 'disabled');
      }
    }
  }

  function deleteSelectedTile() {
    const id = Editor.getSelectedTile();
    if (id < 0 || !tiles || id >= tiles.length) {
      updateStatus('没有选中的图块可删除');
      return;
    }

    if (!confirm('确定要删除图块 ' + id + ' 吗？\n这会擦除地图中所有引用该图块的位置，并重新排列后续图块索引。')) {
      return;
    }

    // 记录撤销（保存当前地图和事件状态）
    Editor.pushUndo();

    // 从 GOP 缓存中删除
    const cache = gopCache[gopFileName];
    if (cache) {
      cache.tiles.splice(id, 1);
      cache.miniTiles.splice(id, 1);
      if (cache.rawTileData) cache.rawTileData.splice(id, 1);
      cache.modified = true;
      tiles = cache.tiles;
      miniTiles = cache.miniTiles;
    }

    // 更新地图中的图块索引
    MapModule.remapTileImage(id, -1);

    // 更新模板中的图块索引
    TemplateEditor.remapTileIds(id, -1);

    // 清除跨图组导入缓存（因为索引变了）
    crossGopImportMap.clear();
    // 清除模板适配缓存
    cachedAdaptedTemplate = null;
    cachedTemplateIdx = -1;

    // 清除选中状态
    Editor.setSelectedTile(-1);
    TemplateEditor.setSelectedTile(-1);
    document.getElementById('selected-tile-id').textContent = '-1';

    // 刷新图块面板
    buildTileGrid();

    // 刷新模板列表缩略图
    refreshTemplateList();

    // 触发重绘
    isModified = true;

    updateStatus('图块 ' + id + ' 已删除，地图和模板引用已更新');
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

    // 确保当前 GOP 缓存有 rawTileData
    if (!gopCache[gopFileName].rawTileData) {
      gopCache[gopFileName].rawTileData = [];
    }
    const currentRawTileData = gopCache[gopFileName].rawTileData;

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
      let sourceRawTile = null;
      let sourceGopData = gopCache[tpl.sourceGop];
      if (!sourceGopData && tpl.sourceGop !== gopFileName) {
        try {
          const pal = PaletteModule.getPalette();
          const gop = await GopLoader.load('./gop/' + tpl.sourceGop, pal);
          sourceGopData = {
            tiles: gop.tiles,
            miniTiles: gop.miniTiles,
            rawTileData: gop.rawTileData
          };
          gopCache[tpl.sourceGop] = sourceGopData;
        } catch (e) {
          updateStatus('无法加载源图组 ' + tpl.sourceGop + '，回退到模板缓存');
        }
      }
      if (sourceGopData && oldId < sourceGopData.tiles.length) {
        sourceImage = sourceGopData.tiles[oldId];
        if (sourceGopData.rawTileData && oldId < sourceGopData.rawTileData.length) {
          sourceRawTile = sourceGopData.rawTileData[oldId];
        }
      } else if (tpl.tileImages && tpl.tileImages[oldId]) {
        sourceImage = TemplateEditor.base64ToImageData(tpl.tileImages[oldId]);
      }

      if (!sourceImage) {
        idMap.set(oldId, oldId);
        continue;
      }

      currentTiles.push(sourceImage);
      currentMiniTiles.push(sourceImage); // 缩略图直接用原图
      // 同时复制原始 RLE 数据（导出时直接拼接，不重新编码）
      if (sourceRawTile) {
        const copy = new Uint8Array(sourceRawTile.length);
        copy.set(sourceRawTile);
        currentRawTileData.push(copy);
      } else {
        // 如果没有原始 RLE 数据（如从模板缓存加载），用空占位
        currentRawTileData.push(new Uint8Array(0));
      }
      const newId = currentTiles.length - 1;
      idMap.set(oldId, newId);
      crossGopImportMap.set(cacheKey, newId);
      importedCount++;
    }

    if (importedCount > 0) {
      buildTileGrid();
      updateStatus('已导入 ' + importedCount + ' 个新图块到当前图组');
      if (gopCache[gopFileName]) gopCache[gopFileName].modified = true;
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
        if (gopCache[name] && gopCache[name].modified) {
          // 已加载且被修改（跨组导入等），从原始 RLE 数据直接拼接，不重新编码
          const encoded = GopLoader.encodeGOPFromRaw(gopCache[name].rawTileData);
          let data = new Uint8Array(encoded);
          // 去掉 encodeGOPFromRaw 添加的 4 字节长度前缀（MKF 子文件不需要前缀）
          if (data.length > 4) {
            const prefix = new DataView(data.buffer).getUint32(0, true);
            if (prefix === data.length - 4) {
              data = data.slice(4);
            }
          }
          subfiles.push(data);
        } else {
         // 未修改或未被加载，直接使用原始文件(去掉可能的前缀）
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
            const prefix = new DataView(data.buffer).getUint32(0, true);
            if (prefix === data.length - 4) {
              console.log('exportGopToMkf:', name, 'stripping 4-byte prefix:', prefix);
              data = data.slice(4);
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

  // ======================== 脚本编辑器 ========================
  let scriptEditorUndoStack = [];
  let scriptEditorRedoStack = [];
  let currentScriptAddr = 0;

  function openScriptEditor(addr, titlePrefix) {
    if (typeof SssScriptLoader === 'undefined' || !SssScriptLoader.isLoaded()) {
      alert('脚本数据未加载，请先加载 SSS.MKF');
      return;
    }
    currentScriptAddr = addr;
    const modal = document.getElementById('script-editor-modal');
    const info = document.getElementById('script-editor-info');
    if (info) info.textContent = (titlePrefix ? titlePrefix + ' ' : '') + '脚本地址: 0x' + addr.toString(16).toUpperCase();
    renderScriptEditor(addr);
    scriptEditorUndoStack = [];
    scriptEditorRedoStack = [];
    modal.classList.remove('hidden');
  }

  function closeScriptEditor() {
    document.getElementById('script-editor-modal').classList.add('hidden');
  }

  function renderScriptEditor(addr) {
    const tbody = document.getElementById('script-editor-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const instructions = SssScriptLoader.parseScript(addr);
    if (instructions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7">无指令数据</td></tr>';
      return;
    }
    const scriptNames = SssScriptLoader.getScriptNames();
    // 生成下拉菜单选项
    const options = Object.entries(scriptNames).map(([hex, name]) => {
      const h = parseInt(hex);
      return '<option value="' + h + '">0x' + h.toString(16).toUpperCase().padStart(4, '0') + ' - ' + name + '</option>';
    }).join('');
    for (const inst of instructions) {
      const tr = document.createElement('tr');
      const name = SssScriptLoader.getScriptName(inst.cmd);
      const params = SssScriptLoader.getParamDesc(inst.cmd);
      const mkHex = (v) => '0x' + v.toString(16).toUpperCase().padStart(4, '0');
      const isCoordCmd = (cmd) => [0x10, 0x11, 0x44].includes(cmd);
      const mkParamCell = (val, field, label, paramIndex) => {
        const type = SssScriptLoader.getParamType(inst.cmd, paramIndex);
        const jumpAttr = type !== 'none' ? ' data-jump-type="' + type + '" data-jump-value="' + val + '"' : '';
        let extraHtml = '';
        if (type === 'face' && val >= 0) {
          extraHtml = '<img class="face-preview" src="face/' + val + '-1.png" alt="" onerror="this.style.display=\'none\'">';
        } else if (type === 'msg' && msgDataCache && val >= 0 && val < msgDataCache.count) {
          const text = msgDataCache.texts[val] || '';
          if (text) {
            extraHtml = '<span class="msg-preview" title="' + escapeHtml(text) + '">' + escapeHtml(text.substring(0, 20)) + (text.length > 20 ? '…' : '') + '</span>';
          }
        }
        // 坐标指令：显示转换后的真实坐标，方便编辑
        let displayVal = val;
        let coordHint = '';
        if (isCoordCmd(inst.cmd)) {
          if (field === 'p1') {
            displayVal = inst.p1 * 2 + inst.p3;
            coordHint = '<span class="coord-hint" style="color:#888;font-size:0.75rem;margin-left:4px" title="原始值: p1=' + inst.p1 + ', p3=' + inst.p3 + '">(X=' + displayVal + ')</span>';
          } else if (field === 'p3') {
            coordHint = '<span class="coord-hint" style="color:#888;font-size:0.75rem;margin-left:4px">(X%2=' + val + ')</span>';
          }
        }
        return '<td class="script-param-cell">' +
          '<div class="param-label" title="' + label + '">' + label + '</div>' +
          '<div class="param-row">' +
          '<input type="number" class="param-input" value="' + displayVal + '" data-field="' + field + '" data-offset="' + inst.offset + '"' + jumpAttr + '>' +
          '<button class="param-jump" data-type="' + type + '" data-value="' + val + '" data-field="' + field + '" data-offset="' + inst.offset + '"' + (type === 'none' ? ' style="display:none"' : '') + '>🔗</button>' +
          extraHtml + coordHint +
          '</div></td>';
      };
      // 操作按钮：插入 / 删除
      const actionsHtml = '<td class="col-actions">' +
        '<div class="script-actions">' +
        '<button class="btn-insert" data-offset="' + inst.offset + '" title="在此后插入指令">＋</button>' +
        '<button class="btn-delete" data-offset="' + inst.offset + '" title="删除此指令">－</button>' +
        '</div></td>';
      tr.innerHTML =
        actionsHtml +
        '<td class="col-offset">' + mkHex(inst.offset) + '</td>' +
        '<td><select class="hex script-cmd-select" data-field="cmd" data-offset="' + inst.offset + '">' + options + '</select></td>' +
        mkParamCell(inst.p1, 'p1', params.p1, 0) +
        mkParamCell(inst.p2, 'p2', params.p2, 1) +
        mkParamCell(inst.p3, 'p3', params.p3, 2) +
        '<td class="script-cmd-name">' + name + '</td>';
      tbody.appendChild(tr);
      // 设置select的选中值
      const sel = tr.querySelector('select[data-field="cmd"]');
      if (sel) sel.value = inst.cmd;
    }
    // 绑定输入框变化事件
    tbody.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', onScriptEditorChange);
    });
    tbody.querySelectorAll('select').forEach(sel => {
      sel.addEventListener('change', onScriptEditorChange);
    });
    // 绑定跳转按钮事件
    tbody.querySelectorAll('.param-jump').forEach(btn => {
      btn.addEventListener('click', onParamJump);
    });
    // 绑定插入/删除按钮事件
    tbody.querySelectorAll('.btn-insert').forEach(btn => {
      btn.addEventListener('click', onScriptEditorInsert);
    });
    tbody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', onScriptEditorDelete);
    });
    // 填充右侧参考表
    const refList = document.getElementById('script-cmd-ref-list');
    if (refList) {
      const sortedNames = Object.entries(scriptNames)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(([hex, name]) => {
          const h = parseInt(hex);
          return '<div class="ref-item"><span class="ref-hex">0x' + h.toString(16).toUpperCase().padStart(4, '0') + '</span><span class="ref-name">' + name + '</span></div>';
        }).join('');
      refList.innerHTML = sortedNames || '无指令数据';
    }
  }

  function onScriptEditorInsert(e) {
    const btn = e.target;
    const offset = parseInt(btn.dataset.offset);
    if (isNaN(offset)) return;
    // 保存旧状态用于撤销
    const oldInst = SssScriptLoader.getInstruction(offset);
    if (oldInst) {
      scriptEditorUndoStack.push({ offset, ...oldInst });
      if (scriptEditorUndoStack.length > 50) scriptEditorUndoStack.shift();
    }
    scriptEditorRedoStack = [];
    // 如果当前指令是 0000（结束指令），在 0000 之前插入新指令
    // 新插入的指令默认使用 0x0009（清屏等待）作为占位，避免插入 0000 导致 parseScript 提前终止
    if (oldInst && oldInst.cmd === 0) {
      SssScriptLoader.insertInstruction(offset, 0x0009, 0, 0, 0);
    } else {
      // 否则在当前指令之后插入新指令
      SssScriptLoader.insertInstruction(offset + 8, 0x0009, 0, 0, 0);
    }
    renderScriptEditor(currentScriptAddr);
  }

  function onScriptEditorDelete(e) {
    const btn = e.target;
    const offset = parseInt(btn.dataset.offset);
    if (isNaN(offset)) return;
    const oldInst = SssScriptLoader.getInstruction(offset);
    // 结束指令 0000 不能删除
    if (oldInst && oldInst.cmd === 0) {
      alert('结束指令不能删除');
      return;
    }
    if (!confirm('确定删除此指令？')) return;
    // 保存旧状态用于撤销
    if (oldInst) {
      scriptEditorUndoStack.push({ offset, ...oldInst });
      if (scriptEditorUndoStack.length > 50) scriptEditorUndoStack.shift();
    }
    scriptEditorRedoStack = [];
    SssScriptLoader.deleteInstruction(offset);
    renderScriptEditor(currentScriptAddr);
  }

  function onScriptEditorChange(e) {
    const inp = e.target;
    const field = inp.dataset.field;
    const offset = parseInt(inp.dataset.offset);
    const val = parseInt(inp.value, 10);
    if (isNaN(val)) {
      alert('无效的数值: ' + inp.value);
      return;
    }
    // 保存旧值用于撤销
    const oldInst = SssScriptLoader.getInstruction(offset);
    if (oldInst) {
      scriptEditorUndoStack.push({ offset, ...oldInst });
      if (scriptEditorUndoStack.length > 50) scriptEditorUndoStack.shift();
    }
    scriptEditorRedoStack = [];
    const newInst = { ...oldInst };
    newInst[field] = val;
    // 坐标指令特殊处理：p1 输入框显示的是真实 X，需转换回 p1/p3
    if (oldInst && [0x10, 0x11, 0x44].includes(oldInst.cmd) && field === 'p1') {
      newInst.p1 = Math.floor(val / 2);
      newInst.p3 = Math.abs(val % 2);
    }
    SssScriptLoader.setInstruction(offset, newInst.cmd, newInst.p1, newInst.p2, newInst.p3);
    renderScriptEditor(currentScriptAddr);
  }

  function onParamJump(e) {
    const btn = e.target;
    const type = btn.dataset.type;
    const value = parseInt(btn.dataset.value);
    if (isNaN(value)) return;
    switch (type) {
      case 'msg':
        openMsgSelector(parseInt(btn.dataset.offset), btn.dataset.field, value);
        break;
      case 'script':
        openScriptEditor(value);
        break;
      case 'event':
        // 未来可扩展：高亮对应事件
        alert('事件 #' + value + ' 的详细信息将在事件编辑器中显示（待实现）');
        break;
      case 'item':
        jumpToItem(value);
        break;
      case 'char':
        alert('角色 #' + value + '（可在对象编辑器中查看）');
        break;
      case 'scene':
        alert('场景 #' + value + '（可在场景列表中查看）');
        break;
      case 'music':
        alert('音乐 #' + value);
        break;
      case 'sfx':
        alert('音效 #' + value);
        break;
      case 'image':
        alert('图像 #' + value);
        break;
      case 'face':
        alert('头像 #' + value + '（已在旁边显示预览）');
        break;
      case 'direction':
        const dirs = ['下', '左', '上', '右'];
        alert('方向: ' + (dirs[value] || value));
        break;
      default:
        break;
    }
  }

  function jumpToMessage(msgId) {
    if (!msgDataCache) {
      alert('请先加载 M.MSG');
      return;
    }
    if (msgId < 0 || msgId >= msgDataCache.count) {
      alert('消息编号超出范围: ' + msgId);
      return;
    }
    // 打开SSS数据面板并切换到消息标签
    openSssDataPanel();
    // 关闭脚本编辑器（如果打开）
    closeScriptEditor();
    // 计算页码
    const PAGE = 100;
    const page = Math.floor(msgId / PAGE);
    const pager = document.getElementById('sss-msg-pager');
    if (pager) pager.dataset.page = page;
    // 先切换到消息标签
    switchSssDataTab('messages');
    // 渲染后高亮对应行
    setTimeout(() => {
      const rows = document.querySelectorAll('#sss-msg-table tr');
      for (const row of rows) {
        const colId = row.querySelector('.col-id');
        if (!colId) continue;
        const idx = parseInt(colId.textContent);
        if (idx === msgId) {
          row.style.background = '#2b3a2b';
          row.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // 闪烁效果
          let blink = 0;
          const interval = setInterval(() => {
            row.style.background = blink % 2 === 0 ? '#3a5a3a' : '#2b3a2b';
            blink++;
            if (blink > 5) clearInterval(interval);
          }, 300);
        } else {
          row.style.background = '';
        }
      }
    }, 100);
  }

  // ========== 消息选择器（用于脚本编辑器中选择消息编号） ==========
  let msgSelectorCallback = null; // { offset, field }

  function openMsgSelector(offset, field, currentValue) {
    if (!msgDataCache) {
      alert('请先加载 M.MSG');
      return;
    }
    msgSelectorCallback = { offset, field };
    const modal = document.getElementById('msg-selector-modal');
    const selectedEl = document.getElementById('msg-selector-selected');
    if (selectedEl) {
      selectedEl.textContent = currentValue >= 0 && currentValue < msgDataCache.count
        ? '#' + currentValue + ' ' + (msgDataCache.texts[currentValue] || '').substring(0, 30)
        : '无';
    }
    document.getElementById('msg-selector-search').value = '';
    renderMsgSelector('', currentValue);
    modal.classList.remove('hidden');
  }

  function closeMsgSelector() {
    document.getElementById('msg-selector-modal').classList.add('hidden');
    msgSelectorCallback = null;
  }

  function renderMsgSelector(filterText, selectedId) {
    const tbody = document.getElementById('msg-selector-tbody');
    if (!tbody || !msgDataCache) return;
    tbody.innerHTML = '';

    const texts = msgDataCache.texts;
    const count = msgDataCache.count;
    const PAGE = 100;

    // 收集匹配的消息索引
    let matched = [];
    if (filterText) {
      const lower = filterText.toLowerCase();
      for (let i = 0; i < count; i++) {
        const text = texts[i] || '';
        if (text.toLowerCase().indexOf(lower) !== -1 || String(i).indexOf(filterText) !== -1) {
          matched.push(i);
        }
      }
    } else {
      matched = Array.from({ length: count }, (_, i) => i);
    }

    // 如果搜索且结果很多，只显示前 200 条
    const showMatched = matched.length > 200 && filterText ? matched.slice(0, 200) : matched;

    // 分页（仅在非搜索模式下）
    let page = 0;
    if (!filterText) {
      const pager = document.getElementById('msg-selector-pager');
      if (pager && pager.dataset.page) page = parseInt(pager.dataset.page) || 0;
    }
    const totalPages = Math.ceil(showMatched.length / PAGE);
    if (page >= totalPages) page = Math.max(0, totalPages - 1);
    const start = page * PAGE;
    const end = Math.min(start + PAGE, showMatched.length);

    for (let i = start; i < end; i++) {
      const idx = showMatched[i];
      const tr = document.createElement('tr');
      const text = texts[idx] || '';
      const isSelected = idx === selectedId;
      tr.style.background = isSelected ? '#3a5a3a' : '';
      tr.innerHTML = '<td style="text-align:center"><input type="radio" name="msg-selector-radio" value="' + idx + '"' + (isSelected ? ' checked' : '') + '></td>' +
        '<td class="col-id">' + idx + '</td>' +
        '<td>' + escapeHtml(text.substring(0, 60)) + (text.length > 60 ? '…' : '') + '</td>';
      tr.addEventListener('click', () => {
        const radio = tr.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
        onMsgSelectorSelect(idx);
      });
      tbody.appendChild(tr);
    }

    // 分页控件（非搜索模式下）
    if (!filterText) {
      const pagerEl = document.getElementById('msg-selector-pager');
      if (pagerEl) {
        let html = '';
        if (totalPages > 1) {
          html += '<button ' + (page <= 0 ? 'disabled' : '') + ' data-page="' + (page - 1) + '">◀</button>';
          html += '<span>第 ' + (page + 1) + ' / ' + totalPages + ' 页</span>';
          html += '<button ' + (page >= totalPages - 1 ? 'disabled' : '') + ' data-page="' + (page + 1) + '">▶</button>';
        }
        html += '<span style="margin-left:12px">共 ' + count + ' 条</span>';
        pagerEl.innerHTML = html;
        pagerEl.querySelectorAll('button:not([disabled])').forEach(btn => {
          btn.addEventListener('click', () => {
            pagerEl.dataset.page = btn.dataset.page;
            renderMsgSelector('', selectedId);
          });
        });
      }
    }
  }

  function onMsgSelectorSelect(msgId) {
    const selectedEl = document.getElementById('msg-selector-selected');
    if (selectedEl) {
      const text = msgDataCache && msgDataCache.texts[msgId] ? msgDataCache.texts[msgId].substring(0, 30) : '';
      selectedEl.textContent = '#' + msgId + ' ' + text;
    }
    document.getElementById('msg-selector-ok-btn').disabled = false;
  }

  function onMsgSelectorConfirm() {
    const radios = document.querySelectorAll('input[name="msg-selector-radio"]:checked');
    if (!radios.length || !msgSelectorCallback) return;
    const msgId = parseInt(radios[0].value);
    const { offset, field } = msgSelectorCallback;

    // 更新脚本指令
    const oldInst = SssScriptLoader.getInstruction(offset);
    if (oldInst) {
      scriptEditorUndoStack.push({ offset, ...oldInst });
      if (scriptEditorUndoStack.length > 50) scriptEditorUndoStack.shift();
    }
    scriptEditorRedoStack = [];
    const newInst = { ...oldInst };
    newInst[field] = msgId;
    SssScriptLoader.setInstruction(offset, newInst.cmd, newInst.p1, newInst.p2, newInst.p3);
    renderScriptEditor(currentScriptAddr);
    closeMsgSelector();
    updateStatus('已选择消息 #' + msgId);
  }

  function addNewMessage() {
    if (!msgDataCache) return -1;
    const text = prompt('请输入新消息内容（留空则创建空消息）：', '');
    if (text === null) return -1; // 用户取消

    const idx = msgDataCache.count;
    msgDataCache.texts.push(text);
    msgDataCache.rawTexts.push(new Uint8Array(0));
    // indices 推入 0，导出时会重新计算
    msgDataCache.indices.push(0);
    msgDataCache.count = idx + 1;
    if (!msgDataCache.modifiedIndices) msgDataCache.modifiedIndices = new Set();
    msgDataCache.modifiedIndices.add(idx);
    msgDataCache.modified = true;

    // 刷新消息浏览器（如果打开）
    if (sssDataCurrentTab === 'messages') renderSssMessages();
    // 刷新选择器
    renderMsgSelector('', idx);
    onMsgSelectorSelect(idx);
    return idx;
  }

  function jumpToItem(itemId) {
    if (!wordDataCache) {
      alert('请先加载 WORD.DAT');
      return;
    }
    openSssDataPanel();
    closeScriptEditor();
    switchSssDataTab('items');
    const PAGE = 60;
    const page = Math.floor(itemId / PAGE);
    const pager = document.getElementById('sss-item-pager');
    if (pager) pager.dataset.page = page;
    renderSssItems();
    setTimeout(() => {
      const cards = document.querySelectorAll('#sss-item-grid .card');
      for (const card of cards) {
        const colId = card.querySelector('.col-id');
        if (!colId) continue;
        const idx = parseInt(colId.textContent.replace('#', ''));
        if (idx === itemId) {
          card.style.background = '#2b3a2b';
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          card.style.background = '';
        }
      }
    }, 100);
  }

  function scriptEditorUndo() {
    if (scriptEditorUndoStack.length === 0) return;
    const snap = scriptEditorUndoStack.pop();
    const current = SssScriptLoader.getInstruction(snap.offset);
    if (current) {
      scriptEditorRedoStack.push({ offset: snap.offset, ...current });
    }
    SssScriptLoader.setInstruction(snap.offset, snap.cmd, snap.p1, snap.p2, snap.p3);
    renderScriptEditor(currentScriptAddr);
  }

  function scriptEditorRedo() {
    if (scriptEditorRedoStack.length === 0) return;
    const snap = scriptEditorRedoStack.pop();
    const current = SssScriptLoader.getInstruction(snap.offset);
    if (current) {
      scriptEditorUndoStack.push({ offset: snap.offset, ...current });
    }
    SssScriptLoader.setInstruction(snap.offset, snap.cmd, snap.p1, snap.p2, snap.p3);
    renderScriptEditor(currentScriptAddr);
  }

  function scriptEditorSave() {
    alert('脚本修改已保存到内存。导出 MKF 时将包含修改后的脚本。');
  }

  function scriptEditorRevert() {
    if (!confirm('确定还原所有脚本修改？这将丢失所有未导出的脚本更改。')) return;
    SssScriptLoader.reset();
    renderScriptEditor(currentScriptAddr);
    scriptEditorUndoStack = [];
    scriptEditorRedoStack = [];
  }

  function bindScriptEditor() {
    document.getElementById('script-editor-close').addEventListener('click', closeScriptEditor);
    document.getElementById('btn-script-save').addEventListener('click', scriptEditorSave);
    document.getElementById('btn-script-undo').addEventListener('click', scriptEditorUndo);
    document.getElementById('btn-script-redo').addEventListener('click', scriptEditorRedo);
    document.getElementById('btn-script-revert').addEventListener('click', scriptEditorRevert);
    // 指令参考弹窗
    const btnRef = document.getElementById('btn-script-ref');
    const refPanel = document.getElementById('script-cmd-reference');
    const refClose = document.getElementById('script-cmd-ref-close');
    if (btnRef && refPanel) {
      btnRef.addEventListener('click', () => {
        refPanel.classList.toggle('hidden');
        if (!refPanel.classList.contains('hidden') && currentScriptAddr !== undefined) {
          renderScriptEditor(currentScriptAddr);
        }
      });
    }
    if (refClose && refPanel) {
      refClose.addEventListener('click', () => {
        refPanel.classList.add('hidden');
      });
    }
    // 点击模态框背景关闭
    document.getElementById('script-editor-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeScriptEditor();
    });

    // 消息选择器事件绑定
    const msgSelClose = document.getElementById('msg-selector-close');
    const msgSelNewBtn = document.getElementById('msg-selector-new-btn');
    const msgSelOkBtn = document.getElementById('msg-selector-ok-btn');
    const msgSelSearch = document.getElementById('msg-selector-search');
    const msgSelModal = document.getElementById('msg-selector-modal');
    if (msgSelClose) {
      msgSelClose.addEventListener('click', closeMsgSelector);
    }
    if (msgSelNewBtn) {
      msgSelNewBtn.addEventListener('click', () => {
        addNewMessage();
      });
    }
    if (msgSelOkBtn) {
      msgSelOkBtn.addEventListener('click', onMsgSelectorConfirm);
    }
    if (msgSelSearch) {
      msgSelSearch.addEventListener('input', (e) => {
        renderMsgSelector(e.target.value, -1);
      });
    }
    if (msgSelModal) {
      msgSelModal.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeMsgSelector();
      });
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ======================== SSS 数据面板 ========================
  let sssDataPanelOpen = false;
  let sssDataCurrentTab = 'messages';
  let sssDataCache = null; // { events, scenes, objects, msgIndices, msgTexts, wordNames }

  function openSssDataPanel() {
    const panel = document.getElementById('sss-data-panel');
    if (!panel) return;
    sssDataPanelOpen = true;
    panel.classList.remove('hidden');
    // 如果未加载过缓存，尝试从 sssJsonData 构建
    if (!sssDataCache) buildSssDataCache();
    switchSssDataTab('messages');
  }

  function closeSssDataPanel() {
    const panel = document.getElementById('sss-data-panel');
    if (panel) panel.classList.add('hidden');
    sssDataPanelOpen = false;
  }

  function buildSssDataCache() {
    if (!sssJsonData || !sssJsonData.scenes) return;
    // 从 sssJsonData 构建缓存（复用 PAL_SSS_Editor 的数据结构）
    const events = [];
    const scenes = [];
    let eventId = 1;
    for (const sc of sssJsonData.scenes) {
      scenes.push({
        id: sc.sceneID + 1,
        mapId: sc.mapID || 0,
        enterScript: sc.scriptEnter || 0,
        exitScript: sc.scriptLeave || 0,
        lastEvent: sc.firstEventID + (sc.events || []).length - 1
      });
      for (const ev of (sc.events || [])) {
        events.push({
          id: eventId++, vals: [
            ev.vanishTime || 0,
            ev.pixelX || 0,
            ev.pixelY || 0,
            ev.layer || 0,
            ev.triggerScript || 0,
            ev.autoScript || 0,
            ev.objStatus || 0,
            ev.triggerMethod || 0,
            ev.image || 0,
            ev.frames || 0,
            ev.direction || 0,
            ev.currFrame || 0,
            ev.scrJmpCount || 0,
            ev.imagePtrOffset || 0,
            ev.framesAuto || 0,
            ev.scrJmpCountAuto || 0
          ],
          x: ev.pixelX || 0, y: ev.pixelY || 0, layer: ev.layer || 0,
          triggerScript: ev.triggerScript || 0, autoScript: ev.autoScript || 0,
          state: ev.objStatus || 0, triggerMode: ev.triggerMethod || 0,
          sprite: ev.image || 0, dynImg: ev.frames || 0, statImg: ev.direction || 0
        });
      }
    }
    sssDataCache = { events, scenes };
  }

  // ========== M.MSG 解析 ==========
  let msgDataCache = null; // { count, indices, texts, raw }
  let wordDataCache = null; // { names, raw }

  function parseMMsg(buffer, indexBuffer) {
    const data = new Uint8Array(buffer);
    const decoder = new TextDecoder('big5', { fatal: false });

    // 如果提供了外部索引（SSS.MKF 子文件），使用正确方式解析
    if (indexBuffer) {
      const idxData = new Uint8Array(indexBuffer);
      if (idxData.length >= 8) {
        const idxDv = new DataView(indexBuffer);
        const count = Math.floor(idxData.length / 4) - 1; // 4字节整数数组，消息数 = 整数数-1
        const indices = [];
        const texts = [];
        const rawTexts = [];
        for (let i = 0; i < count; i++) {
          const b = idxDv.getUint32(i * 4, true);
          const e = idxDv.getUint32((i + 1) * 4, true);
          indices.push(b);
          const len = Math.max(0, e - b);
          if (b >= data.length) {
            texts.push('');
            rawTexts.push(new Uint8Array(0));
            continue;
          }
          const end = Math.min(b + len, data.length);
          const slice = data.slice(b, end);
          rawTexts.push(new Uint8Array(slice));
          try { texts.push(decoder.decode(slice)); }
          catch (err) { texts.push('[解码错误]'); }
        }
        return { count, indices, texts, rawTexts, raw: new Uint8Array(data), indexRaw: new Uint8Array(idxData), externalIndex: true };
      }
    }

    // 兼容旧的自包含格式（M.MSG 自带 2 字节索引头）
    if (data.length < 2) return null;
    const dv = new DataView(buffer);
    const count = dv.getUint16(0, true);
    const indexOffset = 2;
    const textOffset = indexOffset + count * 2;
    if (textOffset > data.length) return null;
    const indices = [];
    const texts = [];
    const rawTexts = [];
    for (let i = 0; i < count; i++) {
      const off = dv.getUint16(indexOffset + i * 2, true);
      indices.push(off);
      let end = data.length;
      if (i + 1 < count) {
        end = dv.getUint16(indexOffset + (i + 1) * 2, true);
      }
      if (off >= data.length) {
        texts.push('');
        rawTexts.push(new Uint8Array(0));
        continue;
      }
      let len = 0;
      while (off + len < end && data[off + len] !== 0) len++;
      const slice = data.slice(off, off + len);
      rawTexts.push(new Uint8Array(slice));
      try { texts.push(decoder.decode(slice)); }
      catch (e) { texts.push('[解码错误]'); }
    }
    return { count, indices, texts, rawTexts, raw: new Uint8Array(data), externalIndex: false };
  }

  // ========== WORD.DAT 解析 ==========
  function parseWordDat(buffer) {
    const data = new Uint8Array(buffer);
    const NAME_LEN = 10;
    const count = Math.floor(data.length / NAME_LEN);
    const names = [];
    const rawNames = []; // 保存原始字节
    const decoder = new TextDecoder('big5', { fatal: false });
    for (let i = 0; i < count; i++) {
      const off = i * NAME_LEN;
      let len = 0;
      while (len < NAME_LEN && data[off + len] !== 0) len++;
      const slice = data.slice(off, off + len);
      rawNames.push(new Uint8Array(data.slice(off, off + NAME_LEN)));
      try { names.push(decoder.decode(slice)); }
      catch (e) { names.push(''); }
    }
    return { names, rawNames, raw: new Uint8Array(data) };
  }

  // ========== 自动加载 M.MSG 和 WORD.DAT ==========
  function autoLoadMsgAndWord() {
    Promise.all([
      fetch('M.MSG').then(r => r.ok ? r.arrayBuffer() : null).catch(() => null),
      fetch('WORD.DAT').then(r => r.ok ? r.arrayBuffer() : null).catch(() => null)
    ]).then(([msgBuf, wordBuf]) => {
      if (msgBuf) {
        let indexBuf = null;
        if (sssMkfSubfiles && sssMkfSubfiles.length > 3) {
          indexBuf = sssMkfSubfiles[3].buffer;
          console.log('使用 SSS.MKF 子文件 #4 作为 M.MSG 索引');
        }
        msgDataCache = parseMMsg(msgBuf, indexBuf);
        console.log('M.MSG 加载完成:', msgDataCache.count, '条对话');
      }
      if (wordBuf) {
        wordDataCache = parseWordDat(wordBuf);
        console.log('WORD.DAT 加载完成:', wordDataCache.names.length, '个名称');
      }
      // 如果SSS数据面板已打开，刷新当前标签
      if (sssDataPanelOpen) {
        switchSssDataTab(sssDataCurrentTab);
      }
    });
  }

  // ========== SSS 数据面板标签页切换 ==========
  function switchSssDataTab(tab) {
    sssDataCurrentTab = tab;
    document.querySelectorAll('#sss-data-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.sssTab === tab));
    document.querySelectorAll('.sss-tab-content').forEach(c => c.classList.toggle('active', c.id === 'sss-tab-' + tab));
    if (tab === 'messages') renderSssMessages();
    else if (tab === 'events') renderSssEvents();
    else if (tab === 'scenes') renderSssScenes();
    else if (tab === 'items') renderSssItems();
    else if (tab === 'objects') renderSssObjects();
    else if (tab === 'scripts') renderSssScripts();
  }

  function renderSssMessages() {
    const tbody = document.getElementById('sss-msg-table');
    const countEl = document.getElementById('sss-msg-count');
    if (!tbody) return;
    if (!msgDataCache) {
      tbody.innerHTML = '<tr><td colspan="4" class="small">请先加载 M.MSG 文件（可手动上传或放入项目目录自动加载）</td></tr>';
      if (countEl) countEl.textContent = '0';
      return;
    }
    const PAGE = 100;
    let page = 0;
    const pager = document.getElementById('sss-msg-pager');
    if (pager && pager.dataset.page) page = parseInt(pager.dataset.page) || 0;
    const total = msgDataCache.count;
    if (countEl) countEl.textContent = total;
    const start = page * PAGE;
    const end = Math.min(start + PAGE, total);
    tbody.innerHTML = '';
    for (let i = start; i < end; i++) {
      const tr = document.createElement('tr');
      const off = msgDataCache.indices[i] !== undefined ? msgDataCache.indices[i] : 0;
      const text = msgDataCache.texts[i] || '';
      tr.innerHTML = '<td class="col-id">' + i + '</td>' +
        '<td class="hex">0x' + (off !== undefined ? off.toString(16).toUpperCase() : '0') + '</td>' +
        '<td>' + (text.length) + '</td>' +
        '<td><input type="text" class="msg-text-input" value="' + escapeHtml(text) + '" data-idx="' + i + '" style="width:100%;background:transparent;border:none;color:#e1e3e6;font-size:13px"></td>';
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('.msg-text-input').forEach(inp => {
      inp.addEventListener('change', onMsgEdit);
    });
    if (pager) {
      const totalPages = Math.ceil(total / PAGE);
      let html = '';
      if (totalPages > 1) {
        html += '<button ' + (page <= 0 ? 'disabled' : '') + ' data-page="' + (page - 1) + '">◀</button>';
        html += '<span>第 ' + (page + 1) + ' / ' + totalPages + ' 页</span>';
        html += '<button ' + (page >= totalPages - 1 ? 'disabled' : '') + ' data-page="' + (page + 1) + '">▶</button>';
      }
      pager.innerHTML = html;
      pager.querySelectorAll('button:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => {
          pager.dataset.page = btn.dataset.page;
          renderSssMessages();
        });
      });
    }
  }

  function renderSssEvents() {
    const tbody = document.getElementById('sss-evt-table');
    if (!tbody || !sssDataCache) return;
    tbody.innerHTML = '';
    const PAGE = 50;
    const evts = sssDataCache.events.slice(0, PAGE);
    for (const ev of evts) {
      const tr = document.createElement('tr');
      const gameX = ev.x - 0xA0;
      const gameY = ev.y - 0x70;
      tr.innerHTML = '<td class="col-id">' + ev.id + '</td>' +
        '<td class="hex">' + ev.x.toString(16).toUpperCase() + '</td>' +
        '<td class="coord-raw">' + gameX + '</td>' +
        '<td class="hex">' + ev.y.toString(16).toUpperCase() + '</td>' +
        '<td class="coord-raw">' + gameY + '</td>' +
        '<td>' + ev.layer + '</td>' +
        '<td class="hex">' + ev.triggerScript.toString(16).toUpperCase() + '</td>' +
        '<td class="hex">' + ev.autoScript.toString(16).toUpperCase() + '</td>' +
        '<td>' + ev.triggerMode + '</td>';
      tbody.appendChild(tr);
    }
  }
  function renderSssScenes() {
    const tbody = document.getElementById('sss-scene-table');
    if (!tbody || !sssDataCache) return;
    tbody.innerHTML = '';
    const scenes = sssDataCache.scenes;
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      let range = '-';
      if (i > 0) {
        range = (scenes[i-1].lastEvent + 1) + ' - ' + sc.lastEvent;
      }
      const tr = document.createElement('tr');
      tr.innerHTML = '<td class="col-id">' + sc.id + '</td>' +
        '<td>' + sc.mapId + '</td>' +
        '<td class="hex">' + sc.enterScript.toString(16).toUpperCase() + '</td>' +
        '<td class="hex">' + sc.exitScript.toString(16).toUpperCase() + '</td>' +
        '<td>' + sc.lastEvent + '</td>' +
        '<td>' + range + '</td>';
      tbody.appendChild(tr);
    }
  }
  function renderSssItems() {
    const grid = document.getElementById('sss-item-grid');
    if (!grid) return;
    if (!wordDataCache) {
      grid.innerHTML = '<div class="card" style="padding:20px"><p class="small">请先加载 WORD.DAT 文件（可手动上传或放入项目目录自动加载）</p></div>';
      return;
    }
    const ITEM_COUNT = 256;
    const names = wordDataCache.names.slice(0, ITEM_COUNT);
    const PAGE = 60;
    let page = 0;
    const pager = document.getElementById('sss-item-pager');
    if (pager && pager.dataset.page) page = parseInt(pager.dataset.page) || 0;
    const start = page * PAGE;
    const end = Math.min(start + PAGE, names.length);
    grid.innerHTML = '';
    for (let i = start; i < end; i++) {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'padding:8px;display:flex;align-items:center;gap:8px';
      const name = names[i] || '';
      card.innerHTML = '<span class="col-id" style="min-width:40px">#' + i + '</span>' +
        '<input type="text" class="word-name-input" value="' + escapeHtml(name) + '" data-idx="' + i + '" style="flex:1;background:#1e1e22;border:1px solid #3a3a40;border-radius:3px;padding:4px 8px;color:#e1e3e6;font-size:13px">';
      grid.appendChild(card);
    }
    grid.querySelectorAll('.word-name-input').forEach(inp => {
      inp.addEventListener('change', onWordEdit);
    });
    if (pager) {
      const totalPages = Math.ceil(names.length / PAGE);
      let html = '';
      if (totalPages > 1) {
        html += '<button ' + (page <= 0 ? 'disabled' : '') + ' data-page="' + (page - 1) + '">◀</button>';
        html += '<span>第 ' + (page + 1) + ' / ' + totalPages + ' 页</span>';
        html += '<button ' + (page >= totalPages - 1 ? 'disabled' : '') + ' data-page="' + (page + 1) + '">▶</button>';
      }
      pager.innerHTML = html;
      pager.querySelectorAll('button:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => {
          pager.dataset.page = btn.dataset.page;
          renderSssItems();
        });
      });
    }
  }
  function renderSssObjects() {
    const table = document.getElementById('sss-obj-table');
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    if (!wordDataCache) {
      tbody.innerHTML = '<tr><td colspan="8" class="small">请先加载 WORD.DAT 文件（可手动上传或放入项目目录自动加载）</td></tr>';
      return;
    }
    const typeBtn = document.querySelector('.sss-obj-type-btn.active');
    const type = typeBtn ? typeBtn.dataset.type : 'system';
    const ranges = {
      system: { start: 0, end: 61 },
      character: { start: 36, end: 42 },
      item: { start: 61, end: 295 },
      magic: { start: 295, end: 398 },
      monster: { start: 398, end: 551 },
      poison: { start: 551, end: 565 }
    };
    const range = ranges[type] || ranges.system;
    const names = wordDataCache.names.slice(range.start, range.end);
    tbody.innerHTML = '';
    for (let i = 0; i < names.length; i++) {
      const globalIdx = range.start + i;
      const tr = document.createElement('tr');
      const name = names[i] || '';
      tr.innerHTML = '<td class="col-id">' + globalIdx + '</td>' +
        '<td><input type="text" class="word-name-input" value="' + escapeHtml(name) + '" data-idx="' + globalIdx + '" style="width:100%;background:transparent;border:none;color:#e1e3e6;font-size:13px"></td>' +
        '<td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>';
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('.word-name-input').forEach(inp => {
      inp.addEventListener('change', onWordEdit);
    });
  }

  function onMsgEdit(e) {
    const inp = e.target;
    const idx = parseInt(inp.dataset.idx);
    const newText = inp.value;
    if (!msgDataCache || idx >= msgDataCache.count) return;
    msgDataCache.texts[idx] = newText;
    if (!msgDataCache.modifiedIndices) msgDataCache.modifiedIndices = new Set();
    msgDataCache.modifiedIndices.add(idx);
    msgDataCache.modified = true;
    console.log('对话 #' + idx + ' 已修改:', newText.substring(0, 30) + (newText.length > 30 ? '...' : ''));
  }

  function onWordEdit(e) {
    const inp = e.target;
    const idx = parseInt(inp.dataset.idx);
    const newName = inp.value;
    if (!wordDataCache || idx >= wordDataCache.names.length) return;
    wordDataCache.names[idx] = newName;
    if (!wordDataCache.modifiedIndices) wordDataCache.modifiedIndices = new Set();
    wordDataCache.modifiedIndices.add(idx);
    wordDataCache.modified = true;
    console.log('名称 #' + idx + ' 已修改:', newName);
  }

  function renderSssScripts() {
    const view = document.getElementById('sss-script-view');
    if (view) view.textContent = '输入脚本地址(hex)后点击"查看"按钮查看指令...';
  }

  function bindSssScriptView() {
    const viewBtn = document.getElementById('sss-script-view-btn');
    const findBtn = document.getElementById('sss-script-find-btn');
    const idInput = document.getElementById('sss-script-id');
    const view = document.getElementById('sss-script-view');
    if (!viewBtn || !idInput || !view) return;
    viewBtn.addEventListener('click', () => {
      const val = parseInt(idInput.value, idInput.value.startsWith('0x') || /[A-Fa-f]/.test(idInput.value) ? 16 : 10);
      if (isNaN(val)) { view.textContent = '无效的脚本地址'; return; }
      if (typeof SssScriptLoader === 'undefined' || !SssScriptLoader.isLoaded()) {
        view.textContent = '脚本数据未加载，请先加载 SSS.MKF'; return;
      }
      const instructions = SssScriptLoader.parseScript(val);
      if (instructions.length === 0) { view.textContent = '无指令数据'; return; }
      const lines = [];
      for (const inst of instructions) {
        const name = SssScriptLoader.getScriptName(inst.cmd);
        lines.push('0x' + inst.offset.toString(16).toUpperCase().padStart(4, '0') + ': ' +
          '0x' + inst.cmd.toString(16).toUpperCase().padStart(4, '0') + ' ' +
          'P1=' + inst.p1 + ' P2=' + inst.p2 + ' P3=' + inst.p3 + '  // ' + name);
        if (inst.cmd === 0) break;
      }
      view.textContent = lines.join('\n');
    });
    if (findBtn) {
      findBtn.addEventListener('click', () => {
        if (!sssDataCache) { view.textContent = '请先加载 SSS.MKF'; return; }
        const lines = [];
        for (const ev of sssDataCache.events) {
          if (ev.triggerScript > 0 || ev.autoScript > 0) {
            lines.push('事件 #' + ev.id + ' @ (' + ev.x + ',' + ev.y + ') 触发脚本: 0x' + ev.triggerScript.toString(16).toUpperCase() + ' 自动脚本: 0x' + ev.autoScript.toString(16).toUpperCase());
          }
        }
        view.textContent = lines.length > 0 ? lines.join('\n') : '没有事件使用脚本';
      });
    }
    idInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') viewBtn.click(); });
  }

  // ========== Big5 编码器（利用浏览器 TextDecoder 生成反向映射） ==========
  const Big5Encoder = (function() {
    let encodeMap = null;
    let mapReady = false;

    function buildMap() {
      if (mapReady) return;
      encodeMap = new Uint16Array(65536);
      const decoder = new TextDecoder('big5', { fatal: false });

      // 单字节字符 (ASCII)
      for (let i = 0; i < 128; i++) {
        encodeMap[i] = i;
      }

      // 双字节字符：遍历所有有效的 Big5 第二字节范围
      for (let b1 = 0x81; b1 <= 0xFE; b1++) {
        for (let b2 = 0x40; b2 <= 0x7E; b2++) {
          const bytes = new Uint8Array([b1, b2]);
          const char = decoder.decode(bytes);
          if (char.length === 1) {
            const code = char.charCodeAt(0);
            if (code !== 0xFFFD) {
              encodeMap[code] = (b1 << 8) | b2;
            }
          }
        }
        for (let b2 = 0xA1; b2 <= 0xFE; b2++) {
          const bytes = new Uint8Array([b1, b2]);
          const char = decoder.decode(bytes);
          if (char.length === 1) {
            const code = char.charCodeAt(0);
            if (code !== 0xFFFD) {
              encodeMap[code] = (b1 << 8) | b2;
            }
          }
        }
      }
      mapReady = true;
    }

    function encode(text) {
      buildMap();
      const bytes = [];
      let hasUnmapped = false;
      for (const char of text) {
        const code = char.charCodeAt(0);
        if (code <= 0x7F) {
          bytes.push(code);
        } else {
          const big5 = encodeMap[code];
          if (big5) {
            bytes.push(big5 >> 8, big5 & 0xFF);
          } else {
            bytes.push(0x3F); // ?
            hasUnmapped = true;
          }
        }
      }
      return { bytes: new Uint8Array(bytes), hasUnmapped };
    }

    return { encode };
  })();

  // ========== M.MSG / WORD.DAT 导出 ==========
  function exportMMsg() {
    if (!msgDataCache) { alert('请先加载 M.MSG'); return; }
    const texts = msgDataCache.texts;
    const rawTexts = msgDataCache.rawTexts;
    const modifiedIndices = msgDataCache.modifiedIndices || new Set();
    const count = texts.length;

    // 构建新的 M.MSG 内容（纯文本，无索引头）
    let totalLen = 0;
    const textBuffers = [];
    let hasUnmapped = false;
    for (let i = 0; i < count; i++) {
      let buf;
      if (modifiedIndices.has(i)) {
        const result = Big5Encoder.encode(texts[i] || '');
        buf = result.bytes;
        if (result.hasUnmapped) hasUnmapped = true;
      } else {
        buf = rawTexts[i] || new Uint8Array(0);
      }
      textBuffers.push(buf);
      totalLen += buf.length;
    }

    const msgBuf = new Uint8Array(totalLen);
    let pos = 0;
    for (const buf of textBuffers) {
      msgBuf.set(buf, pos);
      pos += buf.length;
    }

    const blob = new Blob([msgBuf], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'M.MSG';
    a.click(); URL.revokeObjectURL(url);

    // 重新计算所有消息的偏移索引（级联更新，确保长度变化时不错位）
    const newOffsets = [0];
    let offset = 0;
    for (const buf of textBuffers) {
      offset += buf.length;
      newOffsets.push(offset);
    }
    // 更新内存中的起始偏移（显示和后续导出用）
    msgDataCache.indices = newOffsets.slice(0, count);
    const indexBuf = new ArrayBuffer(newOffsets.length * 4);
    const indexDv = new DataView(indexBuf);
    for (let i = 0; i < newOffsets.length; i++) {
      indexDv.setUint32(i * 4, newOffsets[i], true);
    }
    msgDataCache.indexRaw = new Uint8Array(indexBuf);
    msgDataCache.modified = true;

    // 如果使用了外部索引（SSS.MKF），同步更新内存中的子文件
    if (msgDataCache.externalIndex && sssMkfSubfiles && sssMkfSubfiles.length > 3) {
      sssMkfSubfiles[3] = new Uint8Array(indexBuf);
      console.log('M.MSG 索引已更新到 SSS.MKF 子文件 #4');
    }

    let status = 'M.MSG 已导出: ' + count + ' 条对话';
    if (msgDataCache.externalIndex) {
      status += ' ⚠️ 请同时导出 SSS.MKF 以同步更新索引';
    }
    if (hasUnmapped) status += ' ⚠️ 某些字符无法编码为 Big5，已替换为 "?"';
    updateStatus(status);
  }

  function exportWordDat() {
    if (!wordDataCache) { alert('请先加载 WORD.DAT'); return; }
    const NAME_LEN = 10;
    const count = wordDataCache.names.length;
    const rawNames = wordDataCache.rawNames;
    const modifiedIndices = wordDataCache.modifiedIndices || new Set();
    const buf = new ArrayBuffer(count * NAME_LEN);
    const data = new Uint8Array(buf);
    let hasUnmapped = false;
    for (let i = 0; i < count; i++) {
      if (modifiedIndices.has(i)) {
        const name = wordDataCache.names[i] || '';
        const result = Big5Encoder.encode(name);
        const bytes = result.bytes;
        const len = Math.min(bytes.length, NAME_LEN);
        data.set(bytes.slice(0, len), i * NAME_LEN);
        if (result.hasUnmapped) hasUnmapped = true;
      } else if (rawNames[i]) {
        data.set(rawNames[i], i * NAME_LEN);
      }
      // 剩余字节已经是 0（Uint8Array 初始化时为 0）
    }
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'WORD.DAT';
    a.click(); URL.revokeObjectURL(url);
    let status = 'WORD.DAT 已导出: ' + count + ' 个名称';
    if (hasUnmapped) status += ' ⚠️ 某些字符无法编码为 Big5，已替换为 "?"';
    updateStatus(status);
  }

  function bindSssDataPanel() {
    const btn = document.getElementById('btn-sss-data');
    if (btn) btn.addEventListener('click', openSssDataPanel);
    document.getElementById('sss-data-close').addEventListener('click', closeSssDataPanel);
    document.getElementById('sss-data-panel').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeSssDataPanel();
    });
    document.querySelectorAll('#sss-data-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => switchSssDataTab(tab.dataset.sssTab));
    });

    // 对象类型切换按钮
    document.querySelectorAll('.sss-obj-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sss-obj-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderSssObjects();
      });
    });

    // 对话搜索
    const msgSearchBtn = document.getElementById('sss-msg-search-btn');
    const msgSearchInput = document.getElementById('sss-msg-search');
    if (msgSearchBtn && msgSearchInput) {
      msgSearchBtn.addEventListener('click', () => {
        const q = msgSearchInput.value.trim().toLowerCase();
        if (!q || !msgDataCache) return;
        const hits = [];
        for (let i = 0; i < msgDataCache.count; i++) {
          const t = (msgDataCache.texts[i] || '').toLowerCase();
          if (t.includes(q)) hits.push(i);
        }
        if (hits.length === 0) { alert('未找到包含 "' + q + '" 的对话'); return; }
        const pager = document.getElementById('sss-msg-pager');
        if (pager) pager.dataset.page = Math.floor(hits[0] / 100);
        renderSssMessages();
        // 高亮第一个匹配项
        setTimeout(() => {
          const rows = document.querySelectorAll('#sss-msg-table tr');
          for (const row of rows) {
            const colId = row.querySelector('.col-id');
            if (!colId) continue;
            const idx = parseInt(colId.textContent);
            if (hits.includes(idx)) {
              row.style.background = '#2b3a2b';
              row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }, 50);
      });
      msgSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') msgSearchBtn.click(); });
    }
    document.getElementById('sss-msg-clear-btn')?.addEventListener('click', () => {
      const pager = document.getElementById('sss-msg-pager');
      if (pager) pager.dataset.page = '0';
      renderSssMessages();
    });
    document.getElementById('sss-msg-new-btn')?.addEventListener('click', () => {
      addNewMessage();
    });

    // 物品搜索
    const itemSearchBtn = document.getElementById('sss-item-search-btn');
    const itemSearchInput = document.getElementById('sss-item-search');
    if (itemSearchBtn && itemSearchInput) {
      itemSearchBtn.addEventListener('click', () => {
        const q = itemSearchInput.value.trim().toLowerCase();
        if (!q || !wordDataCache) return;
        const hits = [];
        for (let i = 0; i < 256; i++) {
          const n = (wordDataCache.names[i] || '').toLowerCase();
          if (n.includes(q)) hits.push(i);
        }
        if (hits.length === 0) { alert('未找到包含 "' + q + '" 的物品'); return; }
        const pager = document.getElementById('sss-item-pager');
        if (pager) pager.dataset.page = Math.floor(hits[0] / 60);
        renderSssItems();
        setTimeout(() => {
          const cards = document.querySelectorAll('#sss-item-grid .card');
          for (const card of cards) {
            const colId = card.querySelector('.col-id');
            if (!colId) continue;
            const idx = parseInt(colId.textContent.replace('#', ''));
            if (hits.includes(idx)) card.style.background = '#2b3a2b';
          }
        }, 50);
      });
      itemSearchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') itemSearchBtn.click(); });
    }

    // 导出按钮
    document.getElementById('sss-export-mkf')?.addEventListener('click', () => {
      if (!sssJsonData) { alert('请先加载 SSS.MKF'); return; }
      try {
        // 使用 buildSssFromEditor 以包含编辑器中的修改（新增/删除/修改的事件）
        const outputData = buildSssFromEditor(true);
        const mkfData = sssToMkf(outputData || sssJsonData);
        const blob = new Blob([mkfData], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'SSS.MKF';
        a.click(); URL.revokeObjectURL(url);
        if (outputData) {
          const totalEvents = outputData.scenes.reduce((sum, s) => sum + (s.events || []).length, 0);
          updateStatus('SSS.MKF 已导出: ' + totalEvents + ' 个事件');
        } else {
          updateStatus('SSS.MKF 已导出: ' + mkfData.length + ' 字节');
        }
      } catch (err) {
        alert('导出 SSS.MKF 失败: ' + err.message);
      }
    });
    document.getElementById('sss-export-msg')?.addEventListener('click', exportMMsg);
    document.getElementById('sss-export-word')?.addEventListener('click', exportWordDat);

    // 文件上传
    const msgLoadBtn = document.getElementById('btn-load-msg');
    const msgLoadInput = document.getElementById('msg-load-input');
    if (msgLoadBtn && msgLoadInput) {
      msgLoadBtn.addEventListener('click', () => msgLoadInput.click());
      msgLoadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        const buf = await file.arrayBuffer();
        let indexBuf = null;
        if (sssMkfSubfiles && sssMkfSubfiles.length > 3) {
          indexBuf = sssMkfSubfiles[3].buffer;
        }
        msgDataCache = parseMMsg(buf, indexBuf);
        console.log('M.MSG 手动加载:', msgDataCache.count, '条对话');
        if (sssDataPanelOpen && sssDataCurrentTab === 'messages') renderSssMessages();
        updateStatus('M.MSG 已加载: ' + msgDataCache.count + ' 条对话');
      });
    }
    const wordLoadBtn = document.getElementById('btn-load-word');
    const wordLoadInput = document.getElementById('word-load-input');
    if (wordLoadBtn && wordLoadInput) {
      wordLoadBtn.addEventListener('click', () => wordLoadInput.click());
      wordLoadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        const buf = await file.arrayBuffer();
        wordDataCache = parseWordDat(buf);
        console.log('WORD.DAT 手动加载:', wordDataCache.names.length, '个名称');
        if (sssDataPanelOpen && (sssDataCurrentTab === 'items' || sssDataCurrentTab === 'objects')) {
          switchSssDataTab(sssDataCurrentTab);
        }
        updateStatus('WORD.DAT 已加载: ' + wordDataCache.names.length + ' 个名称');
      });
    }
    bindSssScriptView();
  }

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
