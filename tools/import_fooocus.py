"""把 Fooocus 风格包导入成本插件的第二套风格数据。

数据来源是本机已装的 GJJ_Nodes（或 ComfyUI-Easy-Use）里的 fooocus_styles.json。
缩略图保留原始的远程 URL（与 GJJ 完全一致），因此浏览器需要能访问
raw.githubusercontent.com；断网时卡片会自动退化成纯文字，不影响选择。

用法：
    & 'H:\\~~~aki-v3.2\\python\\python.exe' tools/import_fooocus.py
    & '...\\python.exe' tools/import_fooocus.py --source <fooocus_styles.json>
"""

import argparse
import json
import os
import re
import sys

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PRESETS = os.path.join(PLUGIN_DIR, "presets", "presets.json")
DEFAULT_SOURCE = r"H:\~~~aki-v3.2\ComfyUI\custom_nodes\ComfyUI_GJJ_Nodes\presets\prompt_presets\fooocus_styles.json"


def slugify(text: str) -> str:
    text = (text or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "style"


def build_styles(entries: list[dict]) -> list[dict]:
    styles: list[dict] = []
    used: set[str] = set()
    for entry in entries:
        name = (entry.get("name") or "").strip()
        prompt = (entry.get("prompt") or "").strip()
        negative = (entry.get("negative_prompt") or "").strip()
        thumbnail = (entry.get("thumbnail") or "").strip()
        if not (prompt or negative):
            continue

        base_id = slugify(name)
        style_id = base_id
        suffix = 2
        while style_id in used:
            style_id = f"{base_id}-{suffix}"
            suffix += 1
        used.add(style_id)

        styles.append({
            "id": style_id,
            "label": (entry.get("name_cn") or name or style_id).strip(),
            "name": name,
            "prompt": prompt,
            "negative_prompt": negative,
            "thumbnail": thumbnail,
        })
    return styles


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="导入 Fooocus 风格包")
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--presets", default=DEFAULT_PRESETS)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    with open(args.source, encoding="utf-8") as handle:
        entries = json.load(handle)
    if args.limit:
        entries = entries[: args.limit]

    styles = build_styles(entries)
    with open(args.presets, encoding="utf-8") as handle:
        data = json.load(handle)
    data["fooocus_styles"] = styles
    with open(args.presets, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)

    remote = sum(1 for item in styles if item["thumbnail"].startswith("http"))
    print(f"导入 {len(styles)} 条风格（其中 {remote} 条使用远程缩略图）")
    print(f"已写入 {args.presets}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
