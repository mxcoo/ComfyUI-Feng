"""把外部风格包（krea2_*_styles.json 那种格式）导入成本插件的数据集。

用法：
    & 'H:\\~~~aki-v3.2\\python\\python.exe' tools/import_presets.py
    & '...\\python.exe' tools/import_presets.py --source <风格包目录> --max-size 256

它会：
  1. 读取 <source>/krea2_*_styles.json（每个文件一个分类）
  2. 把缩略图等比缩到 --max-size 以内，存进 presets/thumbs/<id>.jpg
  3. 重写 presets/presets.json 里的 styles 段，其它段（证件照/主体等）原样保留

只写本插件目录，不修改源风格包。
"""

import argparse
import json
import os
import re
import sys

from PIL import Image

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PRESETS = os.path.join(PLUGIN_DIR, "presets", "presets.json")
THUMB_DIR = os.path.join(PLUGIN_DIR, "presets", "thumbs")
DEFAULT_SOURCE = r"H:\~~~aki-v3.2\ComfyUI\custom_nodes\ComfyUI_Lazybuxuexi\styles"

THUMB_EXTS = (".jpg", ".jpeg", ".png", ".webp")


def slugify(text: str) -> str:
    text = (text or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-") or "style"


def make_thumb(src: str, dst: str, max_size: int, quality: int) -> None:
    with Image.open(src) as img:
        img = img.convert("RGB")
        img.thumbnail((max_size, max_size), Image.LANCZOS)
        img.save(dst, "JPEG", quality=quality, optimize=True)


def collect_styles(source: str, max_size: int, quality: int, limit: int) -> list[dict]:
    files = sorted(f for f in os.listdir(source) if f.startswith("krea2_") and f.endswith("_styles.json"))
    if not files:
        raise SystemExit(f"在 {source} 下没有找到 krea2_*_styles.json")

    os.makedirs(THUMB_DIR, exist_ok=True)
    styles: list[dict] = []
    used_ids: set[str] = set()
    skipped = 0

    for filename in files:
        category = filename[len("krea2_"):-len("_styles.json")]
        with open(os.path.join(source, filename), encoding="utf-8") as handle:
            entries = json.load(handle)
        for entry in entries:
            if limit and len(styles) >= limit:
                break
            name = (entry.get("name") or "").strip()
            name_cn = (entry.get("name_cn") or "").strip()
            prompt = (entry.get("prompt") or "").strip()
            if not prompt:
                skipped += 1
                continue

            base_id = f"{slugify(category)}-{slugify(name)}"[:64].strip("-")
            style_id = base_id
            suffix = 2
            while style_id in used_ids:
                style_id = f"{base_id}-{suffix}"
                suffix += 1
            used_ids.add(style_id)

            thumb_name = f"{style_id}.jpg"
            src_thumb = os.path.join(source, entry.get("thumbnail") or "")
            if not (entry.get("thumbnail") and os.path.isfile(src_thumb)):
                skipped += 1
                continue
            make_thumb(src_thumb, os.path.join(THUMB_DIR, thumb_name), max_size, quality)

            styles.append({
                "id": style_id,
                "label": name_cn or name,
                "name": name,
                "category": category,
                "prompt": prompt,
                "negative_prompt": (entry.get("negative_prompt") or "").strip(),
                "thumb": thumb_name,
            })

    print(f"导入 {len(styles)} 条风格，跳过 {skipped} 条，缩略图输出到 {THUMB_DIR}")
    return styles


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="导入风格包到 presets/presets.json")
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="风格包目录（含 krea2_*_styles.json 和 samples/）")
    parser.add_argument("--presets", default=DEFAULT_PRESETS, help="要写入的 presets.json")
    parser.add_argument("--max-size", type=int, default=256, help="缩略图最长边像素")
    parser.add_argument("--quality", type=int, default=80, help="JPEG 质量")
    parser.add_argument("--limit", type=int, default=0, help="最多导入多少条，0 表示全部")
    args = parser.parse_args()

    if not os.path.isdir(args.source):
        raise SystemExit(f"源目录不存在: {args.source}")

    with open(args.presets, encoding="utf-8") as handle:
        data = json.load(handle)
    data["krea_styles"] = collect_styles(args.source, args.max_size, args.quality, args.limit)

    with open(args.presets, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    print(f"已写入 {args.presets}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
