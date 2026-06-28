#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SSS.MKF 解包并解析为 JSON 工具
用法: python de_sss.py SSS.MKF [-o output.json]

流程:
1. 解包 MKF 得到子文件
2. 尝试用 pallib 解压 YJ1（如果安装了）
3. 解析 SceneEntry (子文件 0) 和 event_object (子文件 1)
4. 输出 JSON 供地图编辑器导入

前置条件:
- 已安装 PalLibrary (pallib) 并可用 deyj1.py / deyj2.py
- 或者 SSS 子文件已经是未压缩的原始数据
"""

import struct
import sys
import os
import json
import argparse
import subprocess

def demkf(data):
    """纯 Python MKF 解包。返回子文件 bytes 列表。
    
    PAL MKF 格式：
    - 偏移量表第一个 DWORD = 偏移量表总大小（字节）
    - 后面跟着各子文件的字节偏移量
    - 偏移量表在第一个偏移量处结束，后面紧接子文件数据
    """
    if len(data) < 4:
        return []
    
    # 读取第一个 DWORD = 偏移量表大小
    header_size = struct.unpack("<I", data[0:4])[0]
    if header_size < 8 or header_size > len(data) or header_size % 4 != 0:
        return []
    
    # 读取偏移量表
    count = header_size // 4
    offsets = []
    for i in range(count):
        off = struct.unpack("<I", data[i * 4:(i + 1) * 4])[0]
        offsets.append(off)
    
    # 提取子文件
    files = []
    for i in range(len(offsets) - 1):
        start = offsets[i]
        end = offsets[i + 1]
        if start > len(data):
            files.append(b"")
            continue
        end = min(end, len(data))
        files.append(data[start:end])
    
    # 最后一段
    last_start = offsets[-1]
    if last_start < len(data):
        files.append(data[last_start:])
    
    return files


def try_decompress(data, script_dir):
    """尝试用 deyj1.py / deyj2.py 解压数据。返回解压后的 bytes 或原数据。"""
    # 搜索 deyj1.py 的路径
    search_dirs = [script_dir]
    
    # 尝试从项目根目录找到 PackageUtils
    project_root = os.path.abspath(os.path.join(script_dir, "..", "..", "..", ".."))
    package_utils = os.path.join(project_root, "PackageUtils")
    if os.path.exists(package_utils):
        search_dirs.append(package_utils)
    
    # 也尝试从当前工作目录往上找
    cwd = os.getcwd()
    for _ in range(5):
        pu = os.path.join(cwd, "PackageUtils")
        if os.path.exists(pu) and pu not in search_dirs:
            search_dirs.append(pu)
        cwd = os.path.dirname(cwd)
    
    yj1_script = None
    yj2_script = None
    for d in search_dirs:
        s1 = os.path.join(d, "deyj1.py")
        if os.path.exists(s1):
            yj1_script = s1
        s2 = os.path.join(d, "deyj2.py")
        if os.path.exists(s2):
            yj2_script = s2
    
    # 先尝试 YJ1
    if yj1_script and os.path.exists(yj1_script):
        try:
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix=".yj1") as f:
                f.write(data)
                tmp_path = f.name
            
            out_path = tmp_path + ".bin"
            result = subprocess.run(
                [sys.executable, yj1_script, tmp_path, "-o", out_path],
                capture_output=True, timeout=10
            )
            
            if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                with open(out_path, "rb") as f:
                    decompressed = f.read()
                os.unlink(out_path)
                os.unlink(tmp_path)
                return decompressed, "YJ1"
            
            os.unlink(tmp_path)
        except Exception:
            pass
    
    # 再尝试 YJ2
    if yj2_script and os.path.exists(yj2_script):
        try:
            import tempfile
            with tempfile.NamedTemporaryFile(delete=False, suffix=".yj2") as f:
                f.write(data)
                tmp_path = f.name
            
            out_path = tmp_path + ".bin"
            result = subprocess.run(
                [sys.executable, yj2_script, tmp_path, "-o", out_path],
                capture_output=True, timeout=10
            )
            
            if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                with open(out_path, "rb") as f:
                    decompressed = f.read()
                os.unlink(out_path)
                os.unlink(tmp_path)
                return decompressed, "YJ2"
            
            os.unlink(tmp_path)
        except Exception:
            pass
    
    return data, None


def parse_scene_entries(data):
    """解析 SceneEntry 数组（子文件 0）。每个条目 8 字节。"""
    entries = []
    if len(data) < 8:
        return entries
    
    count = len(data) // 8
    for i in range(count):
        off = i * 8
        map_id, script_enter, script_leave, first_event_id = struct.unpack("<HHHH", data[off:off+8])
        entries.append({
            "sceneID": i,
            "mapID": map_id,
            "scriptEnter": script_enter,
            "scriptLeave": script_leave,
            "firstEventID": first_event_id
        })
    
    return entries


def parse_event_objects(data):
    """解析 event_object 数组（子文件 0）。每个对象 32 字节。
    
    注意：event_object 的 x/y 是 PAL 像素坐标，不是 Tile 坐标。
    精确的坐标转换应在导入时通过 MapModule.pixelToTile() 完成。
    """
    objects = []
    if len(data) < 32:
        return objects
    
    count = len(data) // 32
    for i in range(count):
        off = i * 32
        (
            vanish_time, pos_x, pos_y, layer,
            trigger_script, auto_script, obj_status, trigger_method,
            image, frames, direction, curr_frame,
            scr_jmp_count, image_ptr_offset, frames_auto, scr_jmp_count_auto
        ) = struct.unpack("<" + "H" * 16, data[off:off+32])
        
        objects.append({
            "id": i,
            "vanishTime": vanish_time,
            "pixelX": pos_x,
            "pixelY": pos_y,
            "layer": layer,
            "triggerScript": trigger_script,
            "autoScript": auto_script,
            "objStatus": obj_status,
            "triggerMethod": trigger_method,
            "image": image,
            "frames": frames,
            "direction": direction,
            "currFrame": curr_frame,
            "scrJmpCount": scr_jmp_count,
            "imagePtrOffset": image_ptr_offset,
            "framesAuto": frames_auto,
            "scrJmpCountAuto": scr_jmp_count_auto
        })
    
    return objects


def pal_pixel_to_tile(px, py):
    """将 PAL 像素坐标转换为 PAL 内部 Tile 坐标（基于 EventIndex.pas 逻辑）。
    
    注意：此转换输出的是 PAL 内部步坐标，不是编辑器使用的 Tile 坐标。
    编辑器中的精确转换应使用 MapModule.pixelToTile()。
    """
    tx = (px // 32) * 2
    mod = px % 32
    if 0 <= mod <= 8:
        tx -= 1
    elif 26 <= mod <= 31:
        tx += 1
    
    if tx % 2 == 0:
        ty = py // 16
    else:
        ty = (py - 8) // 16
    
    return tx, ty


def build_scene_events(scenes, events):
    """将 SceneEntry 和 event_object 组合成按场景分组的事件列表。"""
    result = []
    
    for scene in scenes:
        scene_id = scene["sceneID"]
        map_id = scene["mapID"]
        first_id = scene["firstEventID"]
        
        # 找下一个场景的第一个事件ID，确定当前场景的事件范围
        next_first = None
        for s in scenes:
            if s["sceneID"] == scene_id + 1:
                next_first = s["firstEventID"]
                break
        
        scene_events = []
        if first_id < len(events):
            end_id = next_first if next_first is not None else len(events)
            for i in range(first_id, min(end_id, len(events))):
                ev = events[i].copy()
                ev["sceneID"] = scene_id
                ev["mapID"] = map_id
                scene_events.append(ev)
        
        result.append({
            "sceneID": scene_id,
            "mapID": map_id,
            "scriptEnter": scene["scriptEnter"],
            "scriptLeave": scene["scriptLeave"],
            "firstEventID": first_id,
            "events": scene_events
        })
    
    return result


def main():
    parser = argparse.ArgumentParser(description="解包 SSS.MKF 并解析为 JSON")
    parser.add_argument("sss_file", help="SSS.MKF 文件路径")
    parser.add_argument("-o", "--output", default="", help="输出 JSON 文件路径（默认: 与输入同名 .json）")
    parser.add_argument("--no-decompress", action="store_true", help="跳过 YJ1/YJ2 解压（假设数据已解压）")
    args = parser.parse_args()
    
    sss_path = args.sss_file
    if not os.path.exists(sss_path):
        print(f"错误: 文件不存在: {sss_path}")
        sys.exit(1)
    
    output_path = args.output
    if not output_path:
        output_path = os.path.splitext(sss_path)[0] + ".json"
    
    # 读取 SSS.MKF
    with open(sss_path, "rb") as f:
        raw_data = f.read()
    
    print(f"读取 SSS.MKF: {len(raw_data)} 字节")
    
    # 解包 MKF
    subfiles = demkf(raw_data)
    print(f"解包 MKF: {len(subfiles)} 个子文件")
    
    if len(subfiles) < 2:
        print("错误: 子文件数量不足（需要至少2个）")
        sys.exit(1)
    
    # 获取 PackageUtils 目录（用于调用 deyj1.py）
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 解压子文件
    scenes_data = subfiles[0]
    events_data = subfiles[1]
    
    if not args.no_decompress:
        scenes_data, scenes_algo = try_decompress(scenes_data, script_dir)
        if scenes_algo:
            print(f"子文件 0 解压: {scenes_algo} -> {len(scenes_data)} 字节")
        else:
            print("子文件 0: 未解压（可能是原始数据或缺少 pallib）")
        
        events_data, events_algo = try_decompress(events_data, script_dir)
        if events_algo:
            print(f"子文件 1 解压: {events_algo} -> {len(events_data)} 字节")
        else:
            print("子文件 1: 未解压（可能是原始数据或缺少 pallib）")
    
    # 解析
    # SSS.MKF 格式:
    # 子文件 0 = event_object 数组 (32 字节/记录)
    # 子文件 1 = SceneEntry 数组 (8 字节/记录)
    events = parse_event_objects(subfiles[0])
    print(f"解析事件: {len(events)} 个")
    
    scenes = parse_scene_entries(subfiles[1])
    print(f"解析场景: {len(scenes)} 个")
    
    # 组合
    scene_events = build_scene_events(scenes, events)
    
    # 输出 JSON
    output = {
        "version": 1,
        "source": os.path.basename(sss_path),
        "scenes": scene_events
    }
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    print(f"已输出: {output_path}")
    
    # 打印统计
    total_events = sum(len(s["events"]) for s in scene_events)
    print(f"总计: {len(scenes)} 个场景, {total_events} 个事件对象")
    
    # 打印前几个场景
    for i in range(min(5, len(scene_events))):
        s = scene_events[i]
        print(f"  Scene {s['sceneID']}: mapID={s['mapID']}, events={len(s['events'])}")


if __name__ == "__main__":
    main()
