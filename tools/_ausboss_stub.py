"""在不装 ComfyUI / 不装 torch 的环境里把 AusBoss 的节点模块 import 起来。

用途只有两个：汉化数据提取（tools/ausboss_zh_extract.py）和静态自检
（tools/check_ausboss.py）。节点模块在 import 阶段只需要把 torch / numpy / PIL / av
这些名字取到，真正的运算都在函数体里，所以拿 MagicMock 顶替足够让 44 个模块全部加载，
从而拿到**真实的** NODE_CLASS_MAPPINGS 和 INPUT_TYPES()，而不是靠正则猜。

注意：这里造出来的不是可运行环境。函数体真被调用时 MagicMock 会抛各种 TypeError，
这正是我们想要的——自检只看结构与文案，不跑推理。
"""

from __future__ import annotations

import importlib.abc
import importlib.machinery
import sys
import types
from unittest.mock import MagicMock

# 缺了就 import 失败的第三方与 ComfyUI 模块。folder_paths / server / aiohttp 单独造，
# 因为节点模块在 import 阶段就会调它们的函数（注册路由），MagicMock 会让后面更难排查。
_STUBBED_THIRD_PARTY = (
    "torch",
    "torchvision",
    "numpy",
    "PIL",
    "av",
    "cv2",
    "pymatting",
    "scipy",
    "comfy",
    "comfy_api",
    "comfy_execution",
)

_PRESENT = {}


class _StubModule(types.ModuleType):
    def __getattr__(self, name: str):
        if name.startswith("__"):
            raise AttributeError(name)
        value = MagicMock(name=f"{self.__name__}.{name}")
        setattr(self, name, value)
        return value


def _make_module(name: str) -> types.ModuleType:
    module = _StubModule(name)
    module.__path__ = []  # 允许 import 子模块
    return module


class _Finder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        root = fullname.split(".")[0]
        if root not in _STUBBED_THIRD_PARTY and root not in _PRESENT:
            return None
        return importlib.machinery.ModuleSpec(fullname, _StubLoader(fullname), is_package=True)


class _StubLoader(importlib.abc.Loader):
    def __init__(self, fullname: str) -> None:
        self.fullname = fullname

    def create_module(self, spec):
        module = _make_module(self.fullname)
        _PRESENT[self.fullname] = module
        return module

    def exec_module(self, module):
        return None


def _install_folder_paths() -> None:
    module = _make_module("folder_paths")
    module.get_folder_paths = lambda *a, **k: []
    module.get_input_directory = lambda: "/tmp/comfy-input"
    module.get_output_directory = lambda: "/tmp/comfy-output"
    module.get_temp_directory = lambda: "/tmp/comfy-temp"
    module.get_filename_list = lambda *a, **k: []
    module.get_full_path = lambda *a, **k: None
    module.get_full_path_or_raise = lambda *a, **k: None
    module.get_save_image_path = lambda *a, **k: ("/tmp/comfy-output", "", 1, "", "")
    module.folder_names_and_paths = {}
    sys.modules["folder_paths"] = module


def _install_server() -> None:
    class PromptServer:
        # 给个占位实例：几个节点模块在 import 阶段就会往前缀属性上打标记、注册路由，
        # instance 为 None 会让整个模块 import 失败（真实 ComfyUI 里它启动时就被赋值）。
        instance = types.SimpleNamespace(routes=MagicMock(name="instance.routes"), app=MagicMock(name="instance.app"))
        routes = MagicMock(name="routes")
        last_node_id = None
        client_id = None
        app = MagicMock(name="app")

        @classmethod
        def send_sync(cls, *a, **k):
            return None

    module = _make_module("server")
    module.PromptServer = PromptServer
    sys.modules["server"] = module


def install() -> None:
    """把桩装进 sys.modules。可重复调用。"""
    if getattr(install, "_done", False):
        return
    sys.meta_path.insert(0, _Finder())
    _install_folder_paths()
    _install_server()
    for name in ("aiohttp", "aiohttp.web"):
        sys.modules.setdefault(name, _make_module(name))
    install._done = True


def load_package(package_dir: str, package_name: str = "Feng"):
    """只加载 <package_dir>/ausboss 子包，返回它。

    跳过 <package_dir>/__init__.py：那里会 `from comfy_api.latest import ComfyExtension`
    再拿它当基类，MagicMock 顶不住；而汉化与结构自检只需要 ausboss 这一包。
    """
    install()
    import importlib
    import os

    if package_name not in sys.modules:
        package = types.ModuleType(package_name)
        package.__path__ = [os.path.abspath(package_dir)]
        sys.modules[package_name] = package
    return importlib.import_module(f"{package_name}.ausboss")
