"""Feng 插件入口。

ComfyUI 启动时导入本目录的 __init__.py，然后二选一：
  - 有 NODE_CLASS_MAPPINGS  -> 走 V1 老写法
  - 没有，但有 comfy_entrypoint() -> 走 V3 写法（本文件用这个）
两者只能有其一；同时存在时 V1 优先，V3 部分会被静默忽略。
详见 docs/01-plugin-structure.md。
"""

from typing_extensions import override

from comfy_api.latest import ComfyExtension, io

from .nodes import FengImageFilter, FengTextRepeat
from .nodes_batch_loader import FengBatchImageLoader
from .nodes_prompt_preset import FengPromptPreset

# 前端扩展目录，相对本文件所在目录。web 下所有 .js 都会被前端加载。
WEB_DIRECTORY = "./web"


class FengExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [FengImageFilter, FengTextRepeat, FengPromptPreset, FengBatchImageLoader]


async def comfy_entrypoint() -> FengExtension:
    return FengExtension()
