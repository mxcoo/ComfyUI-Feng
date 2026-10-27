"""提示词预设的数据层。

数据分两层：
  presets/presets.json       出厂预设，只读，由导入脚本生成
  presets/user_presets.json  用户预设，界面里增删改写的都是这里

读取时把两层合并成一份统一视图（每个页签都有 items），写入只碰用户层。
"""

import io as _io
import json
import os
import re
import threading
import uuid

from PIL import Image

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
PRESETS_DIR = os.path.join(PLUGIN_DIR, "presets")
BASE_PATH = os.path.join(PRESETS_DIR, "presets.json")
USER_PATH = os.path.join(PRESETS_DIR, "user_presets.json")
THUMB_DIR = os.path.join(PRESETS_DIR, "thumbs")

THUMB_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpg|jpeg|png|webp)$", re.IGNORECASE)
ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

CARD_KINDS = ("cards", "styles")
MAX_LABEL = 80
MAX_CATEGORY_LABEL = 40
MAX_PROMPT = 4000
MAX_THUMB_SIDE = 256

_lock = threading.RLock()
_cache: dict[str, tuple[float, dict]] = {}


def _read_json(path: str, fallback: dict) -> dict:
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return fallback
    cached = _cache.get(path)
    if cached and cached[0] == mtime:
        return cached[1]
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    _cache[path] = (mtime, data)
    return data


def _base() -> dict:
    return _read_json(BASE_PATH, {"tabs": [], "styles": [], "negative_presets": {}})


def _user() -> dict:
    data = _read_json(USER_PATH, {"categories": [], "items": []})
    data.setdefault("categories", [])
    data.setdefault("items", [])
    return data


def _write_user(data: dict) -> None:
    tmp_path = USER_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    os.replace(tmp_path, USER_PATH)


def _card_item(item: dict, custom: bool) -> dict:
    return {
        "id": item.get("id"),
        "label": item.get("label") or item.get("name") or item.get("id"),
        "name": item.get("name", ""),
        "prompt": item.get("prompt", ""),
        "negative_prompt": item.get("negative_prompt", ""),
        "thumb": item.get("thumb", ""),
        "thumb_url": item.get("thumbnail", "") or item.get("thumb_url", ""),
        "custom": custom,
    }


def _merged() -> dict:
    """出厂预设 + 用户预设的合并视图，按两个文件的 mtime 缓存。"""
    with _lock:
        base = _base()
        user = _user()

        tabs: list[dict] = []
        for tab in base.get("tabs", []):
            kind = tab.get("kind")
            entry = {
                "id": tab.get("id"),
                "label": tab.get("label"),
                "kind": kind,
                "searchable": bool(tab.get("searchable")),
            }
            if kind == "styles":
                dataset = tab.get("dataset", "styles")
                entry["items"] = [_card_item(item, False) for item in base.get(dataset, [])]
            elif kind == "cards":
                entry["items"] = [_card_item(item, False) for item in tab.get("items", [])]
            elif kind == "fields":
                entry["template"] = tab.get("template", "")
                entry["builder"] = tab.get("builder", "template")
                entry["fields"] = tab.get("fields", [])
            tabs.append(entry)

        by_id = {tab["id"]: tab for tab in tabs}
        for category in user.get("categories", []):
            category_id = category.get("id")
            if not category_id or category_id in by_id:
                continue
            tab = {
                "id": category_id,
                "label": category.get("label") or category_id,
                "kind": "cards",
                "searchable": True,
                "items": [],
            }
            tabs.append(tab)
            by_id[category_id] = tab

        for item in user.get("items", []):
            tab = by_id.get(item.get("tab_id"))
            if not tab or tab.get("kind") not in CARD_KINDS:
                continue
            tab.setdefault("items", []).append(_card_item(item, True))

        return {
            "page_size": int(base.get("page_size", 12)),
            "negative_presets": base.get("negative_presets", {}),
            "tabs": tabs,
        }


def get_tabs() -> list[dict]:
    return _merged()["tabs"]


def get_tab(tab_id: str) -> dict | None:
    for tab in get_tabs():
        if tab.get("id") == tab_id:
            return tab
    return None


def get_page_size() -> int:
    return _merged()["page_size"]


def get_negative_presets() -> dict[str, str]:
    return _merged()["negative_presets"]


def get_negative_preset(name: str) -> str:
    return (get_negative_presets().get(name) or "").strip()


def get_cards(tab_id: str) -> list[dict]:
    tab = get_tab(tab_id)
    if not tab or tab.get("kind") not in CARD_KINDS:
        return []
    return tab.get("items", [])


def get_styles() -> list[dict]:
    return get_cards("style")


def get_style_lookup() -> dict[str, dict]:
    return {item["id"]: item for item in get_styles()}


def get_item(tab_id: str, item_id: str) -> dict | None:
    for item in get_cards(tab_id):
        if item.get("id") == item_id:
            return item
    return None


def build_index() -> dict:
    """给前端的索引：不含提示词正文，只留 id / 名称 / 缩略图。"""
    tabs: list[dict] = []
    for tab in get_tabs():
        entry = {
            "id": tab.get("id"),
            "label": tab.get("label"),
            "kind": tab.get("kind"),
            "searchable": bool(tab.get("searchable")),
            "custom": tab.get("id", "").startswith("user-"),
        }
        if tab.get("kind") in CARD_KINDS:
            entry["items"] = [
                {
                    "id": item["id"],
                    "label": item["label"],
                    "name": item.get("name", ""),
                    "thumb": item.get("thumb", ""),
                    "thumbUrl": item.get("thumb_url", ""),
                    "custom": item.get("custom", False),
                }
                for item in tab.get("items", [])
            ]
        elif tab.get("kind") == "fields":
            entry["builder"] = tab.get("builder", "template")
            entry["fields"] = [
                {
                    "id": field.get("id"),
                    "label": field.get("label"),
                    "type": field.get("type", "combo"),
                    "default": field.get("default"),
                    "options": field.get("options", []),
                    "min": field.get("min"),
                    "max": field.get("max"),
                    "step": field.get("step"),
                }
                for field in tab.get("fields", [])
            ]
        tabs.append(entry)

    return {
        "page_size": get_page_size(),
        "negative_presets": list(get_negative_presets().keys()),
        "tabs": tabs,
    }


def resolve_thumb(name: str) -> str | None:
    """只允许 thumbs 目录下的图片文件，路径穿越一律拒绝。"""
    if not name or not THUMB_PATTERN.match(name):
        return None
    if os.path.basename(name) != name:
        return None
    path = os.path.abspath(os.path.join(THUMB_DIR, name))
    thumb_root = os.path.abspath(THUMB_DIR)
    if os.path.commonpath([path, thumb_root]) != thumb_root:
        return None
    return path if os.path.isfile(path) else None


def _clean_text(value, limit: int) -> str:
    text = str(value or "").strip()
    return text[:limit]


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def add_category(label) -> dict:
    label = _clean_text(label, MAX_CATEGORY_LABEL)
    if not label:
        raise ValueError("分类名称不能为空")
    with _lock:
        data = _user()
        category = {"id": _new_id("user"), "label": label}
        data["categories"].append(category)
        _write_user(data)
    return category


def update_category(category_id: str, label) -> dict:
    label = _clean_text(label, MAX_CATEGORY_LABEL)
    if not label:
        raise ValueError("分类名称不能为空")
    with _lock:
        data = _user()
        for category in data["categories"]:
            if category["id"] == category_id:
                category["label"] = label
                _write_user(data)
                return category
    raise ValueError("分类不存在")


def delete_category(category_id: str) -> None:
    with _lock:
        data = _user()
        before = len(data["categories"])
        data["categories"] = [item for item in data["categories"] if item.get("id") != category_id]
        if len(data["categories"]) == before:
            raise ValueError("分类不存在")
        data["items"] = [item for item in data["items"] if item.get("tab_id") != category_id]
        _write_user(data)


def save_item(payload: dict) -> dict:
    """新增或更新一条用户预设。带 id 即更新，不带即新增。"""
    tab_id = _clean_text(payload.get("tab_id"), 64)
    tab = get_tab(tab_id)
    if not tab or tab.get("kind") not in CARD_KINDS:
        raise ValueError("目标分类不支持添加预设")

    label = _clean_text(payload.get("label"), MAX_LABEL)
    prompt = _clean_text(payload.get("prompt"), MAX_PROMPT)
    if not label:
        raise ValueError("预设名称不能为空")
    if not prompt:
        raise ValueError("提示词不能为空")

    item_id = _clean_text(payload.get("id"), 64)
    negative = _clean_text(payload.get("negative_prompt"), MAX_PROMPT)
    thumb = _clean_text(payload.get("thumb"), 128)

    with _lock:
        data = _user()
        record = {
            "id": item_id,
            "tab_id": tab_id,
            "label": label,
            "prompt": prompt,
            "negative_prompt": negative,
            "thumb": thumb,
        }
        if item_id:
            for index, existing in enumerate(data["items"]):
                if existing.get("id") == item_id:
                    if existing.get("tab_id") != tab_id:
                        raise ValueError("不能把预设移动到别的分类，请重新新增")
                    data["items"][index] = record
                    _write_user(data)
                    return record
            raise ValueError("要修改的预设不存在")
        record["id"] = _new_id("user")
        data["items"].append(record)
        _write_user(data)
    return record


def delete_item(tab_id: str, item_id: str) -> None:
    with _lock:
        data = _user()
        before = len(data["items"])
        data["items"] = [
            item for item in data["items"]
            if not (item.get("id") == item_id and item.get("tab_id") == tab_id)
        ]
        if len(data["items"]) == before:
            raise ValueError("预设不存在")
        _write_user(data)


def save_thumb(data_bytes: bytes, original_name: str) -> str:
    """把上传的图片压成 256px 的 jpg 存进 thumbs，返回文件名。"""
    try:
        with Image.open(_io.BytesIO(data_bytes)) as image:
            image = image.convert("RGB")
            image.thumbnail((MAX_THUMB_SIDE, MAX_THUMB_SIDE), Image.LANCZOS)
            filename = f"{_new_id('user')}.jpg"
            os.makedirs(THUMB_DIR, exist_ok=True)
            image.save(os.path.join(THUMB_DIR, filename), "JPEG", quality=82, optimize=True)
            return filename
    except Exception as exc:
        raise ValueError(f"无法识别的图片: {exc}") from exc
