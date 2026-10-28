"""批量图片加载节点。

界面上的图片列表存在隐藏控件 "images" 里（前端面板写的 JSON），后端按列表顺序读取
input / output 目录下的文件，拼成一个 IMAGE 批次输出。顺序 = 面板顺序。

每条记录：
    {"name": "a.png", "subfolder": "", "type": "input"|"output", "selected": true, "mask": ""}
其中 mask 是面板里用画笔画的遮罩文件名（存在 input 目录），只作用于第一张。

尺寸不一致时自动对齐到第一张：开「统一尺寸」等比缩放并居中补边（不裁切），
关掉则等比缩放并居中裁切填满。两种都不会报错。
"""

import asyncio
import json
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from io import BytesIO

import numpy as np
import torch
from PIL import Image, ImageOps

import folder_paths
from comfy_api.latest import io

IMAGES_INPUT = "images"
MAX_IMAGES = 200
# 独立输出口 image_1..image_N 的数量；图像N 固定对应第 N 张，不足 10 张时多余的口不输出
SLOT_COUNT = 10
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff")
MAX_LISTED_FILES = 800
LIST_ROUTE = "/feng_images/list"
PREVIEW_ROUTE = "/feng_images/preview"
DELETE_ROUTE = "/feng_images/delete"
DELETED_DIR_NAME = "delltemp"
PREVIEW_MAX_SIDE = 768
PREVIEW_CACHE_SIZE = 64
# PIL 解码/缩放很吃 CPU：用独立线程池转码，别卡住 ComfyUI 的事件循环，也别占用默认线程池
PREVIEW_WORKERS = 4
_PREVIEW_EXECUTOR = ThreadPoolExecutor(max_workers=PREVIEW_WORKERS, thread_name_prefix="feng-preview")
_PREVIEW_RESAMPLE = getattr(Image, "Resampling", Image).LANCZOS
SOURCES = ("input", "output")


def _normalize(value) -> str:
    return str(value or "").strip()


def _normalize_subfolder(value) -> str:
    """子目录参数统一成正斜杠、去掉首尾斜杠。"""
    return _normalize(value).replace("\\", "/").strip("/")


def parse_entries(raw) -> list[dict]:
    """解析前端写入的图片列表，坏数据一律当空。"""
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return []
    if not isinstance(data, list):
        return []

    entries: list[dict] = []
    for item in data[:MAX_IMAGES]:
        if not isinstance(item, dict):
            continue
        name = _normalize(item.get("name"))
        if not name:
            continue
        source = _normalize(item.get("type")).lower()
        entries.append({
            "name": name,
            "subfolder": _normalize(item.get("subfolder")),
            "type": source if source in SOURCES else "input",
            "selected": item.get("selected", True) is not False,
            "mask": _normalize(item.get("mask")),
        })
    return entries


def _source_dir(source: str) -> str:
    if source == "output":
        return os.path.abspath(folder_paths.get_output_directory())
    return os.path.abspath(folder_paths.get_input_directory())


def _resolve_file(name: str, subfolder: str, source: str) -> str:
    """把文件名解析成真实路径，并做目录包含校验。"""
    base = _source_dir(source)
    relative = os.path.join(subfolder, name) if subfolder else name
    path = os.path.abspath(os.path.join(base, relative))
    if os.path.commonpath([path, base]) != base:
        raise ValueError(f"批量图片加载：非法路径 {relative}")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"批量图片加载：在 {source} 目录找不到 {relative}")
    return path


def _resolve_entry_path(entry: dict) -> str:
    return _resolve_file(entry["name"], entry["subfolder"], entry["type"])


def _delltemp_dir() -> str:
    """删除目录：与 input/output 同级，放在 ComfyUI 根目录下。"""
    return os.path.abspath(os.path.join(os.path.dirname(_source_dir("input")), DELETED_DIR_NAME))


def _deletion_path(source: str, path: str) -> str:
    """保留 input/output 内的相对路径与文件名，拼出 delltemp 里的目标路径。"""
    base = _source_dir(source)
    absolute = os.path.abspath(path)
    if os.path.commonpath([absolute, base]) != base:
        raise ValueError("删除源路径越界")
    relative = os.path.relpath(absolute, base)
    root = _delltemp_dir()
    destination = os.path.abspath(os.path.join(root, source, relative))
    if os.path.commonpath([destination, root]) != root:
        raise ValueError("删除目标路径越界")
    return destination


def _unique_destination(path: str) -> str:
    """同名的旧删除文件已存在时加序号，不覆盖之前删掉的文件。"""
    if not os.path.exists(path):
        return path
    stem, ext = os.path.splitext(path)
    index = 1
    while True:
        candidate = f"{stem}_{index}{ext}"
        if not os.path.exists(candidate):
            return candidate
        index += 1


@lru_cache(maxsize=PREVIEW_CACHE_SIZE)
def _render_webp(path: str, mtime_ns: int, file_size: int, max_side: int) -> bytes:
    """按需生成 WEBP 预览；mtime/size 进缓存键，文件一变就重新生成。"""
    with Image.open(path) as image:
        # JPEG 在解码阶段就按 1/2、1/4、1/8 降采样，缩略图不用先读全尺寸
        image.draft("RGB", (max_side, max_side))
        image = ImageOps.exif_transpose(image)
        has_alpha = image.mode in ("RGBA", "LA") or "transparency" in image.info
        image = image.convert("RGBA" if has_alpha else "RGB")
        image.thumbnail((max_side, max_side), _PREVIEW_RESAMPLE)
        buffer = BytesIO()
        image.save(buffer, format="WEBP", quality=80, method=4)
        return buffer.getvalue()


def _entry_label(entry: dict) -> str:
    relative = f"{entry['subfolder']}/{entry['name']}" if entry["subfolder"] else entry["name"]
    return f"{entry['type']}:{relative}"


def _load_pil(path: str) -> Image.Image:
    with Image.open(path) as image:
        return ImageOps.exif_transpose(image).copy()


def _to_rgb_tensor(image: Image.Image) -> torch.Tensor:
    array = np.array(image.convert("RGB")).astype(np.float32) / 255.0
    return torch.from_numpy(array)[None,]


def _blank(size: tuple[int, int], mode: str) -> Image.Image:
    """按目标模式建空画布：RGB 黑、RGBA/L 全 0（RGBA 即全透明）。"""
    return Image.new(mode, size, 0 if mode != "RGB" else (0, 0, 0))


def _fit_pil(image: Image.Image, size: tuple[int, int], cover: bool = False) -> Image.Image:
    """等比缩放到目标尺寸：cover=True 居中裁切填满，否则居中补边。都不变形、不报错。"""
    if image.size == size:
        return image
    if cover:
        scale = max(size[0] / image.width, size[1] / image.height)
        new_size = (
            max(1, int(round(image.width * scale))),
            max(1, int(round(image.height * scale))),
        )
        resized = image.resize(new_size, Image.LANCZOS)
        left = max(0, (new_size[0] - size[0]) // 2)
        top = max(0, (new_size[1] - size[1]) // 2)
        return resized.crop((left, top, left + size[0], top + size[1]))

    scale = min(size[0] / image.width, size[1] / image.height)
    new_size = (
        max(1, int(round(image.width * scale))),
        max(1, int(round(image.height * scale))),
    )
    resized = image.resize(new_size, Image.LANCZOS)
    canvas = _blank(size, resized.mode)
    canvas.paste(resized, ((size[0] - new_size[0]) // 2, (size[1] - new_size[1]) // 2))
    return canvas


def _pad_pil(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """不缩放，只把原图居中放到更大的画布上（用于"保持各自尺寸"时的批次拼装）。"""
    if image.size == size:
        return image
    canvas = _blank(size, image.mode)
    canvas.paste(image, ((size[0] - image.width) // 2, (size[1] - image.height) // 2))
    return canvas


def _pil_to_mask(image: Image.Image) -> torch.Tensor:
    array = np.array(image.convert("L")).astype(np.float32) / 255.0
    return torch.from_numpy(array)[None,]


def _load_painted_mask_pil(entry: dict) -> Image.Image | None:
    """面板里画的遮罩：白 = 选中，存成 png 放在 input 目录。"""
    mask_name = entry.get("mask")
    if not mask_name:
        return None
    path = _resolve_file(mask_name, "", "input")
    with Image.open(path) as mask_image:
        return mask_image.convert("L").copy()


class FengBatchImageLoader(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="FengBatchImageLoader",
            display_name="Feng · 批量图片加载",
            category="Feng/图像",
            description="拖拽上传或从 input/output 选取多张图片，按面板顺序输出图像组批次，另有图像1..图像10 单图口、遮罩、次数与文件名。第一张可以画笔编辑遮罩；遮罩口只有一个，固定取第一张。",
            search_aliases=["批量加载", "多图", "batch image", "load images", "拖拽上传", "图像组"],
            inputs=[
                io.Boolean.Input(
                    "keep_size",
                    display_name="统一尺寸",
                    default=True,
                    tooltip="开：所有图等比缩放并居中补边到第一张尺寸。关：各图保持原始尺寸（批次口只在尺寸相同时直拼，不同时仅居中留白拼到最大画布，不缩放）。",
                ),
                io.Boolean.Input(
                    "alpha_as_mask",
                    display_name="用 Alpha 作遮罩",
                    default=True,
                    tooltip="只对第一张生效：关掉后第一张的遮罩也为 0。遮罩口只输出这一张（[1,H,W]），不是批次。",
                ),
                io.String.Input(
                    IMAGES_INPUT,
                    display_name="图片列表",
                    default="[]",
                    socketless=True,
                    tooltip="内部使用：前端面板写入的图片列表 JSON。",
                ),
                io.Boolean.Input(
                    "use_slots",
                    display_name="单张接口",
                    default=True,
                    tooltip="开：图像N 只输出第 N 张，与加载顺序一一对应；图片不足 10 张时多余的口不输出。关：图像1 输出图片列表（逐张、可混尺寸，只接列表型节点），图像2..图像10 不输出内容。",
                ),
            ],
            outputs=[
                io.Image.Output(display_name="图像组"),
                # 列表输出：每个元素一张图，尺寸可以不同（排在第二位，方便接列表型消费者）
                io.Int.Output(display_name="次数"),
                io.String.Output(display_name="文件名"),
                # 遮罩紧挨着图像1，方便配对连接
                io.Mask.Output(display_name="遮罩"),
                *[
                    io.Image.Output(display_name=f"图像{index}")
                    for index in range(1, SLOT_COUNT + 1)
                ],
            ],
        )

    @classmethod
    def fingerprint_inputs(cls, keep_size, alpha_as_mask, images, use_slots):
        entries = [entry for entry in parse_entries(images) if entry["selected"]]
        stamps = []
        for index, entry in enumerate(entries):
            try:
                stat = os.stat(_resolve_entry_path(entry))
                # 只有第一张的遮罩参与计算，其他条目的 mask 一律忽略
                mask_name = entry["mask"] if index == 0 else ""
                stamps.append(f"{_entry_label(entry)}:{stat.st_mtime_ns}:{stat.st_size}:{mask_name}")
            except Exception:
                stamps.append(f"{_entry_label(entry)}:missing")
        return f"{keep_size}|{alpha_as_mask}|{use_slots}|" + "|".join(stamps)

    @classmethod
    def execute(cls, keep_size, alpha_as_mask, images, use_slots) -> io.NodeOutput:
        entries = [entry for entry in parse_entries(images) if entry["selected"]]
        if not entries:
            raise ValueError("批量图片加载：还没有选择任何图片")

        loaded = [(entry, _load_pil(_resolve_entry_path(entry))) for entry in entries]
        first_size = loaded[0][1].size

        if keep_size:
            # 统一尺寸：一律等比缩放 + 居中补边到第一张
            batch_size = first_size
        else:
            # 保持各自尺寸：尺寸全同就直拼，不同则只做居中留白拼到最大画布（不缩放）
            same_size = all(image.size == first_size for _entry, image in loaded)
            batch_size = first_size if same_size else (
                max(image.width for _entry, image in loaded),
                max(image.height for _entry, image in loaded),
            )

        batch_tensors: list[torch.Tensor] = []
        native_tensors: list[torch.Tensor] = []
        names: list[str] = []

        # 遮罩只来自第一张图：画笔优先，其次 alpha，都没有就全 0。
        # 「遮罩」口永远是单张 [1, H, W]；其他图片不读取 mask，也不会进这个口。
        first_entry, first_image = loaded[0]
        mask_pil = _load_painted_mask_pil(first_entry)
        if mask_pil is None and alpha_as_mask and first_image.mode in ("RGBA", "LA"):
            mask_pil = first_image.getchannel("A").convert("L")
        if mask_pil is not None and mask_pil.size != first_image.size:
            mask_pil = mask_pil.resize(first_image.size, Image.LANCZOS)

        if mask_pil is None:
            mask_tensor = torch.zeros((1, batch_size[1], batch_size[0]), dtype=torch.float32)
        else:
            if mask_pil.size == batch_size:
                aligned = mask_pil
            elif keep_size:
                aligned = _fit_pil(mask_pil, batch_size)
            else:
                aligned = _pad_pil(mask_pil, batch_size)
            mask_tensor = _pil_to_mask(aligned)

        for index, (entry, image) in enumerate(loaded):
            native_tensors.append(_to_rgb_tensor(image))
            if image.size == batch_size:
                fitted = image
            elif keep_size:
                fitted = _fit_pil(image, batch_size)
            else:
                fitted = _pad_pil(image, batch_size)
            batch_tensors.append(_to_rgb_tensor(fitted))
            names.append(_entry_label(entry))

        batch = torch.cat(batch_tensors, dim=0)
        mask_output = mask_tensor
        # 列表用的源：统一尺寸时是缩放后的图，保持原尺寸时就是各图原样（可混尺寸）
        slots_source = batch_tensors if keep_size else native_tensors
        # 列表元素去掉批维（[H,W,3]）：这样 PreviewImage 迭代 list 时拿到的是单张图，
        # 不会再被当成批次变成 4 维数组而崩在 Image.fromarray
        image_list = [tensor[0] for tensor in slots_source]

        if use_slots:
            # 单张接口：图像N 固定对应第 N 张，一一对应。
            # 图片不足 10 张时，多出来的口输出 None（没有图可给），不重复最后一张。
            slots = list(slots_source[:SLOT_COUNT])
            slots += [None] * (SLOT_COUNT - len(slots))
        else:
            # 关掉时：图像1 输出图片列表（逐张、可混尺寸），其余单图口不输出内容
            slots = [image_list] + [None] * (SLOT_COUNT - 1)

        return io.NodeOutput(batch, len(names), "\n".join(names), mask_output, *slots)


def _register_routes() -> None:
    try:
        from aiohttp import web
        from server import PromptServer
    except Exception:
        return
    instance = getattr(PromptServer, "instance", None)
    if instance is None:
        return

    @instance.routes.get(LIST_ROUTE)
    async def feng_list_images(request):
        source = (request.query.get("source") or "input").lower()
        if source not in SOURCES:
            return web.json_response({"error": "source 只能是 input 或 output"}, status=400)

        base = _source_dir(source)
        subfolder = _normalize_subfolder(request.query.get("subfolder"))
        target = os.path.abspath(os.path.join(base, subfolder)) if subfolder else base

        # 只允许在 input/output 目录内部，防止用 ../ 跳出去
        if os.path.commonpath([target, base]) != base:
            return web.json_response({"error": "非法子目录"}, status=400)
        if not os.path.isdir(target):
            return web.json_response({"error": f"目录不存在：{subfolder}"}, status=400)

        files = []
        folders = []
        # 只列当前这一层，避免把整棵树扫出来（文件多的目录会明显变快）
        for name in os.listdir(target):
            full = os.path.join(target, name)
            if os.path.isdir(full):
                folders.append(name)
                continue
            if os.path.splitext(name)[1].lower() not in IMAGE_EXTENSIONS:
                continue
            try:
                stat = os.stat(full)
                mtime = stat.st_mtime
                mtime_ns = stat.st_mtime_ns
            except OSError:
                mtime = 0
                mtime_ns = 0
            files.append({
                "name": name,
                "subfolder": subfolder,
                "type": source,
                "mtime": mtime,
                "mtime_ns": mtime_ns,
            })

        files.sort(key=lambda item: item["mtime"], reverse=True)
        folders.sort(key=str.lower)
        return web.json_response({
            "files": files[:MAX_LISTED_FILES],
            "folders": folders[:MAX_LISTED_FILES],
            "subfolder": subfolder,
            "source": source,
        })

    @instance.routes.get(PREVIEW_ROUTE)
    async def feng_preview_image(request):
        source = (request.query.get("source") or "input").lower()
        if source not in SOURCES:
            return web.json_response({"error": "source 只能是 input 或 output"}, status=400)

        name = _normalize(request.query.get("name"))
        if not name:
            return web.json_response({"error": "缺少 name"}, status=400)
        if os.path.splitext(name)[1].lower() not in IMAGE_EXTENSIONS:
            return web.json_response({"error": "不是图片文件"}, status=400)

        try:
            max_side = int(request.query.get("max") or PREVIEW_MAX_SIDE)
        except (TypeError, ValueError):
            return web.json_response({"error": "max 必须是整数"}, status=400)
        max_side = max(64, min(1600, max_side))

        try:
            path = _resolve_file(name, _normalize_subfolder(request.query.get("subfolder")), source)
            stat = os.stat(path)
        except (ValueError, OSError) as exc:
            return web.json_response({"error": str(exc)}, status=400)

        try:
            loop = asyncio.get_running_loop()
            data = await loop.run_in_executor(
                _PREVIEW_EXECUTOR, _render_webp, path, stat.st_mtime_ns, stat.st_size, max_side
            )
        except Exception as exc:
            return web.json_response({"error": f"生成 WEBP 预览失败：{exc}"}, status=400)

        return web.Response(
            body=data,
            content_type="image/webp",
            headers={"Cache-Control": "private, max-age=86400"},
        )

    @instance.routes.post(DELETE_ROUTE)
    async def feng_delete_image(request):
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"error": "请求体必须是 JSON"}, status=400)
        if not isinstance(payload, dict):
            return web.json_response({"error": "请求体必须是 JSON 对象"}, status=400)

        source = _normalize(payload.get("type")).lower()
        if source not in SOURCES:
            return web.json_response({"error": "type 只能是 input 或 output"}, status=400)

        name = _normalize(payload.get("name"))
        if not name:
            return web.json_response({"error": "缺少 name"}, status=400)
        if os.path.splitext(name)[1].lower() not in IMAGE_EXTENSIONS:
            return web.json_response({"error": "只能删除图片文件"}, status=400)

        subfolder = _normalize_subfolder(payload.get("subfolder"))
        try:
            path = _resolve_file(name, subfolder, source)
            destination = _deletion_path(source, path)
        except (ValueError, OSError) as exc:
            return web.json_response({"error": str(exc)}, status=400)

        try:
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            destination = _unique_destination(destination)
            shutil.move(path, destination)
        except OSError as exc:
            return web.json_response({"error": f"移动失败：{exc}"}, status=400)

        root = os.path.dirname(_delltemp_dir())
        moved_to = os.path.relpath(destination, root).replace(os.sep, "/")
        return web.json_response({
            "deleted": True,
            "name": name,
            "subfolder": subfolder,
            "type": source,
            "moved_to": moved_to,
        })


_register_routes()
