const App = (function () {
  let isRunning = false;
  let resourcesLoaded = false;

  async function init() {
    console.log('仙剑地图编辑器 (网页版) 初始化中...');

    // 初始化渲染器
    const mapContainer = document.getElementById('map-container');
    Renderer.init('map-canvas', 'minimap-canvas');
    Renderer.resize(mapContainer.clientWidth, mapContainer.clientHeight);

    // 初始化编辑器
    Editor.init();

    // 初始化模板编辑器
    TemplateEditor.init();

    // 初始化 UI
    UI.init();

    // 绑定窗口大小变化
    window.addEventListener('resize', () => {
      Renderer.resize(mapContainer.clientWidth, mapContainer.clientHeight);
    });

    // 启动主循环
    isRunning = true;
    requestAnimationFrame(mainLoop);

    console.log('基础初始化完成，开始自动加载资源...');
    UI.updateStatus('正在自动加载资源...');

    // 自动加载资源
    try {
      await autoLoadResources();
      resourcesLoaded = true;
      UI.updateStatus('资源加载完成');
    } catch (e) {
      console.error('自动加载资源失败:', e);
      UI.updateStatus('自动加载失败，请手动加载 Pat.mkf');
    }
  }

  // 自动加载所有资源
  async function autoLoadResources() {
    // 1. 加载调色板
    UI.updateStatus('正在加载 Pat.mkf 调色板...');
    const palette = await PaletteModule.load('./Pat.mkf');
    if (!palette) throw new Error('Pat.mkf 加载失败');
    console.log('调色板加载完成');

    // 2. 扫描 GOP 和 MAP 文件列表
    UI.updateStatus('正在扫描资源文件...');
    const gopList = await scanFileList('./gop/gop', 0, 230);
    const mapList = await scanFileList('./map/map', 0, 230);
    console.log('GOP 文件:', gopList.length, '个');
    console.log('MAP 文件:', mapList.length, '个');

    // 填充下拉列表
    UI.fillGopSelect(gopList);
    UI.fillMapSelect(mapList);

    // 3. 加载默认 GOP 图组（第一个非空的）
    let defaultGop = gopList.find(f => f !== 'gop0000') || gopList[0];
    if (defaultGop) {
      UI.updateStatus('正在加载 ' + defaultGop + '...');
      await UI.loadGopByName(defaultGop);
    }

    // 4. 加载默认地图（第一个非空的）
    let defaultMap = mapList.find(f => f !== 'map0000') || mapList[0];
    if (defaultMap) {
      UI.updateStatus('正在加载 ' + defaultMap + '...');
      await UI.loadMapByName(defaultMap);
    }

    UI.updateStatus('就绪');
  }

  // 扫描文件列表，通过 HEAD 请求验证存在
  async function scanFileList(basePath, start, end) {
    const list = [];
    const promises = [];
    for (let i = start; i <= end; i++) {
      const num = String(i).padStart(4, '0');
      const fileName = basePath.split('/').pop() + num;
      const url = basePath + num;
      promises.push(
        fetch(url, { method: 'HEAD' })
          .then(res => {
            if (res.ok && res.headers.get('content-length') !== '0') {
              list.push(fileName);
            }
          })
          .catch(() => {})
      );
    }
    await Promise.allSettled(promises);
    return list.sort();
  }

  function mainLoop() {
    if (!isRunning) return;

    const tiles = UI.getTiles();
    const miniTiles = UI.getMiniTiles();
    const cam = Editor.getCamera();
    const mouseTile = Editor.getMouseTile();
    const selTile = Editor.getSelTile();

    // 更新 Canvas 大小以匹配容器
    const mapCanvas = document.getElementById('map-canvas');
    const container = document.getElementById('map-container');
    if (mapCanvas.width !== container.clientWidth || mapCanvas.height !== container.clientHeight) {
      Renderer.resize(container.clientWidth, container.clientHeight);
    }

    if (tiles) {
      Renderer.renderMap(
        cam.x, cam.y,
        Editor.getZoom(),
        tiles,
        Editor.getShowL0(),
        Editor.getShowL1(),
        Editor.getShowBarrier(),
        Editor.getShowObject(),
        Editor.objectImg,
        mouseTile,
        selTile,
        Editor.barrierImg,
        Editor.mouseImg,
        Editor.selImg,
        UI.getPreviewTemplate(),
        UI.getPreviewPos()
      );
    } else {
      // 没有图块，显示提示
      const ctx = mapCanvas.getContext('2d');
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
      ctx.fillStyle = '#888';
      ctx.font = '16px Microsoft YaHei';
      ctx.textAlign = 'center';
      ctx.fillText('正在加载资源...', mapCanvas.width / 2, mapCanvas.height / 2);
    }

    UI.updateMapStatus();

    requestAnimationFrame(mainLoop);
  }

  return { init };
})();

// 页面加载完成后启动
document.addEventListener('DOMContentLoaded', App.init);
