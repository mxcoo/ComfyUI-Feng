"""Feng 插件入口。

ComfyUI 启动时导入本目录的 __init__.py，然后二选一：
  - 有 NODE_CLASS_MAPPINGS  -> 走 V1 老写法
  - 没有，但有 comfy_entrypoint() -> 走 V3 写法（本文件用这个）
两者只能有其一；同时存在时 V1 优先，V3 部分会被静默忽略。
详见 docs/01-plugin-structure.md。

本文件另外把 ausboss/ 那一包 V1 节点注入 ComfyUI 的全局注册表，
原因见 _register_ausboss_nodes() 的说明和 docs/10-ausboss-port.md。
"""

import importlib
import sys
import traceback

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


def _node_registry():
    """ComfyUI 的节点注册表模块（顶层 nodes.py，V1 时代起就没变过）。"""
    for name in ("nodes", "comfy.nodes"):
        module = sys.modules.get(name) or importlib.import_module(name)
        if hasattr(module, "NODE_CLASS_MAPPINGS"):
            return module
    raise ImportError("找不到 ComfyUI 的 nodes 模块")


def _register_ausboss_nodes() -> None:
    """把 AusBoss 的 V1 节点映射并进 ComfyUI 的全局表。

    为什么不在 ausboss/__init__.py 里直接导出 NODE_CLASS_MAPPINGS：ComfyUI 的加载器对
    同一个 __init__.py 只会走一条分支（V1 优先并 return），两条路一起出现时 V3 那半会被
    静默丢掉，所以必须由一个 V3 入口去注入另一套映射。

    节点类本体仍然是上游的 V1 类，执行、校验、object_info、后端路由全走原来的路径，
    因此行为和单独安装 AusBoss 完全一致。
    """
    try:
        from .ausboss import NODE_CLASS_MAPPINGS as ausboss_classes
        from .ausboss import NODE_DISPLAY_NAME_MAPPINGS as ausboss_names
    except Exception:
        traceback.print_exc()
        return

    if not ausboss_classes:
        return

    try:
        registry = _node_registry()
    except ImportError:
        # tools/check_ausboss.py 这类不在 ComfyUI 里跑的环境没有注册表，属正常情况。
        return
    except Exception:
        traceback.print_exc()
        return

    added = 0
    for node_id, node_cls in ausboss_classes.items():
        # 用户另外装了独立 AusBoss 时以独立那份为准：同样的 id，它还有自己的前端与路由。
        # 用 if in 判重而不是清空重建，保证本函数可重入（ComfyUI 有重复加载插件的情况）。
        if node_id in registry.NODE_CLASS_MAPPINGS:
            continue
        registry.NODE_CLASS_MAPPINGS[node_id] = node_cls
        registry.NODE_DISPLAY_NAME_MAPPINGS[node_id] = ausboss_names.get(node_id, node_id)
        added += 1

    if added:
        print(f"[Feng] 并入 AusBoss 节点 {added} 个（本包共 {len(ausboss_classes)} 个）")


_register_ausboss_nodes()
