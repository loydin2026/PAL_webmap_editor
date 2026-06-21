const Editor = (function () {
  // 编辑状态
  const TOOLS = {
    SELECT: 'select',
    PEN: 'pen',
    TEMPLATE: 'template',
    ERASE: 'erase',
    BARRIER: 'barrier',
  };

  let currentTool = TOOLS.SELECT;
  let currentLayer = 0; // 0 或 1
  let selectedTile = -1; // 图块编号（用于画笔）
  let cameraX = 0;
  let cameraY = 0;
  let mouseTileX = -1;
  let mouseTileY = -1;
  let selTileX = -1;
  let selTileY = -1;
  let isMouseDown = false;
  let isDragging = false;
  let lastDragX = 0;
  let lastDragY = 0;
  let zoom = 1.0;

  // 显示选项
  let showBarrier = false;
  let showObject = false;
  let showL0 = true;
  let showL1 = true;

  // 模板
  let templateTiles = []; // {x, y} 数组，相对于基点
  let templateBaseX = 0;
  let templateBaseY = 0;

  // 标记图像（ImageData）
  let mouseImg = null;
  let selImg = null;
  let barrierImg = null;
  let objectImg = null;

  // 撤销/重做栈
  const MAX_HISTORY = 50;
  let undoStack = [];
  let redoStack = [];
  let undoPushed = false;

  function pushUndo() {
    if (!undoPushed) {
      const snapshot = MapModule.saveMap();
      undoStack.push(snapshot);
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack = [];
      undoPushed = true;
    }
  }

  function undo() {
    if (undoStack.length === 0) return false;
    redoStack.push(MapModule.saveMap());
    if (redoStack.length > MAX_HISTORY) redoStack.shift();
    const buffer = undoStack.pop();
    MapModule.loadMap(buffer);
    return true;
  }

  function redo() {
    if (redoStack.length === 0) return false;
    undoStack.push(MapModule.saveMap());
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    const buffer = redoStack.pop();
    MapModule.loadMap(buffer);
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

  function init() {
    // 加载标记图像（PNG 自带 alpha 通道，无需手动处理透明色）
    loadImage('assets/bitmap1.png', (img) => { mouseImg = img; });
    loadImage('assets/bitmap2.png', (img) => { selImg = img; });
    loadImage('assets/bitmap3.png', (img) => { barrierImg = img; });
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
    const px = (sx - rect.left) / zoom;
    const py = (sy - rect.top) / zoom;

    // 加上 camera 偏移和中心偏移
    const origin = MapModule.tileToPixel(cameraX, cameraY);
    const worldPx = px + origin.x + 32; // 32 是 TILE_HALF_W
    const worldPy = py + origin.y + 16; // 16 是 TILE_HALF_H

    return MapModule.pixelToTile(worldPx, worldPy);
  }

  // 设置 camera 位置（限制范围，允许滚动到地图边缘）
  function setCamera(x, y) {
    cameraX = Math.max(0, Math.min(MapModule.MAP_WIDTH - 1, x));
    cameraY = Math.max(0, Math.min(MapModule.MAP_HEIGHT - 1, y));
  }

  // 滚轮缩放
  function setZoom(newZoom) {
    zoom = Math.max(0.5, Math.min(3.0, newZoom));
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

  function setMouseTile(x, y) { mouseTileX = x; mouseTileY = y; }
  function getMouseTile() { return { x: mouseTileX, y: mouseTileY }; }
  function setSelTile(x, y) { selTileX = x; selTileY = y; }
  function getSelTile() { return { x: selTileX, y: selTileY }; }

  function getCamera() { return { x: cameraX, y: cameraY }; }

  function setIsMouseDown(v) { isMouseDown = v; }
  function getIsMouseDown() { return isMouseDown; }
  function setIsDragging(v) { isDragging = v; }
  function getIsDragging() { return isDragging; }
  function setLastDrag(x, y) { lastDragX = x; lastDragY = y; }
  function getLastDrag() { return { x: lastDragX, y: lastDragY }; }

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
        if ((t.x & 1) === baseParity) {
          offsetY -= 1;
        }
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
    setMouseTile, getMouseTile,
    setSelTile, getSelTile,
    getCamera, setCamera,
    getZoom, setZoom,
    screenToTile,
    setIsMouseDown, getIsMouseDown,
    setIsDragging, getIsDragging,
    setLastDrag, getLastDrag,
    applyEdit,
    addToTemplate, clearTemplate, getTemplate, pasteTemplate,
    get mouseImg() { return mouseImg; },
    get selImg() { return selImg; },
    get barrierImg() { return barrierImg; },
    get objectImg() { return objectImg; },
    pushUndo, undo, redo, clearUndoPushed, clearUndoRedo, canUndo, canRedo,
  };
})();
