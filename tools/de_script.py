import struct
import sys
import os
import json
import argparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from de_sss import demkf, try_decompress
except ImportError:
    def demkf(data):
        if len(data) < 4:
            return []
        header_size = struct.unpack("<I", data[0:4])[0]
        if header_size < 8 or header_size > len(data) or header_size % 4 != 0:
            return []
        count = header_size // 4
        offsets = []
        for i in range(count):
            off = struct.unpack("<I", data[i*4:(i+1)*4])[0]
            offsets.append(off)
        files = []
        for i in range(len(offsets) - 1):
            start = offsets[i]
            end = min(offsets[i+1], len(data))
            files.append(data[start:end] if start < len(data) else b"")
        last = offsets[-1]
        if last < len(data):
            files.append(data[last:])
        return files

    def try_decompress(data, script_dir):
        return data, None

from de_script_opcodes import OPCODE_INFO


def parse_script(data):
    """解析脚本字节码为结构化指令列表。

    PAL1 脚本格式（基于单字节 opcode + 单字节参数）：
    - 每条指令 = 1 字节 opcode + N 字节参数
    - 参数数量由 OPCODE_INFO[opcode].args 决定
    """
    instructions = []
    i = 0
    total = len(data)

    while i < total:
        opcode = data[i]
        info = OPCODE_INFO.get(opcode, {"name": f"UNKNOWN_0x{opcode:02X}", "args": 0, "desc": "未知指令"})

        arg_count = info.get("args", 0)
        size = 1 + arg_count

        if i + size > total:
            break

        args = [data[i + 1 + j] for j in range(arg_count)]
        args_raw = [f"0x{a:02X}" for a in args]

        instruction = {
            "offset": i,
            "opcode": opcode,
            "opcodeHex": f"0x{opcode:02X}",
            "name": info["name"],
            "desc": info.get("desc", ""),
            "args": args,
            "argsHex": args_raw,
            "size": size
        }
        instructions.append(instruction)
        i += size

    return instructions


def main():
    parser = argparse.ArgumentParser(description="解包 Data.MKF 并解析脚本为 JSON")
    parser.add_argument("data_file", help="Data.MKF 文件路径")
    parser.add_argument("-o", "--output", default="", help="输出 JSON 文件路径（默认: 与输入同名 .json）")
    parser.add_argument("--no-decompress", action="store_true", help="跳过 YJ1/YJ2 解压")
    args = parser.parse_args()

    data_path = args.data_file
    if not os.path.exists(data_path):
        print(f"错误: 文件不存在: {data_path}")
        sys.exit(1)

    output_path = args.output
    if not output_path:
        output_path = os.path.splitext(data_path)[0] + ".json"

    # 读取 Data.MKF
    with open(data_path, "rb") as f:
        raw_data = f.read()

    print(f"读取 Data.MKF: {len(raw_data)} 字节")

    # 解包 MKF
    subfiles = demkf(raw_data)
    print(f"解包 MKF: {len(subfiles)} 个子文件")

    if len(subfiles) < 10:
        print("错误: 子文件数量不足（需要至少10个）")
        sys.exit(1)

    # 获取脚本目录
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # 子文件 0 = 脚本长度表 (189 个 uint16)
    length_table_data = subfiles[0]
    if len(length_table_data) < 378:
        print("错误: 子文件 0 长度不足")
        sys.exit(1)
    lengths = [struct.unpack("<H", length_table_data[i:i+2])[0] for i in range(0, 378, 2)]
    print(f"脚本长度表: {len(lengths)} 个脚本，总长度 {sum(lengths)} 字节")

    # 子文件 9 = 脚本数据
    script_data_raw = subfiles[9]
    if not args.no_decompress:
        script_data_raw, algo = try_decompress(script_data_raw, script_dir)
        if algo:
            print(f"子文件 9 解压: {algo} -> {len(script_data_raw)} 字节")
        else:
            print("子文件 9: 未解压（可能是原始数据或缺少 pallib）")

    # 取实际脚本数据（前 sum(lengths) 字节）
    script_data = script_data_raw[:sum(lengths)]
    print(f"脚本数据: {len(script_data)} 字节")

    # 解析整个脚本数组
    all_instructions = parse_script(script_data)
    print(f"解析指令: {len(all_instructions)} 条")

    # 按长度表切分为 189 个脚本
    scripts = []
    offset = 0
    for script_id, length in enumerate(lengths):
        if offset >= len(script_data):
            break
        script_slice = script_data[offset:offset + length]
        script_instructions = [inst for inst in all_instructions if offset <= inst["offset"] < offset + length]
        scripts.append({
            "id": script_id,
            "offset": offset,
            "length": length,
            "instructionCount": len(script_instructions),
            "instructions": script_instructions
        })
        offset += length

    print(f"切分脚本: {len(scripts)} 个")

    # 按 opcode 统计
    opcode_stats = {}
    for inst in all_instructions:
        name = inst["name"]
        opcode_stats[name] = opcode_stats.get(name, 0) + 1

    # 输出 JSON
    output = {
        "version": 2,
        "source": os.path.basename(data_path),
        "subfileCount": len(subfiles),
        "scriptDataSize": len(script_data),
        "scriptCount": len(scripts),
        "totalInstructions": len(all_instructions),
        "opcodeStats": opcode_stats,
        "scripts": scripts
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"已输出: {output_path}")

    # 打印前 5 个脚本的前 5 条指令
    print("\n前 5 个脚本预览:")
    for script in scripts[:5]:
        print(f"  脚本 {script['id']} (offset={script['offset']:04X}, length={script['length']}):")
        for inst in script["instructions"][:5]:
            args_str = ", ".join(inst["argsHex"]) if inst["argsHex"] else ""
            print(f"    [{inst['offset']:04X}] {inst['opcodeHex']} {inst['name']:<20} {args_str}")

    # 打印统计
    print(f"\n指令统计 (top 10):")
    sorted_stats = sorted(opcode_stats.items(), key=lambda x: x[1], reverse=True)[:10]
    for name, count in sorted_stats:
        print(f"  {name}: {count}")


if __name__ == "__main__":
    main()
