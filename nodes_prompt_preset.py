"""多功能提示词预设节点。

界面的全部选择都存在 "配置存储" 这个隐藏控件里（前端面板写入 JSON），
后端按 id 查出提示词片段再按顺序合并。合并规则对齐常见的风格混搭做法：
第一个带 {prompt} 占位符的风格会把已有正文包进去，后续风格只做追加。
"""

import json
import random
import time

from aiohttp import web
from comfy_api.latest import io

from . import preset_store

CONFIG_INPUT = "config"
OPTION_OFF = "关闭"
OPTION_RANDOM = "随机"
OPTION_NONE = "无"
INDEX_ROUTE = "/feng_presets/index"
PREVIEW_ROUTE = "/feng_presets/preview"
THUMB_ROUTE = "/feng_presets/thumb/{name}"
THUMB_UPLOAD_ROUTE = "/feng_presets/upload"
CATEGORY_ROUTE = "/feng_presets/category"
CATEGORY_UPDATE_ROUTE = "/feng_presets/category/update"
CATEGORY_DELETE_ROUTE = "/feng_presets/category/{category_id}"
ITEM_ROUTE = "/feng_presets/item"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def _normalize(value) -> str:
    return str(value or "").strip()


def _join(segments) -> str:
    parts = []
    for segment in segments:
        text = _normalize(segment).strip(" ,")
        if text:
            parts.append(text)
    return ", ".join(parts)


def parse_config(raw) -> dict:
    """把前端写进来的 JSON 解析成 {active, selected, fields}，坏数据一律当空。"""
    state = {"active": [], "selected": {}, "fields": {}}
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        data = None
    if not isinstance(data, dict):
        return state

    active = data.get("active")
    if isinstance(active, list):
        state["active"] = [item for item in active if isinstance(item, str)]

    selected = data.get("selected")
    if isinstance(selected, dict):
        for tab_id, ids in selected.items():
            if isinstance(ids, list):
                state["selected"][str(tab_id)] = [item for item in ids if isinstance(item, str)]

    fields = data.get("fields")
    if isinstance(fields, dict):
        for tab_id, values in fields.items():
            if isinstance(values, dict):
                state["fields"][str(tab_id)] = dict(values)

    return state


def _field_choice(field: dict, values: dict, rng: random.Random) -> str:
    """把一个下拉字段解析成提示词片段：无/关闭 -> 空，随机会从候选里抽一个。"""
    text = _normalize(values.get(field.get("id"), field.get("default")))
    if text in ("", OPTION_OFF, OPTION_NONE):
        return ""
    if text == OPTION_RANDOM:
        pool = field.get("random_pool") or [
            item for item in (field.get("options") or [])
            if item not in (OPTION_NONE, OPTION_RANDOM, OPTION_OFF)
        ]
        return rng.choice(pool) if pool else ""
    mapping = field.get("option_map") or {}
    if text not in mapping:
        # 旧存档里存的是英文原值，用别名表映射回中文标签
        text = (field.get("option_alias") or {}).get(text, text)
    return _normalize(mapping.get(text, text))


def _build_mapped_prompt(fields: list[dict], values: dict, rng: random.Random) -> str:
    parts = []
    for field in fields:
        choice = _field_choice(field, values, rng)
        if choice:
            parts.append(choice)
    return _join(parts)


def _build_idphoto_prompt(tab: dict, values: dict, rng: random.Random) -> str:
    """证件照：先拼「一个 + 体型 国籍 性别」，再逐项补充，最后加背景。"""
    by_id = {field.get("id"): field for field in tab.get("fields", [])}

    def pick(field_id: str) -> str:
        field = by_id.get(field_id)
        return _field_choice(field, values, rng) if field else ""

    base = [pick(field_id) for field_id in ("证件照体型", "证件照国籍", "证件照性别")]
    parts: list[str] = []
    if any(base):
        parts.append("一个" + " ".join(item for item in base if item))
    for field_id in ("证件照构图", "证件照服饰佩饰", "证件照表情", "证件照妆容", "证件照其他佩饰"):
        value = pick(field_id)
        if value:
            parts.append(value)
    hair = " ".join(item for item in (pick("证件照发色"), pick("证件照发型")) if item)
    if hair:
        parts.append(hair)
    clothing = " ".join(item for item in (pick("证件照服装颜色"), pick("证件照服装款式")) if item)
    if clothing:
        parts.append(clothing)
    background = pick("证件照背景色")
    if background:
        parts.append(background if "背景" in background else f"{background}背景")
    return _join(parts)


def _angle_parts(values: dict) -> dict:
    """把旋转/俯仰/远近换算成英文机位描述，同时给出中文方位，分档与 GJJ 一致。"""

    def clamp(key: str, default, cast, low, high):
        try:
            value = cast(values.get(key, default))
        except (TypeError, ValueError):
            value = default
        return max(low, min(high, value))

    rotate = clamp("rotate", 0, int, 0, 360)
    pitch = clamp("pitch", 0, int, -90, 90)
    zoom = clamp("zoom", 5.0, float, 0.0, 10.0)
    detailed = _normalize(values.get("detail", "详细")) != "简洁"
    suffix = "" if detailed else " quarter"

    if rotate < 22.5 or rotate >= 337.5:
        horizontal, cn_horizontal = "front view", "正面"
    elif rotate < 67.5:
        horizontal, cn_horizontal = f"front-right{suffix} view", "右前"
    elif rotate < 112.5:
        horizontal, cn_horizontal = "right side view", "右侧"
    elif rotate < 157.5:
        horizontal, cn_horizontal = f"back-right{suffix} view", "右后"
    elif rotate < 202.5:
        horizontal, cn_horizontal = "back view", "背面"
    elif rotate < 247.5:
        horizontal, cn_horizontal = f"back-left{suffix} view", "左后"
    elif rotate < 292.5:
        horizontal, cn_horizontal = "left side view", "左侧"
    else:
        horizontal, cn_horizontal = f"front-left{suffix} view", "左前"

    if detailed:
        if pitch == -90:
            vertical = "bottom-looking-up perspective, extreme worm's eye view, focus subject bottom"
            cn_vertical = "极限仰视"
        elif pitch < -75:
            vertical, cn_vertical = "bottom-looking-up perspective, extreme worm's eye view", "大仰视"
        elif pitch < -45:
            vertical, cn_vertical = "ultra-low angle", "仰视"
        elif pitch < -15:
            vertical, cn_vertical = "low angle", "低角度"
        elif pitch < 15:
            vertical, cn_vertical = "eye level", "平视"
        elif pitch < 45:
            vertical, cn_vertical = "high angle", "俯视"
        elif pitch < 75:
            vertical, cn_vertical = "bird's eye view", "高角度俯视"
        elif pitch < 90:
            vertical = "top-down perspective, looking straight down at the top of the subject"
            cn_vertical = "顶视"
        else:
            vertical = (
                "top-down perspective, looking straight down at the top of the subject, "
                "face not visible, focus on subject head"
            )
            cn_vertical = "正顶视"
    else:
        if pitch < -15:
            vertical, cn_vertical = "low-angle shot", "低角度"
        elif pitch < 15:
            vertical, cn_vertical = "eye-level shot", "平视"
        elif pitch < 45:
            vertical, cn_vertical = "elevated shot", "抬高"
        elif pitch < 75:
            vertical, cn_vertical = "high-angle shot", "高角度"
        else:
            vertical, cn_vertical = "top-down shot", "顶视"

    if zoom < 2:
        distance, cn_distance = "extreme wide shot", "超远景"
    elif zoom < 4:
        distance, cn_distance = "wide shot", "远景"
    elif zoom < 6:
        distance, cn_distance = "medium shot", "中景"
    elif zoom < 8:
        distance, cn_distance = "close-up", "近景"
    else:
        distance, cn_distance = "extreme close-up", "特写"

    return {
        "rotate": rotate,
        "pitch": pitch,
        "zoom": zoom,
        "detailed": detailed,
        "horizontal": horizontal,
        "vertical": vertical,
        "distance": distance,
        "cn_horizontal": cn_horizontal,
        "cn_vertical": cn_vertical,
        "cn_distance": cn_distance,
    }


def _build_angle_prompt(values: dict) -> str:
    parts = _angle_parts(values)
    if parts["detailed"]:
        return (
            f"{parts['horizontal']}, {parts['vertical']}, {parts['distance']} "
            f"(horizontal: {parts['rotate']}, vertical: {parts['pitch']}, zoom: {parts['zoom']:.1f})"
        )
    return f"{parts['horizontal']} {parts['vertical']} {parts['distance']}"


def _angle_summary(values: dict) -> dict:
    parts = _angle_parts(values)
    return {
        "horizontal": parts["cn_horizontal"],
        "vertical": parts["cn_vertical"],
        "distance": parts["cn_distance"],
        "rotate": parts["rotate"],
        "pitch": parts["pitch"],
        "zoom": round(parts["zoom"], 1),
        "detailed": parts["detailed"],
    }


def _build_template_prompt(tab: dict, values: dict, rng: random.Random) -> str:
    template = tab.get("template") or ""
    if not template:
        return ""

    mapping: dict[str, object] = {}
    for field in tab.get("fields", []):
        field_id = field.get("id")
        field_type = field.get("type", "combo")
        if field_type in ("int", "float"):
            raw_value = values.get(field_id, field.get("default"))
            try:
                number = float(raw_value)
                mapping[field_id] = int(number) if field_type == "int" else number
            except (TypeError, ValueError):
                mapping[field_id] = field.get("default", 0)
        else:
            mapping[field_id] = _field_choice(field, values, rng)

    try:
        return template.format(**mapping).strip()
    except (KeyError, IndexError, ValueError):
        return ""


def _build_fields_prompt(tab: dict, values: dict, rng: random.Random) -> str:
    builder = tab.get("builder", "template")
    if builder == "idphoto":
        return _build_idphoto_prompt(tab, values, rng)
    if builder == "angle":
        return _build_angle_prompt(values)
    if builder == "mapped":
        return _build_mapped_prompt(tab.get("fields", []), values, rng)
    return _build_template_prompt(tab, values, rng)


def _apply_items(core_positive: str, core_negative: str, items: list[dict]) -> tuple[str, str]:
    """把选中的预设片段混进正文。第一个含 {prompt} 的片段包裹正文，其余只追加。"""
    if not items:
        return core_positive, core_negative

    positive = core_positive
    negative_parts = [core_negative] if _normalize(core_negative) else []
    substituted = False

    for item in items:
        prompt_text = _normalize(item.get("prompt"))
        negative_text = _normalize(item.get("negative_prompt"))
        if prompt_text:
            if "{prompt}" in prompt_text and not substituted:
                positive = prompt_text.replace("{prompt}", positive or "")
                substituted = True
            elif "{prompt}" in prompt_text:
                positive = _join([positive, prompt_text.replace(", {prompt}", "").replace("{prompt}", "")])
            else:
                positive = _join([positive, prompt_text])
        if negative_text:
            negative_parts.append(negative_text)

    return positive.strip(" ,"), _join(negative_parts)


class FengPromptPreset(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        negatives = list(preset_store.get_negative_presets().keys()) or [OPTION_OFF]
        default_negative = "通用写实" if "通用写实" in negatives else negatives[0]
        return io.Schema(
            node_id="FengPromptPreset",
            display_name="Feng · 多功能提示词预设",
            category="Feng/提示词",
            description="按页签选风格、证件照、多角度、主体、环境与随机灵感，输出混合后的正负提示词。点上方页签启用分组，Shift 可多选分组。",
            search_aliases=["提示词预设", "风格", "prompt preset", "style", "fooocus"],
            inputs=[
                io.String.Input(
                    "positive_base",
                    display_name="正向基础词",
                    default="",
                    tooltip="手动填写的基础正向词，会排在所有预设片段之前。",
                ),
                io.String.Input(
                    "negative_base",
                    display_name="反向基础词",
                    default="",
                    tooltip="手动填写的基础反向词，会与风格反向、通用反向一起合并。",
                ),
                io.Combo.Input(
                    "negative_preset",
                    display_name="通用反向预设",
                    options=negatives,
                    default=default_negative,
                    tooltip="按用途补一组常见反向词；选关闭则只保留你自己的反向词。",
                ),
                io.Int.Input(
                    "seed",
                    display_name="随机种子",
                    default=0,
                    min=0,
                    max=0xFFFFFFFFFFFFFFFF,
                    control_after_generate=True,
                    tooltip="字段里选“随机”时生效。填 0 表示每次重新抽取。",
                ),
                io.String.Input(
                    CONFIG_INPUT,
                    display_name="配置存储",
                    default="{}",
                    socketless=True,
                    tooltip="内部使用：前端面板写入的选择状态 JSON。",
                ),
            ],
            outputs=[
                io.String.Output(display_name="混合正向提示词"),
                io.String.Output(display_name="混合反向提示词"),
            ],
        )

    @classmethod
    def fingerprint_inputs(cls, positive_base, negative_base, negative_preset, seed, config):
        state = parse_config(config)
        for tab_id, values in state["fields"].items():
            tab = preset_store.get_tab(tab_id)
            if not tab:
                continue
            for field in tab.get("fields", []):
                if _normalize(values.get(field.get("id"), field.get("default"))) == OPTION_RANDOM:
                    if int(seed or 0) == 0:
                        return float("nan")
        return f"{positive_base}|{negative_base}|{negative_preset}|{seed}|{config}"

    @classmethod
    def execute(cls, positive_base, negative_base, negative_preset, seed, config) -> io.NodeOutput:
        state = parse_config(config)
        active = state["active"]
        rng = random.Random(int(seed) if int(seed or 0) > 0 else (time.time_ns() & 0xFFFFFFFF))

        segments = [positive_base]
        items: list[dict] = []
        for tab_id in active:
            tab = preset_store.get_tab(tab_id)
            if not tab:
                continue
            kind = tab.get("kind")
            if kind == "fields":
                segments.append(_build_fields_prompt(tab, state["fields"].get(tab_id, {}), rng))
            elif kind in ("cards", "styles"):
                lookup = {item.get("id"): item for item in tab.get("items", [])}
                for item_id in state["selected"].get(tab_id, []):
                    item = lookup.get(item_id)
                    if item:
                        items.append(item)

        negative_segments = [negative_base, preset_store.get_negative_preset(negative_preset)]

        final_positive, final_negative = _apply_items(
            _join(segments), _join(negative_segments), items
        )
        return io.NodeOutput(_join([final_positive]), _join([final_negative]))


def _bad_request(message: str):
    return web.json_response({"error": message}, status=400)


async def _read_json_body(request) -> dict:
    try:
        payload = await request.json()
    except Exception:
        raise web.HTTPBadRequest(text="请求体不是合法 JSON")
    if not isinstance(payload, dict):
        raise web.HTTPBadRequest(text="请求体必须是 JSON 对象")
    return payload


def _register_routes() -> None:
    try:
        from server import PromptServer
    except Exception:
        return
    instance = getattr(PromptServer, "instance", None)
    if instance is None:
        return

    @instance.routes.get(INDEX_ROUTE)
    async def feng_presets_index(request):
        return web.json_response(preset_store.build_index())

    @instance.routes.get(THUMB_ROUTE)
    async def feng_presets_thumb(request):
        path = preset_store.resolve_thumb(request.match_info.get("name", ""))
        if path is None:
            raise web.HTTPNotFound()
        return web.FileResponse(path)

    @instance.routes.post(THUMB_UPLOAD_ROUTE)
    async def feng_presets_thumb_upload(request):
        if not request.content_type.startswith("multipart/"):
            return _bad_request("需要 multipart/form-data")
        reader = await request.multipart()
        field = await reader.next()
        if field is None or field.name != "image":
            return _bad_request("缺少 image 字段")
        data = await field.read()
        if not data:
            return _bad_request("图片为空")
        if len(data) > MAX_UPLOAD_BYTES:
            return _bad_request("图片超过 20MB")
        try:
            thumb = preset_store.save_thumb(data, field.filename or "")
        except ValueError as exc:
            return _bad_request(str(exc))
        return web.json_response({"thumb": thumb})

    @instance.routes.post(PREVIEW_ROUTE)
    async def feng_presets_preview(request):
        payload = await _read_json_body(request)
        tab = preset_store.get_tab(str(payload.get("tab_id") or ""))
        if tab is None or tab.get("kind") != "fields":
            return _bad_request("该页签不支持预览")
        values = payload.get("values")
        if not isinstance(values, dict):
            values = {}
        text = _build_fields_prompt(tab, values, random.Random(0))
        result = {"text": text}
        if tab.get("builder") == "angle":
            result["angle"] = _angle_summary(values)
        return web.json_response(result)

    @instance.routes.post(CATEGORY_ROUTE)
    async def feng_presets_category_add(request):
        payload = await _read_json_body(request)
        try:
            category = preset_store.add_category(payload.get("label"))
        except ValueError as exc:
            return _bad_request(str(exc))
        return web.json_response(category)

    @instance.routes.post(CATEGORY_UPDATE_ROUTE)
    async def feng_presets_category_update(request):
        payload = await _read_json_body(request)
        try:
            category = preset_store.update_category(str(payload.get("id") or ""), payload.get("label"))
        except ValueError as exc:
            return _bad_request(str(exc))
        return web.json_response(category)

    @instance.routes.delete(CATEGORY_DELETE_ROUTE)
    async def feng_presets_category_delete(request):
        try:
            preset_store.delete_category(request.match_info.get("category_id", ""))
        except ValueError as exc:
            return _bad_request(str(exc))
        return web.json_response({"ok": True})

    @instance.routes.get(ITEM_ROUTE)
    async def feng_presets_item_get(request):
        item = preset_store.get_item(request.query.get("tab_id", ""), request.query.get("id", ""))
        if item is None:
            return _bad_request("预设不存在")
        return web.json_response({
            "id": item.get("id"),
            "label": item.get("label"),
            "prompt": item.get("prompt", ""),
            "negative_prompt": item.get("negative_prompt", ""),
            "thumb": item.get("thumb", ""),
            "custom": bool(item.get("custom")),
        })

    @instance.routes.post(ITEM_ROUTE)
    async def feng_presets_item_save(request):
        payload = await _read_json_body(request)
        try:
            item = preset_store.save_item(payload)
        except ValueError as exc:
            return _bad_request(str(exc))
        return web.json_response(item)

    @instance.routes.delete(ITEM_ROUTE)
    async def feng_presets_item_delete(request):
        try:
            preset_store.delete_item(request.query.get("tab_id", ""), request.query.get("id", ""))
        except ValueError as exc:
            return _bad_request(str(exc))
        return web.json_response({"ok": True})


_register_routes()
