"""AusBoss 汉化层：在节点模块加载完之后，就地给它们套上中文。

为什么不直接改上游 .py 里的字符串：上游 2.23.0 的 54 个节点、几千条文案分散在 44 个模块里，
改动面越大越难同步上游、越难复查是否漏译。所以中文全部放在 zh/nodes.json 里，
这里只做一件事：把**纯展示**的字段换成中文。

只动这三类，全部不参与执行、不进 prompt JSON：
1. 显示名、分类、描述、输出名（RETURN_NAMES）；
2. 输入提示（tooltip）与控件标签（label）；
3. SEARCH_ALIASES 里补上中文名，方便搜索。

**下拉框的取值一律保持英文**。原因：ComfyUI 把选项的显示文本直接当值用——它既会写进
prompt JSON 和历史工作流，也会被上游代码与前端脚本拿去做 `===` 比较（例如 `"one per run"`、
`"input folder"`、`"start over"` 在 web/ausboss 下有近百处），还会出现在 `/ausboss/*` 路由的
查询参数里。把值翻成中文，等于同时改掉接口契约与前端分支判断，老工作流也会失效。
中文标签由前端 web/ausboss/zh_labels/ 挂在 socket 与控件上显示，取值不动。
"""

from __future__ import annotations

import copy
import traceback
from pathlib import Path
import json

_DATA_DIR = Path(__file__).resolve().parent
_data: dict | None = None


def _load() -> dict:
    global _data
    if _data is None:
        try:
            raw = json.loads((_DATA_DIR / "nodes.json").read_text(encoding="utf-8"))
        except FileNotFoundError:
            raw = {}
        except Exception:
            traceback.print_exc()
            raw = {}
        raw.setdefault("nodes", {})
        raw.setdefault("categories", {})
        raw.setdefault("strings", {})
        _data = raw
    return _data


def _tr(text: str) -> str:
    """整句翻译：先查全局文案表，查不到原样返回。"""
    table = _load().get("strings") or {}
    return table.get(text, text)


def _localize_block(block: dict, tooltips: dict) -> dict:
    out = {}
    for name, value in block.items():
        if isinstance(value, (list, tuple)) and len(value) == 2 and isinstance(value[1], dict):
            kind, opts = value[0], dict(value[1])
            for key in ("tooltip", "label"):
                if isinstance(opts.get(key), str):
                    opts[key] = _tr(opts[key])
            tip = tooltips.get(name)
            if tip:
                opts["tooltip"] = tip
            value = (kind, opts)
        out[name] = value
    return out


def _localize_spec(spec: dict, tooltips: dict) -> dict:
    if not isinstance(spec, dict):
        return spec
    out = {}
    for section, block in spec.items():
        if section in ("required", "optional", "hidden") and isinstance(block, dict):
            out[section] = _localize_block(block, tooltips)
        else:
            out[section] = block
    return out


def _patch_class(cls, entry: dict, categories: dict) -> None:
    tooltips = dict(entry.get("tooltips") or {})

    if entry.get("category"):
        cls.CATEGORY = entry["category"]
    else:
        category = getattr(cls, "CATEGORY", None)
        if isinstance(category, str) and category in categories:
            cls.CATEGORY = categories[category]

    if entry.get("description"):
        cls.DESCRIPTION = entry["description"]

    outputs = entry.get("outputs")
    if isinstance(outputs, list) and outputs and hasattr(cls, "RETURN_NAMES"):
        cls.RETURN_NAMES = tuple(outputs)

    labels = [entry.get("name") or ""]
    if isinstance(outputs, list):
        labels.extend(str(o) for o in outputs)
    aliases = list(getattr(cls, "SEARCH_ALIASES", []) or [])
    for label in labels:
        if label and label not in aliases:
            aliases.append(label)
    if aliases:
        cls.SEARCH_ALIASES = aliases

    original_input_types = cls.__dict__.get("INPUT_TYPES")
    if original_input_types is not None and tooltips:
        raw = (
            original_input_types.__func__
            if isinstance(original_input_types, (classmethod, staticmethod))
            else original_input_types
        )
        is_classmethod = isinstance(original_input_types, classmethod)

        def INPUT_TYPES(*args):
            # 上游有些节点的 INPUT_TYPES 会读 cls 上的开关，调用方式要跟原来一致
            spec = raw(*args) if is_classmethod else raw()
            return _localize_spec(copy.deepcopy(spec), tooltips)

        cls.INPUT_TYPES = classmethod(INPUT_TYPES) if is_classmethod else staticmethod(INPUT_TYPES)

    cls._feng_zh = True


def localize_nodes(mappings: dict, display_names: dict) -> int:
    """给每个节点套中文。返回实际处理过的节点数。"""
    data = _load()
    entries = data.get("nodes") or {}
    categories = data.get("categories") or {}
    done = 0
    for node_id, cls in mappings.items():
        entry = entries.get(node_id)
        if not entry:
            continue
        if not getattr(cls, "_feng_zh", False):
            try:
                _patch_class(cls, entry, categories)
            except Exception:
                # 一个节点汉化失败不该让整包起不来
                traceback.print_exc()
        name = entry.get("name")
        if name:
            display_names[node_id] = name
        done += 1
    return done
