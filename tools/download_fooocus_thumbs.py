"""把 Fooocus 风格包的远程缩略图下载到本地，之后可以完全离线使用。

默认的 Fooocus 数据里缩略图是远程 URL（和 GJJ_Nodes 一样），断网时卡片会退化成文字。
在能上网的环境跑一次这个脚本，图片就落到 presets/thumbs/ 并改成本地引用。

用法：
    & 'H:\\~~~aki-v3.2\\python\\python.exe' tools/download_fooocus_thumbs.py
    & '...\\python.exe' tools/download_fooocus_thumbs.py --force     # 重新下载全部
    & '...\\python.exe' tools/download_fooocus_thumbs.py --limit 20  # 先试 20 张

只访问 raw.githubusercontent.com 上的这些缩略图，不发送任何其它数据。
"""

import argparse
import io
import json
import os
import sys
import urllib.request

from PIL import Image

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PRESETS = os.path.join(PLUGIN_DIR, "presets", "presets.json")
THUMB_DIR = os.path.join(PLUGIN_DIR, "presets", "thumbs")
DATASET_KEY = "fooocus_styles"
MAX_THUMB_SIDE = 256


def save_thumb(raw: bytes, dst: str) -> None:
    with Image.open(io.BytesIO(raw)) as image:
        image = image.convert("RGB")
        image.thumbnail((MAX_THUMB_SIDE, MAX_THUMB_SIDE), Image.LANCZOS)
        image.save(dst, "JPEG", quality=82, optimize=True)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="下载 Fooocus 风格缩略图到本地")
    parser.add_argument("--presets", default=DEFAULT_PRESETS)
    parser.add_argument("--limit", type=int, default=0, help="最多处理多少条，0 表示全部")
    parser.add_argument("--force", action="store_true", help="已存在的也重新下载")
    parser.add_argument("--timeout", type=int, default=20)
    args = parser.parse_args()

    with open(args.presets, encoding="utf-8") as handle:
        data = json.load(handle)
    styles = data.get(DATASET_KEY, [])
    if not styles:
        raise SystemExit(f"{args.presets} 里没有 {DATASET_KEY}，先跑 tools/import_fooocus.py")

    os.makedirs(THUMB_DIR, exist_ok=True)
    todo = styles[: args.limit] if args.limit else styles
    done = skipped = failed = 0

    for index, item in enumerate(todo, start=1):
        style_id = item.get("id") or f"style-{index}"
        filename = f"{style_id}.jpg"
        target = os.path.join(THUMB_DIR, filename)

        if os.path.isfile(target) and not args.force:
            item["thumb"] = filename
            skipped += 1
            continue

        url = item.get("thumbnail") or item.get("thumb_url")
        if not url or not url.startswith("http"):
            failed += 1
            print(f"[{index}/{len(todo)}] 跳过（没有远程地址）: {style_id}")
            continue

        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Feng-ComfyUI-Plugin"})
            with urllib.request.urlopen(request, timeout=args.timeout) as response:
                raw = response.read()
            save_thumb(raw, target)
            item["thumb"] = filename
            done += 1
            print(f"[{index}/{len(todo)}] OK {filename}")
        except Exception as exc:
            failed += 1
            print(f"[{index}/{len(todo)}] 失败 {style_id}: {exc}")

    with open(args.presets, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)

    print(f"\n下载 {done} 张，已存在跳过 {skipped} 张，失败 {failed} 张")
    print("现在本地风格已可用，前端会优先用本地图，远程地址留作兜底。")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
