"""独立安装的 AusBoss 在场时，本移植整体让位。

Manager 装的 `custom_nodes/ausboss-nodes`、git clone 的 `custom_nodes/ComfyUI-AusBoss`
和本移植都会注册同一批节点 id，还会把 `/ausboss/...` 路由注册两遍 —— aiohttp 遇到
重复路由会在启动阶段直接报错。所以只要发现一份独立 AusBoss，就让独立那份加载。

识别方式不用 tomllib：独立安装必有 pyproject.toml（project.name = "ausboss-nodes"）、
__init__.py 和 nodes/ 目录；本移植藏在 Feng/ausboss/ 下，既无 pyproject.toml 也不在
custom_nodes 顶层，永远不会被当成副本。
"""

from __future__ import annotations

import os

PACK_NAME = "ausboss-nodes"


def _looks_like_pack(folder: str) -> bool:
    try:
        with open(os.path.join(folder, "pyproject.toml"), "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        return False
    if f'name = "{PACK_NAME}"' not in text and f"name = '{PACK_NAME}'" not in text:
        return False
    return os.path.isfile(os.path.join(folder, "__init__.py")) and os.path.isdir(
        os.path.join(folder, "nodes")
    )


def other_install_that_loads() -> str | None:
    """返回让位对象的目录名；没有独立安装时返回 None。"""
    try:
        import folder_paths

        roots = list(folder_paths.get_folder_paths("custom_nodes"))
    except Exception:
        # 不在 ComfyUI 里（例如 tools/check_ausboss.py 的空跑）时没有路由冲突可言。
        return None
    own = os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))
    for root in dict.fromkeys(os.path.realpath(r) for r in roots):
        try:
            names = sorted(os.listdir(root))
        except OSError:
            continue
        for name in names:
            if name.endswith(".disabled") or name.startswith("."):
                continue
            folder = os.path.realpath(os.path.join(root, name))
            if folder == own or not os.path.isdir(folder):
                continue
            if _looks_like_pack(folder):
                return name
    return None
