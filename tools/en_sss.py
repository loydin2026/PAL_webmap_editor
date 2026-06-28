#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SSS.MKF 打包工具
用法: python en_sss.py input.json [-o output.mkf]

将 de_sss.py 导出的 JSON 重新打包为 SSS.MKF 二进制文件。
JSON 格式需包含 scenes 数组，每个 scene 包含 mapID、scriptEnter、
scriptLeave、firstEventID 以及 events 数组。
"""

import struct
import sys
import os
import json
import argparse


def enmkf(subfiles):
    """将子文件列表打包为 MKF 格式。

    PAL MKF 格式：
    - 偏移量表包含 n+1 个 DWORD（n = 子文件数）
    - 第一个 DWORD = 偏移量表总大小（字节），同时也是子文件 0 的起始偏移
    - 后续每个 DWORD = 对应子文件起始位置的字节偏移
    - 最后一个 DWORD = 文件末尾的字节偏移
    """
    n = len(subfiles)
    header_size = (n + 1) * 4
    offsets = [header_size]
    current = header_size
    for sf in subfiles:
        current += len(sf)
        offsets.append(current)

    data = struct.pack("<" + "I" * len(offsets), *offsets)
    for sf in subfiles:
        data += sf
    return data


def pack_event_objects(events):
    """将事件数组打包为二进制（32 字节/事件）"""
    data = b""
    for ev in events:
        data += struct.pack("<HHHHHHHHHHHHHHHH",
            ev.get("vanishTime", 0),
            ev.get("pixelX", 0),
            ev.get("pixelY", 0),
            ev.get("layer", 0),
            ev.get("triggerScript", 0),
            ev.get("autoScript", 0),
            ev.get("objStatus", 0),
            ev.get("triggerMethod", 0),
            ev.get("image", 0),
            ev.get("frames", 0),
            ev.get("direction", 0),
            ev.get("currFrame", 0),
            ev.get("scrJmpCount", 0),
            ev.get("imagePtrOffset", 0),
            ev.get("framesAuto", 0),
            ev.get("scrJmpCountAuto", 0)
        )
    return data


def pack_scene_entries(scenes):
    """将场景数组打包为二进制（8 字节/场景）"""
    data = b""
    for sc in scenes:
        data += struct.pack("<HHHH",
            sc.get("mapID", 0),
            sc.get("scriptEnter", 0),
            sc.get("scriptLeave", 0),
            sc.get("firstEventID", 0)
        )
    return data


def rebuild_sss_from_json(data):
    """从 JSON 数据重建 SSS 二进制子文件

    返回 [events_data, scenes_data] 列表，与 de_sss.py 的 demkf 解析顺序一致。
    """
    scenes = data.get("scenes", [])
    if not scenes:
        raise ValueError("JSON 中没有 scenes 数据")

    # 按 sceneID 排序并重新计算 firstEventID
    scenes = sorted(scenes, key=lambda s: s.get("sceneID", 0))

    all_events = []
    rebuilt_scenes = []

    for sc in scenes:
        events = sc.get("events", [])
        first_id = len(all_events)

        rebuilt_scenes.append({
            "sceneID": sc.get("sceneID", 0),
            "mapID": sc.get("mapID", 0),
            "scriptEnter": sc.get("scriptEnter", 0),
            "scriptLeave": sc.get("scriptLeave", 0),
            "firstEventID": first_id
        })

        for ev in events:
            all_events.append(ev)

    # 子文件 0 = events, 子文件 1 = scenes
    events_data = pack_event_objects(all_events)
    scenes_data = pack_scene_entries(rebuilt_scenes)

    return [events_data, scenes_data]


def main():
    parser = argparse.ArgumentParser(description="将 JSON 打包为 SSS.MKF")
    parser.add_argument("json_file", help="输入 JSON 文件路径（de_sss.py 输出格式）")
    parser.add_argument("-o", "--output", default="", help="输出 MKF 文件路径（默认: 与输入同名 .mkf）")
    args = parser.parse_args()

    if not os.path.exists(args.json_file):
        print(f"错误: 文件不存在: {args.json_file}")
        sys.exit(1)

    output_path = args.output
    if not output_path:
        output_path = os.path.splitext(args.json_file)[0] + ".mkf"

    with open(args.json_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    subfiles = rebuild_sss_from_json(data)
    mkf_data = enmkf(subfiles)

    with open(output_path, "wb") as f:
        f.write(mkf_data)

    total_events = sum(len(s.get("events", [])) for s in data.get("scenes", []))
    print(f"已输出: {output_path}")
    print(f"  文件大小: {len(mkf_data)} 字节")
    print(f"  场景数: {len(data.get('scenes', []))}")
    print(f"  事件数: {total_events}")
    print(f"  子文件: {len(subfiles)} 个")


if __name__ == "__main__":
    main()
