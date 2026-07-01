const Editor = (function () {
  // 编辑状态
  const TOOLS = {
    SELECT: 'select',
    PEN: 'pen',
    TEMPLATE: 'template',
    ERASE: 'erase',
    BARRIER: 'barrier',
    EVENT: 'event',
  };

  let currentTool = TOOLS.SELECT;
  let currentLayer = 0; // 0 或 1
  let selectedTile = -1; // 图块编号（用于画笔）
  let cameraX = 0;
  let cameraY = 0;
  let mouseTileX = -1;
  let mouseTileY = -1;

  // 多选系统
  let selectedTiles = new Set(); // "x,y" 字符串集合
  let primarySelTile = { x: -1, y: -1 }; // 主选 tile（用于属性面板、对象显示等）
  
  // 框选状态
  let isBoxSelecting = false;
  let boxSelectState = null; // { startPx: {x,y}, currentPx: {x,y}, mode: 'replace'|'add'|'subtract' }

  let isMouseDown = false;
  let isDragging = false;
  const DRAG_THRESHOLD = 5; // 像素，超过此距离判定为拖动
  let mouseDownPos = { x: 0, y: 0, tileX: -1, tileY: -1 };
  let lastDragX = 0;
  let lastDragY = 0;
  let zoom = 1.0;

  // 显示选项
  let showBarrier = false;
  let showObject = false;
  let showL0 = true;
  let showL1 = true;
  let showGrid = false;
  let showEventChar = false;
  let showEventLabel = true;
  let drawEventBoxes = true;

  // 模板
  let templateTiles = []; // {x, y} 数组，相对于基点
  let templateBaseX = 0;
  let templateBaseY = 0;

  // 标记图像（ImageData）
  let mouseImg = null;
  let selImg = null;
  let barrierImg = null;
  let objectImg = null;
  let eventImg = null;

  // 事件人物图像缓存
  const charCache = {};

  // 事件对象列表
  let events = [];
  let selectedEventId = -1;
  let showEvents = true;
  let copiedEvent = null; // 剪贴板：复制的事件数据
  let nextEventId = 0;   // 全局事件ID计数器，新增事件从此值递增

  // 动画基于时间戳更新，确保恒定速度不受帧率波动影响
  let lastAnimTime = 0;
  const ANIM_INTERVAL_MS = 250;

  function updateAnimation(timestamp) {
    if (!lastAnimTime) {
      lastAnimTime = timestamp;
      return;
    }
    const elapsed = timestamp - lastAnimTime;
    if (elapsed < ANIM_INTERVAL_MS) return;
    lastAnimTime = timestamp;

    for (const ev of events) {
      // 帧动画：frames > 1 或 framesAuto > 1 时播放行走动画
      if (ev.image > 0) {
        const effectiveFrames = ev.frames > 1 ? ev.frames : (ev.framesAuto > 1 ? ev.framesAuto : 0);
        if (effectiveFrames > 1) {
          ev.currFrame = (ev.currFrame + 1) % effectiveFrames;
        }
      }

      // 自动行走：沿着 SSS 脚本移动路径一格一格移动（方向只在目标切换时更新）
      if (ev.moving && ev.autoScript > 0 && typeof SssScriptLoader !== 'undefined' && SssScriptLoader.isLoaded()) {
        if (!ev.movePath) {
          ev.movePath = SssScriptLoader.extractMovePath(ev.autoScript, ev.x, ev.y);
          ev.movePathIndex = 0;
          // 初始化方向：基于第一个目标的第一步等距方向
          const firstTarget = ev.movePath[0];
          if (firstTarget && typeof MapModule !== 'undefined') {
            let bestDir = 0;
            let bestDist = Infinity;
            for (let dir = 1; dir <= 6; dir++) {
              const n = MapModule.getNeighborTile(ev.x, ev.y, dir);
              const dist = Math.abs(n.x - firstTarget.x) + Math.abs(n.y - firstTarget.y);
              if (dist < bestDist) {
                bestDist = dist;
                bestDir = dir;
              }
            }
            switch (bestDir) {
              case 1: ev.direction = 3; break; // 右下 → 上
              case 2: ev.direction = 0; break; // 左下 → 下
              case 3: ev.direction = 1; break; // 左上 → 左
              case 4: ev.direction = 2; break; // 右上 → 右
              case 5: ev.direction = 3; break; // 上 → 上
              case 6: ev.direction = 0; break; // 下 → 下
            }
          }
        }
        if (ev.movePath && ev.movePath.length > 0) {
          const target = ev.movePath[ev.movePathIndex];
          if (target) {
            const dx = target.x - ev.x;
            const dy = target.y - ev.y;
            if (dx === 0 && dy === 0) {
              // 已到达目标，前往下一个路径点，并基于下一步等距方向更新方向
              ev.movePathIndex = (ev.movePathIndex + 1) % ev.movePath.length;
              const nextTarget = ev.movePath[ev.movePathIndex];
              if (nextTarget && typeof MapModule !== 'undefined') {
                let bestDir = 0;
                let bestDist = Infinity;
                for (let dir = 1; dir <= 6; dir++) {
                  const n = MapModule.getNeighborTile(ev.x, ev.y, dir);
                  const dist = Math.abs(n.x - nextTarget.x) + Math.abs(n.y - nextTarget.y);
                  if (dist < bestDist) {
                    bestDist = dist;
                    bestDir = dir;
                  }
                }
                switch (bestDir) {
                  case 1: ev.direction = 3; break; // 右下 → 上
                  case 2: ev.direction = 0; break; // 左下 → 下
                  case 3: ev.direction = 1; break; // 左上 → 左
                  case 4: ev.direction = 2; break; // 右上 → 右
                  case 5: ev.direction = 3; break; // 上 → 上
                  case 6: ev.direction = 0; break; // 下 → 下
                }
              }
            } else if (typeof MapModule !== 'undefined') {
              // 继续朝目标移动，不改变方向
              let bestDir = 0;
              let bestDist = Infinity;
              for (let dir = 1; dir <= 6; dir++) {
                const n = MapModule.getNeighborTile(ev.x, ev.y, dir);
                const dist = Math.abs(n.x - target.x) + Math.abs(n.y - target.y);
                if (dist < bestDist) {
                  bestDist = dist;
                  bestDir = dir;
                }
              }
              const next = MapModule.getNeighborTile(ev.x, ev.y, bestDir);
              ev.x = next.x;
              ev.y = next.y;
              // 移动过程中不改变方向
            }
          }
        }
      }
    }
  }

  // 撤销/重做栈
  const MAX_HISTORY = 50;
  let undoStack = [];
  let redoStack = [];
  let undoPushed = false;

  let tileSnapshotProvider = null;
  let tileRestoreProvider = null;

  function setTileSnapshotProvider(provider) { tileSnapshotProvider = provider; }
  function setTileRestoreProvider(provider) { tileRestoreProvider = provider; }

  function pushUndo() {
    if (!undoPushed) {
      const snapshot = {
        map: MapModule.saveMap(),
        events: JSON.parse(JSON.stringify(events)),
        tiles: tileSnapshotProvider ? tileSnapshotProvider() : null
      };
      undoStack.push(snapshot);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack = [];
      undoPushed = true;
    }
  }

  function undo() {
    if (undoStack.length === 0) return false;
    redoStack.push({
      map: MapModule.saveMap(),
      events: JSON.parse(JSON.stringify(events)),
      tiles: tileSnapshotProvider ? tileSnapshotProvider() : null
    });
    if (redoStack.length > MAX_HISTORY) redoStack.shift();
    const snapshot = undoStack.pop();
    MapModule.loadMap(snapshot.map);
    events = JSON.parse(JSON.stringify(snapshot.events));
    if (tileRestoreProvider && snapshot.tiles) {
      tileRestoreProvider(snapshot.tiles);
    }
    return true;
  }

  function redo() {
    if (redoStack.length === 0) return false;
    undoStack.push({
      map: MapModule.saveMap(),
      events: JSON.parse(JSON.stringify(events)),
      tiles: tileSnapshotProvider ? tileSnapshotProvider() : null
    });
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    const snapshot = redoStack.pop();
    MapModule.loadMap(snapshot.map);
    events = JSON.parse(JSON.stringify(snapshot.events));
    if (tileRestoreProvider && snapshot.tiles) {
      tileRestoreProvider(snapshot.tiles);
    }
    return true;
  }

  function clearUndoPushed() {
    undoPushed = false;
  }

  function clearUndoRedo() {
    undoStack = [];
    redoStack = [];
    undoPushed = false;
  }

  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  // ========== 事件对象管理 ==========
  function getEvents() { return events; }
  function setEvents(list) {
    events = (list || []).map(ev => {
      if (ev.originX === undefined) ev.originX = ev.x;
      if (ev.originY === undefined) ev.originY = ev.y;
      return ev;
    });
  }
  function clearEvents() { events = []; selectedEventId = -1; nextEventId = 0; }

  function addEvent(eventData) {
    const id = eventData.id !== undefined ? eventData.id : nextEventId++;
    nextEventId = Math.max(nextEventId, id + 1);
    events.push({
      id: id,
      originX: eventData.x || 0,
      originY: eventData.y || 0,
      originalIdx: eventData.originalIdx,
      vanishTime: eventData.vanishTime || 0,
      x: eventData.x || 0,
      y: eventData.y || 0,
      layer: eventData.layer || 0,
      triggerScript: eventData.triggerScript || 0,
      autoScript: eventData.autoScript || 0,
      objStatus: eventData.objStatus || 0,
      triggerMethod: eventData.triggerMethod || 1,
      image: eventData.image || 0,
      frames: typeof eventData.frames === 'number' ? eventData.frames : 1,
      direction: eventData.direction || 0,
      currFrame: eventData.currFrame || 0,
      scrJmpCount: eventData.scrJmpCount || 0,
      imagePtrOffset: eventData.imagePtrOffset || 0,
      framesAuto: eventData.framesAuto || 0,
      scrJmpCountAuto: eventData.scrJmpCountAuto || 0,
      moving: eventData.moving || false,
    });
    return id;
  }

  function removeEvent(id) {
    events = events.filter(e => e.id !== id);
    if (selectedEventId === id) selectedEventId = -1;
  }

  function setNextEventId(v) { nextEventId = Math.max(nextEventId, v); }

  function getEvent(id) {
    return events.find(e => e.id === id) || null;
  }

  function updateEvent(id, updates) {
    const ev = getEvent(id);
    if (!ev) return false;
    if (updates.autoScript !== undefined && updates.autoScript !== ev.autoScript) {
      updates.movePath = null;
      updates.movePathIndex = 0;
    }
    Object.assign(ev, updates);
    return true;
  }

  function setSelectedEventId(id) { selectedEventId = id; }
  function getSelectedEventId() { return selectedEventId; }

  function setShowEvents(v) { showEvents = v; }
  function getShowEvents() { return showEvents; }

  function findEventAt(x, y) {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].x === x && events[i].y === y) return events[i];
    }
    return null;
  }

  // 获取同一 tile 上的所有事件（按图层排序，高图层在前）
  function getEventsAtTile(x, y) {
    return events.filter(e => e.x === x && e.y === y).sort((a, b) => b.layer - a.layer);
  }

  function copyEvent() {
    const ev = getEvent(selectedEventId);
    if (!ev) return false;
    copiedEvent = JSON.parse(JSON.stringify(ev));
    delete copiedEvent.id; // 粘贴时重新分配 ID
    delete copiedEvent.originalIdx; // 粘贴时不保留原始索引，避免覆盖原事件
    return true;
  }

  function pasteEvent(x, y) {
    if (!copiedEvent) return null;
    // 如果目标位置已有事件，先删除
    const existing = findEventAt(x, y);
    if (existing) {
      removeEvent(existing.id);
    }
    const data = JSON.parse(JSON.stringify(copiedEvent));
    data.x = x;
    data.y = y;
    delete data.originalIdx; // 确保粘贴的事件没有 originalIdx
    return addEvent(data);
  }

  function hasCopiedEvent() {
    return copiedEvent !== null;
  }

  // 获取事件的移动路径（从 SSS 脚本解析）
  function getEventMovePath(eventId) {
    const ev = getEvent(eventId);
    if (!ev) return [];
    if (typeof SssScriptLoader === 'undefined' || !SssScriptLoader.isLoaded()) return [];
    if (!ev.autoScript || ev.autoScript === 0) return [];
    const sx = ev.originX !== undefined ? ev.originX : ev.x;
    const sy = ev.originY !== undefined ? ev.originY : ev.y;
    return SssScriptLoader.extractMovePath(ev.autoScript, sx, sy);
  }

  function init() {
    // 加载标记图像（PNG 自带 alpha 通道，无需手动处理透明色）
    loadImage('assets/bitmap1.png', (img) => { mouseImg = img; });
    loadImage('assets/bitmap2.png', (img) => { selImg = img; });
    loadImage('assets/bitmap3.png', (img) => { barrierImg = img; });
    loadImage('assets/bitmap4.png', (img) => { eventImg = img; });
    loadImage('assets/Object.png', (img) => { objectImg = img; });
    // 默认工具是 SELECT，设置鼠标指针为箭头
    const canvas = document.getElementById('map-canvas');
    if (canvas) canvas.style.cursor = 'default';
  }

  function loadImage(url, callback) {
    const img = new Image();
    img.onload = () => { callback(img); };
    img.onerror = () => { console.warn('Failed to load image:', url); callback(null); };
    img.src = url;
  }

  // 鼠标在 Canvas 上的坐标 -> 地图 Tile 坐标
  function screenToTile(sx, sy) {
    const mapCanvas = document.getElementById('map-canvas');
    const rect = mapCanvas.getBoundingClientRect();
    // 将 CSS 像素转换为 Canvas 内部像素（处理浏览器缩放、高清屏幕等）
    const scaleX = mapCanvas.width / rect.width;
    const scaleY = mapCanvas.height / rect.height;
    const px = ((sx - rect.left) * scaleX) / zoom;
    const py = ((sy - rect.top) * scaleY) / zoom;

    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(zoom)) {
      return { x: -1, y: -1 };
    }

    // 加上 camera 偏移（与 renderer 中 tile 坐标计算保持一致）
    const origin = MapModule.tileToPixel(cameraX, cameraY);
    const worldPx = px + origin.x;
    const worldPy = py + origin.y;

    return MapModule.pixelToTile(worldPx, worldPy);
  }

  // 设置 camera 位置（限制范围，并强制为偶数坐标，避免等距网格奇偶错位）
  function setCamera(x, y) {
    cameraX = Math.max(0, Math.min(MapModule.MAP_WIDTH - 1, Math.floor(x / 2) * 2));
    cameraY = Math.max(0, Math.min(MapModule.MAP_HEIGHT - 1, Math.floor(y / 2) * 2));
  }

  // 滚轮缩放（步进 0.5，即 50%/100%/150%/200%...）
  function setZoom(newZoom) {
    if (!Number.isFinite(newZoom)) return;
    zoom = Math.max(0.5, Math.min(3.0, Math.round(newZoom * 2) / 2));
  }

  function getZoom() { return zoom; }

  // 工具操作
  function setTool(tool) { 
    currentTool = tool; 
    const canvas = document.getElementById('map-canvas');
    if (canvas) {
      canvas.style.cursor = (tool === TOOLS.SELECT) ? 'default' : 'crosshair';
    }
  }
  function getTool() { return currentTool; }
  function setLayer(layer) { currentLayer = layer; }
  function getLayer() { return currentLayer; }
  function setSelectedTile(id) { selectedTile = id; }
  function getSelectedTile() { return selectedTile; }

  function setShowBarrier(v) { showBarrier = v; }
  function getShowBarrier() { return showBarrier; }
  function setShowObject(v) { showObject = v; }
  function getShowObject() { return showObject; }
  function setShowL0(v) { showL0 = v; }
  function getShowL0() { return showL0; }
  function setShowL1(v) { showL1 = v; }
  function getShowL1() { return showL1; }

  function setShowGrid(v) { showGrid = v; }
  function getShowGrid() { return showGrid; }
  function setShowEventChar(v) { showEventChar = v; }
  function getShowEventChar() { return showEventChar; }
  function setShowEventLabel(v) { showEventLabel = v; }
  function getShowEventLabel() { return showEventLabel; }
  function setDrawEventBoxes(v) { drawEventBoxes = v; }
  function getDrawEventBoxes() { return drawEventBoxes; }

  function loadCharImage(imageId, suffix) {
    const key = imageId + '-' + suffix;
    // 已加载成功且 complete，直接返回
    if (charCache[key] instanceof Image && charCache[key].complete && charCache[key].naturalWidth > 0) {
      return charCache[key];
    }
    const url = './char/' + key + '.png';
    const img = new Image();
    charCache[key] = img;
    img.onload = () => { charCache[key] = img; };
    img.onerror = () => { charCache[key] = null; };
    img.src = url;
    return img;
  }

  function getCharImage(imageId, suffix) {
    const key = imageId + '-' + suffix;
    const img = charCache[key];
    if (img instanceof Image && img.complete && img.naturalWidth > 0) return img;
    return null;
  }

  function setMouseTile(x, y) { mouseTileX = x; mouseTileY = y; }
  function getMouseTile() { return { x: mouseTileX, y: mouseTileY }; }
  function setSelTile(x, y) { 
    selectedTiles.clear();
    primarySelTile = { x, y };
    if (x >= 0 && y >= 0) selectedTiles.add(x + ',' + y);
  }
  function getSelTile() { return primarySelTile; }

  function getCamera() { return { x: cameraX, y: cameraY }; }

  function setIsMouseDown(v) { isMouseDown = v; }
  function getIsMouseDown() { return isMouseDown; }
  function setIsDragging(v) { isDragging = v; }
  function getIsDragging() { return isDragging; }

  // mouseDownPos 记录 mousedown 时的位置（用于区分点击与拖动）
  function setMouseDownPos(x, y, tileX, tileY) {
    mouseDownPos = { x, y, tileX, tileY };
  }
  function getMouseDownPos() { return mouseDownPos; }
  function isDragThresholdReached(cx, cy) {
    const dx = cx - mouseDownPos.x;
    const dy = cy - mouseDownPos.y;
    return Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD;
  }

  function setLastDrag(x, y) { lastDragX = x; lastDragY = y; }
  function getLastDrag() { return { x: lastDragX, y: lastDragY }; }

  // 多选 API
  function addSelTile(x, y) {
    if (x >= 0 && y >= 0) {
      selectedTiles.add(x + ',' + y);
      primarySelTile = { x, y };
    }
  }
  function removeSelTile(x, y) {
    selectedTiles.delete(x + ',' + y);
    if (primarySelTile.x === x && primarySelTile.y === y) {
      const first = selectedTiles.values().next().value;
      if (first) {
        const [fx, fy] = first.split(',').map(Number);
        primarySelTile = { x: fx, y: fy };
      } else {
        primarySelTile = { x: -1, y: -1 };
      }
    }
  }
  function toggleSelTile(x, y) {
    const key = x + ',' + y;
    if (selectedTiles.has(key)) removeSelTile(x, y);
    else addSelTile(x, y);
  }
  function isTileSelected(x, y) { return selectedTiles.has(x + ',' + y); }
  function getSelectedTiles() {
    const arr = [];
    selectedTiles.forEach(key => {
      const [x, y] = key.split(',').map(Number);
      arr.push({ x, y });
    });
    return arr;
  }
  function getSelectedTileCount() { return selectedTiles.size; }
  function clearSelTiles() { selectedTiles.clear(); primarySelTile = { x: -1, y: -1 }; }

  let boxSelectBaseTiles = null; // 框选开始时的基础选中集合

  function startBoxSelect(startTileX, startTileY, mode) {
    isBoxSelecting = true;
    boxSelectState = { startTile: { x: startTileX, y: startTileY }, currentTile: { x: startTileX, y: startTileY }, mode };
    // 首次框选（之前选择不超过1个）：不保留基础选择；已有框选状态（>1个）：保留基础选择
    boxSelectBaseTiles = (selectedTiles.size > 1 && mode === 'add') ? new Set(selectedTiles) : new Set();
  }
  function updateBoxSelect(currentTileX, currentTileY) {
    if (boxSelectState) boxSelectState.currentTile = { x: currentTileX, y: currentTileY };
  }
  function endBoxSelect() {
    isBoxSelecting = false;
    boxSelectState = null;
    boxSelectBaseTiles = null; // 框选结束，释放引用
  }
  function getBoxSelectBaseTiles() { return boxSelectBaseTiles || new Set(); }
  function isBoxSelectingActive() { return isBoxSelecting; }
  function getBoxSelectState() { return boxSelectState; }

  // 应用编辑操作
  function applyEdit(tx, ty) {
    if (!MapModule.assert(tx, ty)) return false;

    let changed = false;
    switch (currentTool) {
      case TOOLS.PEN:
        if (selectedTile >= 0) {
          MapModule.setTileImage(tx, ty, currentLayer, selectedTile + currentLayer);
          changed = true;
        }
        break;
      case TOOLS.ERASE:
        MapModule.setTile(tx, ty, currentLayer, 0);
        changed = true;
        break;
      case TOOLS.BARRIER:
        const barrier = !MapModule.getTileBarrier(tx, ty);
        MapModule.setTileBarrierValue(tx, ty, barrier);
        changed = true;
        break;
      case TOOLS.TEMPLATE:
        pasteTemplate(tx, ty);
        changed = true;
        break;
    }
    return changed;
  }

  // 模板系统
  function addToTemplate(tx, ty) {
    if (templateTiles.length === 0) {
      templateBaseX = tx;
      templateBaseY = ty;
      templateTiles.push({ x: 0, y: 0 });
    } else {
      templateTiles.push({ x: tx - templateBaseX, y: ty - templateBaseY });
    }
  }

  function clearTemplate() {
    templateTiles = [];
  }

  function getTemplate() {
    return {
      tiles: templateTiles,
      baseX: templateBaseX,
      baseY: templateBaseY,
    };
  }

  function pasteTemplate(destX, destY) {
    if (templateTiles.length === 0) return;
    const baseX = templateBaseX;
    const baseY = templateBaseY;
    const baseParity = baseX & 1;
    const destParity = destX & 1;

    for (const t of templateTiles) {
      let offsetX = t.x;
      let offsetY = t.y;

      if (baseParity !== destParity) {
        offsetY += (destParity - baseParity) * (t.x & 1);
      }

      const tx = destX + offsetX;
      const ty = destY + offsetY;
      if (!MapModule.assert(tx, ty)) continue;

      const srcX = baseX + t.x;
      const srcY = baseY + t.y;
      if (!MapModule.assert(srcX, srcY)) continue;

      const layer0 = MapModule.getTile(srcX, srcY, 0);
      const layer1 = MapModule.getTile(srcX, srcY, 1);

      MapModule.setTile(tx, ty, 0, layer0);
      MapModule.setTile(tx, ty, 1, layer1);
    }
  }

  // 根据当前选中区域创建模板，按 showL0/showL1 决定保留哪些层
  function createTemplateFromSelection() {
    const tiles = getSelectedTiles();
    if (tiles.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of tiles) {
      minX = Math.min(minX, t.x);
      maxX = Math.max(maxX, t.x);
      minY = Math.min(minY, t.y);
      maxY = Math.max(maxY, t.y);
    }

    const tplTiles = [];
    for (const t of tiles) {
      const layer0Data = showL0 ? MapModule.getTile(t.x, t.y, 0) : 0;
      const layer1Data = showL1 ? MapModule.getTile(t.x, t.y, 1) : 0;
      const item = {
        x: t.x - minX,
        y: t.y - minY,
        layer0: showL0 ? MapModule.getLayerImage(layer0Data) : -1,
        height0: showL0 ? MapModule.getLayerHeight(layer0Data) : 0,
        layer1: showL1 ? MapModule.getLayerImage(layer1Data) : 0,
        height1: showL1 ? MapModule.getLayerHeight(layer1Data) : 0,
        barrier: MapModule.getTileBarrier(t.x, t.y)
      };
      // 至少有一层数据或障碍才保留
      if (item.layer0 >= 0 || item.layer1 > 0 || item.barrier) {
        tplTiles.push(item);
      }
    }
    if (tplTiles.length === 0) return null;

    return {
      tiles: tplTiles,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
      baseParity: minX & 1
    };
  }

  return {
    TOOLS,
    init,
    setTool, getTool,
    setLayer, getLayer,
    setSelectedTile, getSelectedTile,
    setShowBarrier, getShowBarrier,
    setShowObject, getShowObject,
    setShowL0, getShowL0,
    setShowL1, getShowL1,
    setShowGrid, getShowGrid,
    setShowEventChar, getShowEventChar,
    setShowEventLabel, getShowEventLabel,
    setDrawEventBoxes, getDrawEventBoxes,
    loadCharImage, getCharImage,
    setMouseTile, getMouseTile,
    setSelTile, getSelTile,
    addSelTile, removeSelTile, toggleSelTile, isTileSelected,
    getSelectedTiles, getSelectedTileCount, clearSelTiles,
    startBoxSelect, updateBoxSelect, endBoxSelect,
    isBoxSelectingActive, getBoxSelectState, getBoxSelectBaseTiles,
    getCamera, setCamera,
    getZoom, setZoom,
    screenToTile,
    setIsMouseDown, getIsMouseDown,
    setIsDragging, getIsDragging,
    setMouseDownPos, getMouseDownPos, isDragThresholdReached,
    setLastDrag, getLastDrag,
    applyEdit,
    addToTemplate, clearTemplate, getTemplate, pasteTemplate,
    createTemplateFromSelection,
    get mouseImg() { return mouseImg; },
    get selImg() { return selImg; },
    get barrierImg() { return barrierImg; },
    get objectImg() { return objectImg; },
    get eventImg() { return eventImg; },
    pushUndo, undo, redo, clearUndoPushed, clearUndoRedo, canUndo, canRedo,
    setTileSnapshotProvider, setTileRestoreProvider,
    // 事件
    getEvents, setEvents, clearEvents,
    addEvent, removeEvent, getEvent, updateEvent, getEventsAtTile,
    setSelectedEventId, getSelectedEventId,
    setShowEvents, getShowEvents, findEventAt,
    copyEvent, pasteEvent, hasCopiedEvent,
    setNextEventId,
    getEventMovePath,
    updateAnimation,
  };
})();