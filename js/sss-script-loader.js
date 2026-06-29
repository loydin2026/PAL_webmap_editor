const SssScriptLoader = (function () {
  let scriptData = null;

  function load(buffer) {
    scriptData = new Uint8Array(buffer);
  }

  function isLoaded() {
    return scriptData !== null;
  }

  // 解析指定脚本ID的指令序列
  function parseScript(scriptId) {
    if (!scriptData) return [];
    const offset = scriptId * 8;
    if (offset >= scriptData.length) return [];

    const instructions = [];
    let pos = offset;
    while (pos + 8 <= scriptData.length) {
      const cmd = scriptData[pos] | (scriptData[pos + 1] << 8);
      const p1 = scriptData[pos + 2] | (scriptData[pos + 3] << 8);
      const p2 = scriptData[pos + 4] | (scriptData[pos + 5] << 8);
      const p3 = scriptData[pos + 6] | (scriptData[pos + 7] << 8);

      instructions.push({ cmd, p1, p2, p3, offset: pos });

      if (cmd === 0) break; // 0000 结束指令
      pos += 8;
    }
    return instructions;
  }

  // 从指令中提取移动路径点（编辑器 tile 坐标）
  function extractMovePath(scriptId) {
    const instructions = parseScript(scriptId);
    const points = [];

    for (const inst of instructions) {
      const cmd = inst.cmd & 0xFF;
      switch (cmd) {
        case 0x10: // 事件移动(直接) — 像素坐标
        case 0x11: // 事件移动(忽略地形)
        case 0x44: // 滑动到某坐标
          {
            // PAL 原始像素坐标: X = p1*32 + p3*16, Y = p2*16 + p3*8
            // 编辑器 pixelToTile: tx = floor(px/32), ty = floor((py-(tx%2)*16)/32)
            // 其中 px = X*2, py = Y*2
            // tx = floor((p1*32 + p3*16)*2 / 32) = floor(p1*2 + p3) = p1*2 + p3
            // ty = floor((p2*16 + p3*8)*2 / 32) = floor((p2*32 + p3*16)/32) = p2 (p3=0或1时)
            const tx = inst.p1 * 2 + inst.p3;
            const ty = inst.p2;
            points.push({ type: cmd === 0x44 ? 'slide' : 'move', x: tx, y: ty });
          }
          break;
        case 0x3F: // 移动到某坐标 (p1=事件地址, p2=X, p3=Y)
          if (inst.p1 === 0xFFFF) {
            // p2, p3 是编辑器 tile 坐标（直接值）
            points.push({ type: 'move', x: inst.p2, y: inst.p3 });
          }
          break;
        case 0x70: // 走动
        case 0x7A: // 走动
        case 0x7B: // 走动
        case 0x97: // 移动
          // p1, p2 是编辑器 tile 坐标（直接值）
          points.push({ type: 'walk', x: inst.p1, y: inst.p2 });
          break;
        case 0x00: // 结束指令
          return points;
      }
    }
    return points;
  }

  // 获取脚本摘要（用于调试/显示）
  function getScriptSummary(scriptId) {
    const instructions = parseScript(scriptId);
    const moveCount = instructions.filter(i => {
      const c = i.cmd & 0xFF;
      return [0x10, 0x11, 0x44, 0x3F, 0x70, 0x7A, 0x7B, 0x97].includes(c);
    }).length;
    return {
      totalInstructions: instructions.length,
      moveCount,
      hasEnd: instructions.some(i => i.cmd === 0)
    };
  }

  return {
    load,
    isLoaded,
    parseScript,
    extractMovePath,
    getScriptSummary
  };
})();