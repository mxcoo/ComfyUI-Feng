"""合并翻译结果，生成 ausboss/zh/nodes.json 与前端用的标签表。

输入
- tools/_ausboss_extracted.json   运行时抽出的英文原文（结构真值）
- tools/_zh_out/batch-*.json      翻译结果（节点名/描述/输出名/提示）
- tools/_ausboss_labels.json      输入名 → 中文标签（全局表，作者维护）
- tools/_ausboss_options.json     下拉选项 → 中文标签（全局表，作者维护）
- tools/_ausboss_categories.json  分类 → 中文

输出
- ausboss/zh/nodes.json           运行时汉化数据
- web/ausboss/zh_labels/labels.mjs 前端 socket / 控件标签表

每次改动翻译数据都重跑本脚本，nodes.json 不要手改。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

TOOLS_DIR = Path(__file__).resolve().parent
PLUGIN_DIR = TOOLS_DIR.parent
EXTRACTED = TOOLS_DIR / "_ausboss_extracted.json"
OUT_JSON = PLUGIN_DIR / "ausboss" / "zh" / "nodes.json"
OUT_JS = PLUGIN_DIR / "web" / "ausboss" / "zh_labels" / "labels.mjs"


# 下拉取值在界面里显示的是中文标签，正文里却写着英文取值，用户会对不上号。
# 只替换「纯中文标签 + 纯小写英文取值」的那批，技术取值（16:9、4n+1、模型文件名）留着。
_TECH_TOKEN = re.compile(r"^[a-z][a-z \-/]{2,}$")
_CJK = "\u4e00-\u9fff"


def _enum_terms(options: dict) -> list[tuple[str, str]]:
    terms = [
        (token, label)
        for token, label in options.items()
        if label
        and label != token
        and not re.search(r"[A-Za-z0-9]", label)
        and _TECH_TOKEN.match(token)
    ]
    return sorted(terms, key=lambda pair: len(pair[0]), reverse=True)


def _inline_terms(text: str, terms: list[tuple[str, str]]) -> str:
    if not text:
        return text
    for token, label in terms:
        text = re.sub(rf"(?<![A-Za-z0-9_.-]){re.escape(token)}(?![A-Za-z0-9_.-])", label, text)
    text = re.sub(rf"(?<=[{_CJK}])\s+(?=[{_CJK}])", "", text)
    text = re.sub(r"\s+(?=[，。：；、！？）])", "", text)
    return text


def _read(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _collect_translations() -> dict:
    merged: dict = {}
    for path in sorted((TOOLS_DIR / "_zh_out").glob("batch-*.json")):
        data = _read(path)
        for node_id, entry in (data.get("NODES") or {}).items():
            if node_id in merged:
                print(f"⚠ {path.name} 重复定义 {node_id}，后者覆盖前者")
            merged[node_id] = entry
    return merged


def main() -> int:
    extracted = _read(EXTRACTED)["nodes"]
    labels_table = _read(TOOLS_DIR / "_ausboss_labels.json")["labels"]
    options_table = _read(TOOLS_DIR / "_ausboss_options.json")["options"]
    categories = _read(TOOLS_DIR / "_ausboss_categories.json")["categories"]
    translations = _collect_translations()

    nodes: dict = {}
    problems: list[str] = []
    untranslated_tokens: set[str] = set()
    missing_labels: set[str] = set()

    for node_id, source in extracted.items():
        zh = translations.get(node_id)
        if not zh:
            problems.append(f"{node_id}: 没有翻译结果")
            continue

        name = (zh.get("name") or "").strip()
        description = (zh.get("description") or "").strip()
        outputs = zh.get("outputs") or []
        tooltips = zh.get("tooltips") or {}

        if not name:
            problems.append(f"{node_id}: name 为空")
        if not description:
            problems.append(f"{node_id}: description 为空")
        if len(outputs) != len(source["return_names"]):
            problems.append(
                f"{node_id}: outputs 有 {len(outputs)} 个，return_names 有 {len(source['return_names'])} 个"
            )

        inputs = source["inputs"]
        for name_key, record in inputs.items():
            if record.get("tooltip") and name_key not in tooltips:
                problems.append(f"{node_id}.{name_key}: 英文有提示但中文缺")
            if record.get("options"):
                for token in record["options"]:
                    if token not in options_table:
                        untranslated_tokens.add(token)
            if name_key not in labels_table:
                missing_labels.add(name_key)

        used_tokens = {
            token
            for record in inputs.values()
            for token in (record.get("options") or [])
        }
        options = {token: options_table[token] for token in sorted(used_tokens) if token in options_table}

        # 同一个节点里两个英文取值翻成同一个中文标签会让「中文→英文」回映射失真
        seen: dict[str, str] = {}
        for token, label in options.items():
            if label in seen and seen[label] != token:
                problems.append(
                    f"{node_id}: 选项 {seen[label]!r} 与 {token!r} 都译成 {label!r}，回映射会有歧义"
                )
            seen[label] = token

        terms = _enum_terms(options)
        description = _inline_terms(description, terms)
        tooltips = {key: _inline_terms(value, terms) for key, value in tooltips.items()}

        node_labels = {
            key: labels_table[key]
            for key in inputs
            if key in labels_table
        }

        nodes[node_id] = {
            "name": name,
            "category": categories.get(source["category"], source["category"]),
            "description": description,
            "outputs": outputs,
            "labels": node_labels,
            "tooltips": {k: v for k, v in tooltips.items() if v},
            "options": options,
        }

    if missing_labels:
        problems.append(f"输入名缺少中文标签：{', '.join(sorted(missing_labels))}")
    if untranslated_tokens:
        problems.append(f"下拉选项缺少中文标签：{', '.join(sorted(untranslated_tokens))}")

    payload = {
        "_note": "由 tools/_ausboss_zh_build.py 生成，改文案请改 tools/_zh_out 与 tools/_ausboss_*.json 后重跑。",
        "pack_version": _read(EXTRACTED)["pack_version"],
        "categories": categories,
        "nodes": nodes,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")

    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    front = {node_id: entry["labels"] for node_id, entry in nodes.items()}
    OUT_JS.write_text(
        "// 由 tools/_ausboss_zh_build.py 生成，不要手改。\n"
        "// 只放「输入名 → 中文标签」：输入名本身是 prompt JSON 里的字段，不能改。\n"
        f"export const INPUT_LABELS = {json.dumps(front, ensure_ascii=False, indent=0)};\n",
        encoding="utf-8",
    )

    print(f"节点 {len(nodes)}/{len(extracted)}，写入 {OUT_JSON.relative_to(PLUGIN_DIR)} 与 {OUT_JS.relative_to(PLUGIN_DIR)}")
    if problems:
        print(f"\n发现 {len(problems)} 个问题：")
        for line in problems:
            print(f"  - {line}")
        return 1
    print("全部字段齐全")
    return 0


if __name__ == "__main__":
    sys.exit(main())
