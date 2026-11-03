"""给孤海工具箱「外补画板（可视化）」打一个遮罩作用域补丁。

背景（为什么要改第三方源码）：
    goohaitools 的可视化画板把「遮罩」输入按 batch 广播：
        indices = torch.arange(batch).clamp(max=source_mask.shape[0] - 1)
    当「图像」接的是 Feng 批量图片加载器的「图像组」（batch=N），而「遮罩」口只输出
    第一张的遮罩（[1,H,W]）时，这一行会让**整批图**都被第一张的遮罩涂成外补色。
    「用 Alpha 作遮罩」默认还是开的，所以只要第一张是带透明背景的 PNG，批次里
    后面的图就会直接被毁掉。

    补丁只做一件事：遮罩只有 1 张、而图像是多张时，把遮罩补齐成 [N,H,W]（第 1 张保留，
    其余为 0），也就是「第一张图配第一张遮罩，其余图不带遮罩」。

用法（PowerShell）：
    & 'H:\\~~~aki-v3.2\\python\\python.exe' tools\\patch_outpaint_mask.py
    & 'H:\\~~~aki-v3.2\\python\\python.exe' tools\\patch_outpaint_mask.py --revert
    & 'H:\\~~~aki-v3.2\\python\\python.exe' tools\\patch_outpaint_mask.py --check

    默认在 ComfyUI\\custom_nodes 下自动找文件；找不到就传 --comfyui <ComfyUI 根目录>。

注意：这是第三方插件文件，goohaitools 更新后补丁会被覆盖，重跑一遍本脚本即可（幂等）。
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys

TARGET_NAME = "外补画板（可视化）.py"
MARKER = "Feng:mask-first-only"

ORIGINAL = (
    "            indices = torch.arange(batch, device=图像.device)"
    ".clamp(max=source_mask.shape[0] - 1)\n"
    "            source_mask = source_mask[indices]\n"
)

PATCHED = (
    "            # " + MARKER + "\n"
    "            # 单张遮罩只作用于第一张；批次其余图补 0，避免整批被第一张遮罩涂掉。\n"
    "            if source_mask.shape[0] == 1 and batch > 1:\n"
    "                source_mask = torch.cat(\n"
    "                    (source_mask, source_mask.new_zeros((batch - 1, *source_mask.shape[1:]))),\n"
    "                    dim=0)\n"
    "            indices = torch.arange(batch, device=图像.device)"
    ".clamp(max=source_mask.shape[0] - 1)\n"
    "            source_mask = source_mask[indices]\n"
)

DEFAULT_ROOTS = (
    r"H:\~~~aki-v3.2\ComfyUI",
    r"H:\ComfyUI",
    r"D:\ComfyUI",
    r"E:\ComfyUI",
)


def find_target(comfyui: str | None) -> str:
    roots = [comfyui] if comfyui else [root for root in DEFAULT_ROOTS if os.path.isdir(root)]
    for root in roots:
        custom_nodes = os.path.join(root, "custom_nodes")
        if not os.path.isdir(custom_nodes):
            continue
        for folder in sorted(os.listdir(custom_nodes)):
            if not folder.lower().startswith("goohaitools"):
                continue
            candidate = os.path.join(custom_nodes, folder, "nodes", TARGET_NAME)
            if os.path.isfile(candidate):
                return candidate
            candidate = os.path.join(custom_nodes, folder, TARGET_NAME)
            if os.path.isfile(candidate):
                return candidate
    return ""


def patch_file(path: str, revert: bool = False) -> int:
    backup = path + ".bak"
    with open(path, encoding="utf-8") as handle:
        text = handle.read()

    if revert:
        if not os.path.isfile(backup):
            print(f"没有备份可还原：{backup}")
            return 1
        shutil.copy2(backup, path)
        print(f"已还原：{path}")
        return 0

    if MARKER in text:
        print("已经是打过补丁的状态，跳过。")
        return 0
    if ORIGINAL not in text:
        print("没找到预期的源码片段（可能 goohaitools 版本变了），未修改。")
        return 1
    if not os.path.isfile(backup):
        shutil.copy2(path, backup)
        print(f"已备份：{backup}")
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text.replace(ORIGINAL, PATCHED, 1))
    print(f"已打补丁：{path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="为孤海外补画板（可视化）修正遮罩 batch 广播")
    parser.add_argument("--comfyui", help="ComfyUI 根目录（含 custom_nodes）")
    parser.add_argument("--file", help="直接指定外补画板（可视化）.py 路径")
    parser.add_argument("--revert", action="store_true", help="从 .bak 还原")
    parser.add_argument("--check", action="store_true", help="只检查状态，不修改")
    args = parser.parse_args()

    path = args.file or find_target(args.comfyui)
    if not path or not os.path.isfile(path):
        print("没找到 外补画板（可视化）.py，用 --comfyui 或 --file 指定。")
        return 1

    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    if args.check:
        state = "已打补丁" if MARKER in text else ("可打补丁" if ORIGINAL in text else "片段不匹配")
        print(f"{path}\n状态：{state}")
        return 0
    return patch_file(path, args.revert)


if __name__ == "__main__":
    sys.exit(main())
