"""从本机 GJJ_Nodes 导入 证件照 / 多角度 / 主体 / 环境 / 随机灵感 五个页签的字段定义。

字段集合、选项、选项到提示词片段的映射都来自 GJJ 的数据文件：
    presets/prompt_presets/subject.json
    presets/prompt_presets/environment.json
    presets/prompt_presets/rv_random/*.txt
以及它 Python 里的常量表（用 ast 读取，不执行对方代码）。

只读 GJJ 的目录，不改它；写入本插件自己的 presets/presets.json。

用法：
    & 'H:\\~~~aki-v3.2\\python\\python.exe' tools/import_gjj_tabs.py
"""

import argparse
import ast
import json
import os
import sys

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PRESETS = os.path.join(PLUGIN_DIR, "presets", "presets.json")
DEFAULT_GJJ = r"H:\~~~aki-v3.2\ComfyUI\custom_nodes\ComfyUI_GJJ_Nodes"
DEFAULT_TRANSLATIONS = os.path.join(
    DEFAULT_GJJ, "presets", "prompt_presets", "label_translations.json"
)

OPTION_NONE = "无"
OPTION_RANDOM = "随机"
OPTION_OFF = "关闭"
MAX_RANDOM_LABEL = 60


def read_gjj_constants(gjj_dir: str) -> dict:
    """用 ast 直接读出 GJJ 节点里的常量表，不 import（避免加载整个插件）。"""
    source_path = os.path.join(gjj_dir, "nodes", "gjj_prompt_preset_studio.py")
    with open(source_path, encoding="utf-8") as handle:
        tree = ast.parse(handle.read())

    wanted = {"ID_PHOTO_OPTIONS", "SUBJECT_SPECS", "ENVIRONMENT_SPECS", "RANDOM_SPECS", "DETAIL_MODE_OPTIONS"}
    found: dict[str, object] = {}
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.target.id in wanted and node.value is not None:
                found[node.target.id] = ast.literal_eval(node.value)
        elif isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name) and target.id in wanted:
                found[target.id] = ast.literal_eval(node.value)

    missing = wanted - set(found)
    if missing:
        raise SystemExit(f"在 GJJ 源码里没找到这些常量: {sorted(missing)}")
    return found


def load_json(path: str):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def read_random_lines(path: str) -> list[str]:
    if not os.path.isfile(path):
        return []
    lines = []
    with open(path, encoding="utf-8") as handle:
        for raw in handle:
            text = raw.strip()
            if text:
                lines.append(text)
    return lines


def make_translator(table: dict[str, str]):
    """英文标签 -> 中文；查不到返回空串，由调用方回退到原文。"""

    def translate(text: str) -> str:
        text = (text or "").strip()
        if not text:
            return ""
        return table.get(text) or table.get(text.lower()) or ""

    return translate


def unique_cn_labels(values: list[str], translate) -> tuple[list[str], list[str], dict[str, str]]:
    """把一组英文值转成「中文标签 / 原值 / 英文别名」，标签去重并截断。"""
    labels: list[str] = []
    fulls: list[str] = []
    alias: dict[str, str] = {}
    used: set[str] = set()
    for value in values:
        if value in alias:
            continue
        text = translate(value) or value
        if len(text) > MAX_RANDOM_LABEL:
            text = text[: MAX_RANDOM_LABEL - 1] + "…"
        label = text
        suffix = 2
        while label in used:
            label = f"{text}（{suffix}）"
            suffix += 1
        used.add(label)
        labels.append(label)
        fulls.append(value)
        alias[value] = label
    return labels, fulls, alias


def mapped_field(field_id: str, label: str, mapping: dict[str, str], translate) -> dict:
    """主体 / 环境字段：界面显示中文，内部仍映射到英文提示词片段。"""
    options = [OPTION_NONE, OPTION_RANDOM]
    option_map: dict[str, str] = {}
    option_alias: dict[str, str] = {}
    pool: list[str] = []
    used: set[str] = set()
    for key, text in mapping.items():
        if key in ("None", "Random"):
            continue
        text = (text or "").strip()
        if not text:
            continue
        translated = translate(key) or key
        label_cn = translated
        suffix = 2
        while label_cn in used:
            label_cn = f"{translated}（{suffix}）"
            suffix += 1
        used.add(label_cn)
        options.append(label_cn)
        option_map[label_cn] = text
        option_alias[key] = label_cn
        pool.append(text)
    return {
        "id": field_id,
        "label": label,
        "type": "combo",
        "default": OPTION_NONE,
        "options": options,
        "option_map": option_map,
        "option_alias": option_alias,
        "random_pool": pool,
    }


def random_field(field_id: str, label: str, lines: list[str], translate) -> dict:
    labels, fulls, alias = unique_cn_labels(lines, translate)
    return {
        "id": field_id,
        "label": label,
        "type": "combo",
        "default": OPTION_OFF,
        "options": [OPTION_OFF, OPTION_RANDOM, *labels],
        "option_map": dict(zip(labels, fulls)),
        "option_alias": alias,
        "random_pool": fulls,
    }


def build_tabs(constants: dict, gjj_dir: str, translate) -> dict[str, dict]:
    preset_root = os.path.join(gjj_dir, "presets", "prompt_presets")
    subject_catalog = load_json(os.path.join(preset_root, "subject.json"))
    environment_catalog = load_json(os.path.join(preset_root, "environment.json"))

    idphoto_fields = []
    for name, options in constants["ID_PHOTO_OPTIONS"].items():
        idphoto_fields.append({
            "id": name,
            "label": name,
            "type": "combo",
            "default": options[0] if options else OPTION_NONE,
            "options": list(options),
        })

    angle_fields = [
        {"id": "rotate", "label": "视角旋转", "type": "int", "default": 0, "min": 0, "max": 360, "step": 1},
        {"id": "pitch", "label": "视角俯仰", "type": "int", "default": 0, "min": -90, "max": 90, "step": 1},
        {"id": "zoom", "label": "镜头远近", "type": "float", "default": 5.0, "min": 0.0, "max": 10.0, "step": 0.1},
        {
            "id": "detail",
            "label": "视角描述",
            "type": "combo",
            "default": constants["DETAIL_MODE_OPTIONS"][0],
            "options": list(constants["DETAIL_MODE_OPTIONS"]),
        },
    ]

    subject_fields = [
        mapped_field(field_id, display_name, subject_catalog.get(source_key, {}), translate)
        for field_id, source_key, display_name, _tooltip in constants["SUBJECT_SPECS"]
    ]
    environment_fields = [
        mapped_field(field_id, display_name, environment_catalog.get(source_key, {}), translate)
        for field_id, source_key, display_name, _tooltip in constants["ENVIRONMENT_SPECS"]
    ]

    random_dir = os.path.join(preset_root, "rv_random")
    random_fields = [
        random_field(field_id, display_name, read_random_lines(os.path.join(random_dir, filename)), translate)
        for field_id, filename, display_name in constants["RANDOM_SPECS"]
    ]

    return {
        "idphoto": {"id": "idphoto", "label": "证件照", "kind": "fields", "builder": "idphoto", "fields": idphoto_fields},
        "angle": {"id": "angle", "label": "多角度", "kind": "fields", "builder": "angle", "fields": angle_fields},
        "subject": {"id": "subject", "label": "主体", "kind": "fields", "builder": "mapped", "fields": subject_fields},
        "environment": {"id": "environment", "label": "环境", "kind": "fields", "builder": "mapped", "fields": environment_fields},
        "random": {"id": "random", "label": "随机灵感", "kind": "fields", "builder": "mapped", "fields": random_fields},
    }


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="导入 GJJ 的字段型页签")
    parser.add_argument("--gjj", default=DEFAULT_GJJ)
    parser.add_argument("--presets", default=DEFAULT_PRESETS)
    parser.add_argument("--translations", default=DEFAULT_TRANSLATIONS, help="英文标签->中文的词表")
    args = parser.parse_args()

    if not os.path.isdir(args.gjj):
        raise SystemExit(f"GJJ 目录不存在: {args.gjj}")

    table = {}
    if os.path.isfile(args.translations):
        table = load_json(args.translations)
        print(f"读入 {len(table)} 条中文词表")
    else:
        print(f"警告：找不到词表 {args.translations}，选项将保持英文")
    translate = make_translator(table)

    constants = read_gjj_constants(args.gjj)
    tabs = build_tabs(constants, args.gjj, translate)

    with open(args.presets, encoding="utf-8") as handle:
        data = json.load(handle)

    by_id = {tab["id"]: tab for tab in data["tabs"]}
    for tab_id, new_tab in tabs.items():
        if tab_id in by_id:
            new_tab["searchable"] = by_id[tab_id].get("searchable", False)
            index = data["tabs"].index(by_id[tab_id])
            data["tabs"][index] = new_tab
        else:
            data["tabs"].append(new_tab)

    with open(args.presets, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)

    for tab_id, tab in tabs.items():
        options = sum(len(field.get("options", [])) for field in tab["fields"])
        print(f"{tab['label']:6s} {len(tab['fields']):3d} 个字段，共 {options:5d} 个选项")
    print(f"\n已写入 {args.presets}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
