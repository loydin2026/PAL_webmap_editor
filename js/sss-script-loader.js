const SssScriptLoader = (function () {
  let scriptData = null;

  function load(buffer) {
    scriptData = new Uint8Array(buffer);
  }

  function isLoaded() {
    return scriptData !== null;
  }

  // 可修改的脚本数据副本（用于编辑后保存）
  let modifiedData = null;
  let originalData = null;
  let modified = false;

  function load(buffer) {
    const data = new Uint8Array(buffer);
    scriptData = new Uint8Array(data);   // 独立副本用于读取
    originalData = new Uint8Array(data); // 独立副本用于还原
    modifiedData = new Uint8Array(data); // 可编辑副本
    modified = false;
  }

  function isLoaded() {
    return scriptData !== null;
  }

  function isModified() {
    return modified;
  }

  function getModifiedData() {
    if (!modifiedData) return null;
    return modifiedData.buffer.slice(0);
  }

  function reset() {
    if (originalData) {
      modifiedData = new Uint8Array(originalData);
      modified = false;
    }
  }

  // 获取脚本缓冲区大小
  function getBufferSize() {
    return modifiedData ? modifiedData.length : 0;
  }

  // 修改指定偏移处的指令（16字节）
  function setInstruction(offset, cmd, p1, p2, p3) {
    if (!modifiedData || offset + 8 > modifiedData.length) return false;
    const dv = new DataView(modifiedData.buffer, modifiedData.byteOffset, modifiedData.byteLength);
    dv.setUint16(offset, cmd, true);
    dv.setUint16(offset + 2, p1, true);
    dv.setUint16(offset + 4, p2, true);
    dv.setUint16(offset + 6, p3, true);
    modified = true;
    return true;
  }

  // 读取指定偏移处的指令
  function getInstruction(offset) {
    if (!modifiedData || offset + 8 > modifiedData.length) return null;
    const dv = new DataView(modifiedData.buffer, modifiedData.byteOffset, modifiedData.byteLength);
    return {
      cmd: dv.getUint16(offset, true),
      p1: dv.getUint16(offset + 2, true),
      p2: dv.getUint16(offset + 4, true),
      p3: dv.getUint16(offset + 6, true)
    };
  }

  // 在脚本末尾追加新指令（需要确保有足够空间）
  function appendInstruction(cmd, p1, p2, p3) {
    if (!modifiedData) return false;
    // 找到第一个 0000 结束指令的位置，替换为新指令 + 0000
    let pos = 0;
    const dv = new DataView(modifiedData.buffer, modifiedData.byteOffset, modifiedData.byteLength);
    while (pos + 8 <= modifiedData.length) {
      const c = dv.getUint16(pos, true);
      if (c === 0) {
        // 在结束指令前插入新指令
        if (pos + 16 <= modifiedData.length) {
          // 将结束指令后移
          for (let i = modifiedData.length - 1; i >= pos + 8; i--) {
            modifiedData[i] = modifiedData[i - 8];
          }
        }
        setInstruction(pos, cmd, p1, p2, p3);
        setInstruction(pos + 8, 0, 0, 0, 0);
        modified = true;
        return true;
      }
      pos += 8;
    }
    return false;
  }

  // 在指定偏移处插入新指令（将后续指令后移）
  function insertInstruction(offset, cmd, p1, p2, p3) {
    if (!modifiedData) return false;
    // 创建新的缓冲区，增加 8 字节
    const newData = new Uint8Array(modifiedData.length + 8);
    newData.set(modifiedData);
    // 将 offset 之后的所有数据后移 8 字节
    for (let i = newData.length - 1; i >= offset + 8; i--) {
      newData[i] = newData[i - 8];
    }
    // 在 offset 处写入新指令
    const dv = new DataView(newData.buffer, newData.byteOffset, newData.byteLength);
    dv.setUint16(offset, cmd, true);
    dv.setUint16(offset + 2, p1, true);
    dv.setUint16(offset + 4, p2, true);
    dv.setUint16(offset + 6, p3, true);
    modifiedData = newData;
    modified = true;
    return true;
  }

  // 删除指定偏移处的指令（将后续指令前移，并减少缓冲区）
  function deleteInstruction(offset) {
    if (!modifiedData || offset + 8 > modifiedData.length) return false;
    const newData = new Uint8Array(modifiedData.length - 8);
    newData.set(modifiedData.subarray(0, offset));
    newData.set(modifiedData.subarray(offset + 8), offset);
    modifiedData = newData;
    modified = true;
    return true;
  }

  // 在脚本数据末尾创建一个新脚本段（仅包含 0000 结束指令），返回新脚本地址
  function createNewScript() {
    if (!modifiedData) return -1;
    const oldLen = modifiedData.length;
    const newData = new Uint8Array(oldLen + 8);
    newData.set(modifiedData);
    // 新追加的 8 字节已经是 0（Uint8Array 默认初始化）
    modifiedData = newData;
    modified = true;
    // 返回新脚本地址（偏移量 / 8）
    return Math.floor(oldLen / 8);
  }

  // 扫描所有指令并应用回调（用于自动修复事件引用）
  function scanAllInstructions(callback) {
    if (!modifiedData) return;
    const dv = new DataView(modifiedData.buffer, modifiedData.byteOffset, modifiedData.byteLength);
    let pos = 0;
    while (pos + 8 <= modifiedData.length) {
      const cmd = dv.getUint16(pos, true);
      const p1 = dv.getUint16(pos + 2, true);
      const p2 = dv.getUint16(pos + 4, true);
      const p3 = dv.getUint16(pos + 6, true);
      const result = callback(pos, cmd, p1, p2, p3);
      if (result === false) break;
      pos += 8;
    }
  }

  // 自动修复事件引用（当事件索引发生偏移时）
  function fixEventReferences(insertIndex, offset) {
    if (!modifiedData || offset === 0) return;
    scanAllInstructions((pos, cmd, p1, p2, p3) => {
      if (cmd === 0) return true; // 跳过结束指令
      // 0x13 PlaceEvent: p1 = 事件编号
      // 0x24 ChangeAutoScript: p1 = 事件编号
      // 0x25 ChangeTriggerScript: p1 = 事件编号
      let newP1 = p1, newP2 = p2, newP3 = p3, changed = false;
      if (cmd === 0x0013 || cmd === 0x0024 || cmd === 0x0025) {
        if (p1 >= insertIndex) {
          newP1 = p1 + offset;
          changed = true;
        }
      }
      if (changed) {
        setInstruction(pos, cmd, newP1, newP2, newP3);
      }
      return true;
    });
  }

  // 解析指定脚本ID的指令序列
  function parseScript(scriptId) {
    if (!scriptData) return [];
    const offset = scriptId * 8;
    if (offset >= modifiedData.length) return [];

    const instructions = [];
    let pos = offset;
    const dv = new DataView(modifiedData.buffer, modifiedData.byteOffset, modifiedData.byteLength);
    while (pos + 8 <= modifiedData.length) {
      const cmd = dv.getUint16(pos, true);
      const p1 = dv.getUint16(pos + 2, true);
      const p2 = dv.getUint16(pos + 4, true);
      const p3 = dv.getUint16(pos + 6, true);

      instructions.push({ cmd, p1, p2, p3, offset: pos });

      if (cmd === 0) break; // 0000 结束指令
      pos += 8;
    }
    return instructions;
  }

  // 从指令中提取移动路径点（编辑器 tile 坐标）
  function extractMovePath(scriptId, startX, startY) {
    const instructions = parseScript(scriptId);
    const points = [];
    let currX = startX !== undefined ? startX : 0;
    let currY = startY !== undefined ? startY : 0;
    let pendingDir = null; // 未配对的半步方向

    function moveByDir(dir) {
      if (typeof MapModule !== 'undefined') {
        const n = MapModule.getNeighborTile(currX, currY, dir);
        currX = n.x; currY = n.y;
      } else {
        switch (dir) {
          case 1: currX++; break; // 右下
          case 2: currY++; break; // 左下
          case 3: currX--; break; // 左上
          case 4: currY--; break; // 右上
        }
      }
      points.push({ type: 'walk', x: currX, y: currY });
    }

    for (const inst of instructions) {
      const cmd = inst.cmd & 0xFF;
      switch (cmd) {
        case 0x10: // 事件移动(直接) — 像素坐标
        case 0x11: // 事件移动(忽略地形)
        case 0x44: // 滑动到某坐标
          {
            // 先完成任何未配对的半步
            if (pendingDir !== null) {
              moveByDir(pendingDir);
              pendingDir = null;
            }
            currX = inst.p1 * 2 + inst.p3;
            currY = inst.p2;
            points.push({ type: cmd === 0x44 ? 'slide' : 'move', x: currX, y: currY });
          }
          break;
        case 0x3F: // 移动到某坐标 (p1=事件地址, p2=X, p3=Y)
          if (inst.p1 === 0xFFFF) {
            if (pendingDir !== null) {
              moveByDir(pendingDir);
              pendingDir = null;
            }
            currX = inst.p2;
            currY = inst.p3;
            points.push({ type: 'move', x: currX, y: currY });
          }
          break;
        case 0x70: // 走动
        case 0x7A: // 走动
        case 0x7B: // 走动
        case 0x97: // 移动
          {
            if (pendingDir !== null) {
              moveByDir(pendingDir);
              pendingDir = null;
            }
            currX = inst.p1;
            currY = inst.p2;
            points.push({ type: 'walk', x: currX, y: currY });
          }
          break;
        case 0x0B: // 西
        case 0x0C: // 北
        case 0x0D: // 东
        case 0x0E: // 南
          {
            const dirMap = { 0x0B: 3, 0x0C: 4, 0x0D: 1, 0x0E: 2 };
            const dir = dirMap[cmd];
            if (pendingDir === dir) {
              // 同方向配对，完成一格移动
              moveByDir(dir);
              pendingDir = null;
            } else {
              // 如果之前有未配对的指令（不同方向），先完成它
              if (pendingDir !== null) {
                moveByDir(pendingDir);
              }
              // 当前指令设为待配对
              pendingDir = dir;
            }
          }
          break;
        case 0x87: // 本对象原地漫步（不生成路径点）
          break;
        case 0x00: // 结束指令
          {
            if (pendingDir !== null) {
              moveByDir(pendingDir);
            }
            return points;
          }
      }
    }
    // 脚本结束，处理未配对的半步
    if (pendingDir !== null) {
      moveByDir(pendingDir);
    }
    return points;
  }

  // 获取脚本摘要（用于调试/显示）
  function getScriptSummary(scriptId) {
    const instructions = parseScript(scriptId);
    const moveCount = instructions.filter(i => {
      const c = i.cmd & 0xFF;
      return [0x10, 0x11, 0x44, 0x3F, 0x70, 0x7A, 0x7B, 0x97, 0x0B, 0x0C, 0x0D, 0x0E, 0x87].includes(c);
    }).length;
    return {
      totalInstructions: instructions.length,
      moveCount,
      hasEnd: instructions.some(i => i.cmd === 0)
    };
  }

  // 中文指令名称表（hex值 -> 中文名称）
  const SCRIPT_NAMES = {
    0x0000: '结束(End)',
    0x0001: '中断/继续(Break)',
    0x0002: '中断重写(Interrupt)',
    0x0003: '跳转(Goto)',
    0x0004: '跳转返回(Goto-Return)',
    0x0005: '清屏(ClearScreen)',
    0x0006: '随机跳转(Random)',
    0x0007: '战斗(Battle)',
    0x0008: '重写下一行(RewriteNext)',
    0x0009: '不可移动(NoMove)',
    0x000A: '选择(Choice)',
    0x000B: '本对象向西行(WalkWest)',
    0x000C: '本对象向北行(WalkNorth)',
    0x000D: '本对象向东行(WalkEast)',
    0x000E: '本对象向南行(WalkSouth)',
    0x000F: '本对象转向(TurnTo)',
    0x0010: '移动到坐标(MoveTo)',
    0x0011: '移动到坐标(忽略地形)',
    0x0012: '改变图层(ChangeLayer)',
    0x0013: '放置事件(PlaceEvent)',
    0x0014: '改变形状(ChangeShape)',
    0x0015: '面向方向(FaceDir)',
    0x0016: '改变形状2(ChangeShape2)',
    0x0017: '装备属性加成(EquipAttr)',
    0x0018: '装备(Equip)',
    0x0019: '添加属性(AddAttr)',
    0x001A: '写入属性(WriteAttr)',
    0x001B: '恢复HP(HealHP)',
    0x001C: '恢复MP(HealMP)',
    0x001D: '恢复HP和MP(HealHPMP)',
    0x001E: '金钱(Money)',
    0x001F: '获得物品(GetItem)',
    0x0020: '失去物品(LoseItem)',
    0x0021: '伤害(Damage)',
    0x0022: '复活(Revive)',
    0x0023: '卸下装备(Unequip)',
    0x0024: '改变自动脚本(ChangeAuto)',
    0x0025: '改变触发脚本(ChangeTrigger)',
    0x0026: '商店(Shop)',
    0x0027: '当铺(PawnShop)',
    0x0028: '敌人中毒(EnemyPoison)',
    0x0029: '盟友中毒(AllyPoison)',
    0x002A: '敌人解毒(EnemyCure)',
    0x002B: '盟友解毒(AllyCure)',
    0x002C: '盟友群体解毒(AllyMultiCure)',
    0x002D: '盟友特殊状态(AllySpecial)',
    0x002E: '敌人特殊状态(EnemySpecial)',
    0x002F: '清除盟友特殊状态(AllyClear)',
    0x0030: '临时属性(TempAttr)',
    0x0031: '临时模型(TempModel)',
    0x0032: '战时平时分派(LOST)',
    0x0033: '灵葫咒(SpiritGourd)',
    0x0034: '灵葫炼丹(GourdAlchemy)',
    0x0035: '震动(Shake)',
    0x0036: '动画选择(AnimSelect)',
    0x0037: '播放动画(AnimPlay)',
    0x0038: '逃离迷宫(EscapeMaze)',
    0x0039: '吸取HP(DrainHP)',
    0x003A: '逃离战斗(EscapeBattle)',
    0x003B: '中心文字(CenterText)',
    0x003C: '左上角头像(TopLeftFace)',
    0x003D: '右下角头像(BottomRightFace)',
    0x003E: '框架(Frame)',
    0x003F: '移动到坐标2(MoveToCoord)',
    0x0040: '设置对象触发方式(SetTrigger)',
    0x0041: '术法无效(MagicInvalid)',
    0x0042: '物品魔法(ItemMagic)',
    0x0043: '背景音乐(BGM)',
    0x0044: '滑动到(SlideTo)',
    0x0045: '设置战斗音乐(SetBattleBGM)',
    0x0046: '方向(Direction)',
    0x0047: '音效(SFX)',
    0x0048: '音效相关(LOST)',
    0x0049: '设置对象状态(SetObjStatus)',
    0x004A: '设置战场环境(SetBattleField)',
    0x004B: '退出战斗(ExitBattle)',
    0x004E: '加载最后存档(LoadLastSave)',
    0x004F: '红色淡入(FadeRed)',
    0x0050: '黑色淡入(FadeBlack)',
    0x0051: '淡入(FadeIn)',
    0x0052: '本对象匿迹(Vanish)',
    0x0053: '下次切换日间(NextDay)',
    0x0054: '下次切换夜间(NextNight)',
    0x0055: '学习仙术(LearnMagic)',
    0x0056: '删除仙术(DeleteMagic)',
    0x0057: 'MP归1(MPto1)',
    0x0058: '物品不够则跳转(ItemCheck)',
    0x0059: '切换场景(Scene)',
    0x005A: 'HP减50%(HP-50%)',
    0x005B: '敌人HP减50%(EnemyHP-50%)',
    0x005C: '隐身(Invisibility)',
    0x005D: '三尸蛊毒(ThreeCorpse)',
    0x005E: '检查中毒(CheckPoison)',
    0x005F: 'HP归零(HP=0)',
    0x0060: '即死(InstantKill)',
    0x0061: '若该队员未中毒则跳转(IfNotPoisoned)',
    0x0062: '敌人停止追逐(StopChase)',
    0x0063: '敌人追逐加速(SpeedUpChase)',
    0x0064: '百分比检查(PercentCheck)',
    0x0065: '显示静态图像(ShowStatic)',
    0x0066: '投掷武器加成(ThrowBonus)',
    0x0067: '使用武功(UseKungFu)',
    0x0068: '检查敌人使用(CheckEnemyUsed)',
    0x0069: '敌人撤退(EnemyRetreat)',
    0x006A: '偷窃(Steal)',
    0x006B: '风神(WindGod)',
    0x006C: '图层控制(LayerControl)',
    0x006D: '检查场景(CheckScene)',
    0x006E: '方向阻挡(DirectionBlock)',
    0x0070: '走动(Walk)',
    0x0071: '视觉效果(VisualEffect)',
    0x0072: '更换对象形象(LOST)',
    0x0073: '消失(Disappear)',
    0x0074: '检查盟友受伤(CheckAllyInjured)',
    0x0075: '队伍调整(PartyAdjust)',
    0x0076: '显示图片(ShowImage)',
    0x0077: '关闭BGM(BGMOff)',
    0x0079: '检查队伍成员(CheckPartyMember)',
    0x007A: '走动2(Walk2)',
    0x007B: '走动3(Walk3)',
    0x007C: '本对象互斥走到(MoveToEx)',
    0x007D: '对象移动到(MoveObject)',
    0x007E: '设置对象所在层(SetLayer)',
    0x007F: '移动视线(MoveCamera)',
    0x0080: '日夜切换(DayNight)',
    0x0081: '若对象不在目视范围则跳转(IfOutOfSight)',
    0x0082: '本对象跑到(RunTo)',
    0x0083: '若对象不在范围则跳转(IfOutOfRange)',
    0x0084: '放置对象(PlaceObject)',
    0x0085: '延迟(Delay)',
    0x0086: '阴气(YinQi)',
    0x0087: '本对象原地漫步(Wander)',
    0x0088: '金钱投掷(WealthThrow)',
    0x0089: '结束战斗(EndBattle)',
    0x008A: '下一战自动战斗(AutoBattle)',
    0x008B: '视觉效果2(VisualEffect2)',
    0x008C: '黑白画面(B&W)',
    0x008D: '修行提升(LevelUp)',
    0x008E: '无图像左下(NoImageLeftBottom)',
    0x008F: '金钱减半(MoneyHalf)',
    0x0090: '敌人名称(EnemyName)',
    0x0091: '敌人使用(EnemyUse)',
    0x0092: '特殊姿势(SpecialPose)',
    0x0093: '淡入淡出(FadeInOut)',
    0x0094: '若对象为指定状态则跳转(IfObjStatus)',
    0x0095: '若在该场景则跳转(IfInScene)',
    0x0096: '决死行(Desperate)',
    0x0097: '移动(Move)',
    0x0098: '跟随人等(Followers)',
    0x0099: '改变场景对应地图(ChangeSceneMap)',
    0x009A: '改变图层2(ChangeLayer2)',
    0x009B: '场景淡入(FadeScene)',
    0x009C: '克隆(Clone)',
    0x009D: '若敌方复活失败则跳转(LOST)',
    0x009E: '召唤(Summon)',
    0x009F: '变形(Transform)',
    0x00A0: '退出游戏(QuitGame)',
    0x00A1: '拥挤(Crowded)',
    0x00A2: '跳转最终(JumpFinal)',
    0x00A3: '播放CD音轨(PlayCD)',
    0x00A4: '蛇头领(LeaderSnake)',
    0x00A5: '脚印(Footprints)',
    0x00A6: '输出显示缓冲(FlushScreen)',
    0x00FF: '消息(Message)',
    0x00FE: '消息2(Message2)',
    0xFFFF: '消息3(Message3)'
  };

  var SCRIPT_PARAMS = {
    0x0000: { p1: '无', p2: '无', p3: '无' },
    0x000B: { p1: '0', p2: '0', p3: '0' },
    0x000C: { p1: '0', p2: '0', p3: '0' },
    0x000D: { p1: '0', p2: '0', p3: '0' },
    0x000E: { p1: '0', p2: '0', p3: '0' },
    0x000F: { p1: '方向ID', p2: '帧', p3: '0' },
    0x0010: { p1: '目标X/2', p2: '目标Y', p3: 'X奇偶位' },
    0x0011: { p1: '目标X/2', p2: '目标Y', p3: 'X奇偶位' },
    0x0013: { p1: '事件ID', p2: '目标X', p3: '目标Y' },
    0x0014: { p1: '图像编号', p2: '0', p3: '0' },
    0x0015: { p1: '方向(0下/1左/2上/3右)', p2: '0', p3: '0' },
    0x0016: { p1: '图像编号', p2: '0', p3: '0' },
    0x0017: { p1: '0', p2: '0', p3: '0' },
    0x0018: { p1: '角色ID', p2: '装备位置', p3: '物品ID' },
    0x0019: { p1: '属性类型', p2: '增加值', p3: '角色ID' },
    0x001A: { p1: '属性类型', p2: '数值', p3: '角色ID' },
    0x001B: { p1: '角色ID', p2: '0', p3: '0' },
    0x001C: { p1: '角色ID', p2: '0', p3: '0' },
    0x001D: { p1: '角色ID', p2: '0', p3: '0' },
    0x001E: { p1: '金额(有符号)', p2: '0', p3: '0' },
    0x001F: { p1: '物品ID', p2: '数量', p3: '0' },
    0x0020: { p1: '物品ID', p2: '数量', p3: '0' },
    0x0021: { p1: '角色ID', p2: '伤害值', p3: '0' },
    0x0022: { p1: '角色ID', p2: '恢复HP', p3: '0' },
    0x0023: { p1: '角色ID', p2: '装备位置', p3: '0' },
    0x0024: { p1: '事件ID', p2: '脚本地址', p3: '0' },
    0x0025: { p1: '事件ID', p2: '脚本地址', p3: '0' },
    0x0026: { p1: '商店类型', p2: '0', p3: '0' },
    0x0027: { p1: '0', p2: '0', p3: '0' },
    0x0028: { p1: '0', p2: '0', p3: '0' },
    0x0029: { p1: '0', p2: '0', p3: '0' },
    0x002A: { p1: '0', p2: '0', p3: '0' },
    0x002B: { p1: '0', p2: '0', p3: '0' },
    0x002C: { p1: '0', p2: '0', p3: '0' },
    0x002D: { p1: '状态ID', p2: '0', p3: '0' },
    0x002E: { p1: '状态ID', p2: '0', p3: '0' },
    0x002F: { p1: '0', p2: '0', p3: '0' },
    0x0030: { p1: '属性', p2: '数值', p3: '0' },
    0x0031: { p1: '模型', p2: '0', p3: '0' },
    0x0032: { p1: '战时脚本', p2: '平时脚本', p3: '0' },
    0x0033: { p1: '0', p2: '0', p3: '0' },
    0x0034: { p1: '0', p2: '0', p3: '0' },
    0x0035: { p1: '强度', p2: '持续时间', p3: '0' },
    0x0036: { p1: '0', p2: '0', p3: '0' },
    0x0037: { p1: '0', p2: '0', p3: '0' },
    0x0038: { p1: '0', p2: '0', p3: '0' },
    0x0039: { p1: '0', p2: '0', p3: '0' },
    0x003A: { p1: '0', p2: '0', p3: '0' },
    0x003B: { p1: '消息编号', p2: '0', p3: '0' },
    0x003C: { p1: '头像编号', p2: '0', p3: '0' },
    0x003D: { p1: '头像编号', p2: '0', p3: '0' },
    0x003E: { p1: '0', p2: '0', p3: '0' },
    0x003F: { p1: '事件地址', p2: '目标X', p3: '目标Y' },
    0x0040: { p1: '对象ID', p2: '触发方式', p3: '0' },
    0x0041: { p1: '0', p2: '0', p3: '0' },
    0x0042: { p1: '物品ID', p2: '0', p3: '0' },
    0x0043: { p1: '音乐编号', p2: '0', p3: '0' },
    0x0044: { p1: '目标X/2', p2: '目标Y', p3: 'X奇偶位' },
    0x0045: { p1: '音乐ID', p2: '0', p3: '0' },
    0x0046: { p1: '方向', p2: '0', p3: '0' },
    0x0047: { p1: '音效编号', p2: '0', p3: '0' },
    0x0048: { p1: '0', p2: '0', p3: '0' },
    0x0049: { p1: '对象ID', p2: 'Int16', p3: '0' },
    0x004A: { p1: '图片ID', p2: '0', p3: '0' },
    0x004B: { p1: '0', p2: '0', p3: '0' },
    0x004C: { p1: 'Int16', p2: 'Int16', p3: 'Boolean' },
    0x004D: { p1: '0', p2: '0', p3: '0' },
    0x004E: { p1: '0', p2: '0', p3: '0' },
    0x004F: { p1: '时间(帧)', p2: '0', p3: '0' },
    0x0050: { p1: '时间(帧)', p2: '0', p3: '0' },
    0x0051: { p1: 'Boolean', p2: '0', p3: '0' },
    0x0052: { p1: '消失时间', p2: '0', p3: '0' },
    0x0053: { p1: '0', p2: '0', p3: '0' },
    0x0054: { p1: '0', p2: '0', p3: '0' },
    0x0055: { p1: '角色ID', p2: '仙术ID', p3: '0' },
    0x0056: { p1: '角色ID', p2: '仙术ID', p3: '0' },
    0x0057: { p1: '0', p2: '0', p3: '0' },
    0x0058: { p1: '物品ID', p2: '数量', p3: '跳转脚本' },
    0x0059: { p1: '场景编号', p2: '0', p3: '0' },
    0x005A: { p1: '0', p2: '0', p3: '0' },
    0x005B: { p1: '0', p2: '0', p3: '0' },
    0x005C: { p1: '0', p2: '0', p3: '0' },
    0x005D: { p1: '0', p2: '0', p3: '0' },
    0x005E: { p1: '0', p2: '0', p3: '0' },
    0x005F: { p1: '0', p2: '0', p3: '0' },
    0x0060: { p1: '0', p2: '0', p3: '0' },
    0x0061: { p1: '跳转脚本', p2: '0', p3: '0' },
    0x0062: { p1: '时间', p2: '0', p3: '0' },
    0x0063: { p1: '时间', p2: '0', p3: '0' },
    0x0064: { p1: '0', p2: '0', p3: '0' },
    0x0065: { p1: '图片编号', p2: '0', p3: '0' },
    0x0066: { p1: '0', p2: '0', p3: '0' },
    0x0067: { p1: '0', p2: '0', p3: '0' },
    0x0068: { p1: '0', p2: '0', p3: '0' },
    0x0069: { p1: '0', p2: '0', p3: '0' },
    0x006A: { p1: '0', p2: '0', p3: '0' },
    0x006B: { p1: '0', p2: '0', p3: '0' },
    0x006C: { p1: '0', p2: '0', p3: '0' },
    0x006D: { p1: '场景编号', p2: '0', p3: '0' },
    0x006E: { p1: '0', p2: '0', p3: '0' },
    0x0070: { p1: '步数', p2: '0', p3: '0' },
    0x0071: { p1: '效果编号', p2: '0', p3: '0' },
    0x0072: { p1: '对象ID', p2: 'Mgo号', p3: 'Boolean' },
    0x0073: { p1: '0', p2: '0', p3: '0' },
    0x0074: { p1: '0', p2: '0', p3: '0' },
    0x0075: { p1: '0', p2: '0', p3: '0' },
    0x0076: { p1: '图片ID', p2: '等待时间', p3: '0' },
    0x0077: { p1: '0', p2: '0', p3: '0' },
    0x0079: { p1: '角色ID', p2: '0', p3: '0' },
    0x007A: { p1: '步数', p2: '0', p3: '0' },
    0x007B: { p1: '步数', p2: '0', p3: '0' },
    0x007C: { p1: 'XBlock', p2: 'YBlock', p3: 'HalfBlock' },
    0x007D: { p1: '对象ID', p2: 'X偏移', p3: 'Y偏移' },
    0x007E: { p1: '对象ID', p2: '图层', p3: '0' },
    0x007F: { p1: 'X', p2: 'Y', p3: '次数' },
    0x0080: { p1: 'Boolean', p2: '0', p3: '0' },
    0x0081: { p1: '对象ID', p2: '工作距离', p3: '跳转脚本' },
    0x0082: { p1: 'XBlock', p2: 'YBlock', p3: 'HalfBlock' },
    0x0083: { p1: '对象ID', p2: '最大偏移', p3: '跳转脚本' },
    0x0084: { p1: '对象ID', p2: '触发方式', p3: '失败脚本' },
    0x0085: { p1: '帧数', p2: '0', p3: '0' },
    0x0086: { p1: '0', p2: '0', p3: '0' },
    0x0087: { p1: '0', p2: '0', p3: '0' },
    0x0088: { p1: '0', p2: '0', p3: '0' },
    0x0089: { p1: '0', p2: '0', p3: '0' },
    0x008A: { p1: '0', p2: '0', p3: '0' },
    0x008B: { p1: '效果编号', p2: '0', p3: '0' },
    0x008C: { p1: '0', p2: '0', p3: '0' },
    0x008D: { p1: 'Int16', p2: '0', p3: '0' },
    0x008E: { p1: '0', p2: '0', p3: '0' },
    0x008F: { p1: '0', p2: '0', p3: '0' },
    0x0090: { p1: '0', p2: '0', p3: '0' },
    0x0091: { p1: '0', p2: '0', p3: '0' },
    0x0092: { p1: '0', p2: '0', p3: '0' },
    0x0093: { p1: '速度', p2: '0', p3: '0' },
    0x0094: { p1: '对象ID', p2: '状态ID', p3: '跳转脚本' },
    0x0095: { p1: '场景ID', p2: '跳转脚本', p3: '0' },
    0x0096: { p1: '0', p2: '0', p3: '0' },
    0x0097: { p1: '方向', p2: '0', p3: '0' },
    0x0098: { p1: 'SpriteID', p2: 'SpriteID', p3: '0' },
    0x0099: { p1: '场景ID', p2: '地图ID', p3: '0' },
    0x009A: { p1: '0', p2: '0', p3: '0' },
    0x009B: { p1: '0', p2: '0', p3: '0' },
    0x009C: { p1: '0', p2: '0', p3: '0' },
    0x009D: { p1: 'Int16', p2: '跳转脚本', p3: '0' },
    0x009E: { p1: '0', p2: '0', p3: '0' },
    0x009F: { p1: '0', p2: '0', p3: '0' },
    0x00A0: { p1: '0', p2: '0', p3: '0' },
    0x00A1: { p1: '0', p2: '0', p3: '0' },
    0x00A2: { p1: '0', p2: '0', p3: '0' },
    0x00A3: { p1: 'CDID', p2: 'Int16', p3: 'Boolean' },
    0x00A4: { p1: '0', p2: '0', p3: '0' },
    0x00A5: { p1: '0', p2: '0', p3: '0' },
    0x00A6: { p1: '0', p2: '0', p3: '0' },
    0x00FF: { p1: '消息编号', p2: '0', p3: '0' },
    0x00FE: { p1: '消息编号', p2: '0', p3: '0' },
    0xFFFF: { p1: '消息编号', p2: '0', p3: '0' }
  };

  function getScriptName(cmd) {
    return SCRIPT_NAMES[cmd] || ('未知指令(0x' + cmd.toString(16).toUpperCase().padStart(4, '0') + ')');
  }

  function getScriptNames() {
    return SCRIPT_NAMES;
  }

  function getParamDesc(cmd) {
    return SCRIPT_PARAMS[cmd] || { p1: '0', p2: '0', p3: '0' };
  }

  function getParamType(cmd, paramIndex) {
    var desc = SCRIPT_PARAMS[cmd];
    if (!desc) return 'none';
    var paramKey = 'p' + (paramIndex + 1);
    var val = desc[paramKey];
    if (val === '0') return 'none';
    // 根据参数描述动态判断类型，避免硬编码遗漏
    if (val.indexOf('消息编号') !== -1) return 'msg';
    if (val.indexOf('头像编号') !== -1) return 'face';
    if (paramIndex === 0) {
      if (cmd === 0x13 || cmd === 0x24 || cmd === 0x25 || cmd === 0x40 || cmd === 0x49 || cmd === 0x84 || cmd === 0x94) return 'event';
      if (cmd === 0x1F || cmd === 0x20 || cmd === 0x42 || cmd === 0x58 || cmd === 0x86) return 'item';
      if (cmd === 0x18 || cmd === 0x1B || cmd === 0x1C || cmd === 0x1D || cmd === 0x21 || cmd === 0x22 || cmd === 0x23 || cmd === 0x55 || cmd === 0x56 || cmd === 0x79) return 'char';
      if (cmd === 0x59 || cmd === 0x6D || cmd === 0x99 || cmd === 0x95) return 'scene';
      if (cmd === 0x43 || cmd === 0x45) return 'music';
      if (cmd === 0x47 || cmd === 0x8B) return 'sfx';
      if (cmd === 0x14 || cmd === 0x16 || cmd === 0x65 || cmd === 0x76) return 'image';
      if (cmd === 0x15 || cmd === 0x46 || cmd === 0x97) return 'direction';
    }
    if (paramIndex === 1) {
      if ((cmd === 0x24 || cmd === 0x25 || cmd === 0x40 || cmd === 0x84)) return 'script';
      if (cmd === 0x61 || cmd === 0x83 || cmd === 0x94 || cmd === 0x95 || cmd === 0x58 || cmd === 0x86) return 'script';
    }
    if (paramIndex === 2) {
      if (cmd === 0x18) return 'item';
      if (cmd === 0x19 || cmd === 0x1A) return 'char';
      if (cmd === 0x84 || cmd === 0x94) return 'script';
    }
    return 'number';
  }

  return {
    load,
    isLoaded,
    isModified,
    getModifiedData,
    reset,
    getBufferSize,
    setInstruction,
    getInstruction,
    appendInstruction,
    insertInstruction,
    deleteInstruction,
    createNewScript,
    scanAllInstructions,
    fixEventReferences,
    parseScript,
    extractMovePath,
    getScriptName,
    getScriptNames,
    getParamDesc,
    getParamType
  };
})();