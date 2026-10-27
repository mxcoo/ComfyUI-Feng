"""一个命令跑完所有能自动化的检查。

当前包含：
  1. check_load.py —— 按 ComfyUI 的加载流程验证插件与节点注册
  2. check_js.py    —— 前端静态检查（括号配平、import 路径）

浏览器里的实际渲染、真实出图不在自动化范围内，改前端后仍需人工确认。

用法：
    & 'H:\\~~~aki-v3.2\\python\\python.exe' tools/check_all.py
"""

import importlib.util
import os
import sys

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))


def run_check(filename: str) -> int:
    name = "_feng_check_" + filename[:-3]
    spec = importlib.util.spec_from_file_location(name, os.path.join(TOOLS_DIR, filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.main()


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    results = {}
    for filename, label in (
        ("check_load.py", "插件加载 / 节点注册"),
        ("check_js.py", "前端静态检查"),
    ):
        print("=" * 60)
        print(f"▶ {label}  ({filename})")
        print("=" * 60)
        try:
            results[filename] = run_check(filename)
        except Exception as exc:  # 检查脚本自身出错也算失败
            print(f"异常：{type(exc).__name__}: {exc}")
            results[filename] = 1

    print("\n" + "=" * 60)
    failed = 0
    for filename, code in results.items():
        print(f"  {'通过' if code == 0 else '失败'}  {filename}")
        if code != 0:
            failed += 1
    print("=" * 60)
    if failed:
        print(f"{failed} 项检查失败")
        return 1
    print("全部检查通过（渲染效果仍需在浏览器里人工确认）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
