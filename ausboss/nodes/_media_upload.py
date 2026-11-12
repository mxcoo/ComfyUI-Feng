"""Stream video uploads to ComfyUI's input folder without buffering the body."""

from __future__ import annotations

import asyncio
from pathlib import Path

import av


def upload_name(filename: str, extensions: set[str]) -> str:
    name = str(filename or "")
    if (not name or len(name) > 180 or name in {".", ".."}
            or any(char in name for char in '/\\:')
            or any(ord(char) < 32 for char in name)
            or Path(name).suffix.lower() not in extensions):
        raise ValueError("请选择扩展名受支持、文件名不含特殊字符的视频文件。")
    return name


def reserve_upload(root: Path, name: str):
    """Exclusive creation never follows an existing symlink or replaces a file."""
    source = Path(name)
    for counter in range(10000):
        candidate = root / (name if counter == 0 else f"{source.stem}_{counter}{source.suffix}")
        try:
            return candidate, candidate.open("xb")
        except FileExistsError:
            continue
    raise ValueError("共用此文件名的上传过多，请重命名视频后重试。")


def validate_video(path: Path) -> None:
    with av.open(str(path)) as container:
        if not any(stream.type == "video" for stream in container.streams):
            raise ValueError("上传的文件不含视频流。")


async def stream_video_upload(request, root: Path, extensions: set[str]) -> dict:
    reader = await request.multipart()
    part = await reader.next()
    if part is None or part.name != "image" or not part.filename:
        raise ValueError("请在 image 表单字段中上传视频。")
    name = upload_name(part.filename, extensions)
    path, handle = reserve_upload(root.resolve(), name)
    complete = False
    try:
        while chunk := await part.read_chunk(size=1024 * 1024):
            await asyncio.to_thread(handle.write, chunk)
        handle.close()
        await asyncio.to_thread(validate_video, path)
        complete = True
        return {"name": path.name, "subfolder": "", "type": "input"}
    finally:
        handle.close()
        if not complete:
            path.unlink(missing_ok=True)
