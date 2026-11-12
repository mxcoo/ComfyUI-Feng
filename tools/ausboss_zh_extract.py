"""把 AusBoss 54 个节点的英文文案抽成一份 JSON，供翻译与漏译核对使用。

用法（在 ComfyUI-Feng 目录下）：

    python tools/ausboss_zh_extract.py            # 写到 tools/_ausboss_extracted.json
    python tools/ausboss_zh_extract.py --print N  # 打印前 N 个节点

抽的是**运行时真实的** INPUT_TYPES()，不是正则猜的：torch / numpy / PIL 这些用桩顶替
（tools/_ausboss_stub.py），节点模块照样能 import，常量与文案都是真值。
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

TOOLS_DIR = Path(__file__).resolve().parent
PLUGIN_DIR = TOOLS_DIR.parent
OUT_PATH = TOOLS_DIR / "_ausboss_extracted.json"

sys.path.insert(0, str(TOOLS_DIR))


def _input_record(value) -> dict:
    record = {"kind": "scalar"}
    if isinstance(value, (list, tuple)):
        if len(value) == 2 and isinstance(value[1], dict):
            kind, opts = value[0], dict(value[1])
            if isinstance(kind, (list, tuple)):
                record["kind"] = "combo"
                record["options"] = [str(o) for o in kind]
            else:
                record["type"] = str(kind)
            record["options_dict_keys"] = sorted(opts)
        elif all(isinstance(v, str) for v in value):
            record["kind"] = "combo"
            record["options"] = [str(o) for o in value]
            opts = {}
        else:
            record["raw"] = repr(value)
            return record
    else:
        record["type"] = str(value)
        return record

    if record["kind"] == "combo":
        if "default" in opts:
            record["default"] = opts["default"]
    else:
        for key in ("default", "min", "max", "step"):
            if key in opts:
                record[key] = opts[key]
    if isinstance(opts.get("tooltip"), str):
        record["tooltip"] = opts["tooltip"]
    return record


def extract() -> dict:
    import _ausboss_stub

    os.environ["FENG_AUSBOSS_NO_ZH"] = "1"
    package = _ausboss_stub.load_package(str(PLUGIN_DIR))

    nodes = {}
    for node_id, cls in package.NODE_CLASS_MAPPINGS.items():
        entry = {
            "class": f"{cls.__module__}.{cls.__name__}",
            "display_name": package.NODE_DISPLAY_NAME_MAPPINGS.get(node_id, node_id),
            "category": getattr(cls, "CATEGORY", ""),
            "description": getattr(cls, "DESCRIPTION", "") or "",
            "return_names": list(getattr(cls, "RETURN_NAMES", ()) or ()),
            "search_aliases": list(getattr(cls, "SEARCH_ALIASES", ()) or ()),
            "inputs": {},
        }
        try:
            spec = cls.INPUT_TYPES()
        except Exception as exc:  # 极少数节点的 INPUT_TYPES 依赖真实模型目录
            entry["inputs_error"] = f"{type(exc).__name__}: {exc}"
            spec = {}
        for section in ("required", "optional", "hidden"):
            block = spec.get(section) or {}
            for name, value in block.items():
                if section == "hidden":
                    entry["inputs"].setdefault(name, {"kind": "hidden", "type": str(value)})
                    continue
                record = _input_record(value)
                record["section"] = section
                entry["inputs"][name] = record
        nodes[node_id] = entry

    return {
        "pack_version": package.PACK_VERSION,
        "failed_modules": package.failed_modules,
        "node_count": len(nodes),
        "nodes": nodes,
    }


def main() -> int:
    data = extract()
    if "--print" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--print") + 1])
        for node_id in list(data["nodes"])[:limit]:
            entry = data["nodes"][node_id]
            print(f"== {node_id}  [{entry['category']}] {entry['display_name']}")
            print(f"   desc: {entry['description'][:120]}...")
            for name, rec in entry["inputs"].items():
                kind = rec.get("kind")
                options = rec.get("options")
                extra = f" options={options}" if options else f" type={rec.get('type')}"
                print(f"   - {name} ({kind}){extra}")
        return 0

    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    total_inputs = sum(len(e["inputs"]) for e in data["nodes"].values())
    total_options = sum(
        len(rec.get("options") or [])
        for e in data["nodes"].values()
        for rec in e["inputs"].values()
    )
    tooltips = sum(
        1
        for e in data["nodes"].values()
        for rec in e["inputs"].values()
        if rec.get("tooltip")
    )
    print(f"节点 {data['node_count']} 个，输入 {total_inputs} 条，下拉选项 {total_options} 个，提示 {tooltips} 条")
    print(f"写入 {OUT_PATH}")
    if data["failed_modules"]:
        print(f"加载失败模块：{data['failed_modules']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
