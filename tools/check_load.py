"""快速自检：不启动 ComfyUI，直接按 nodes.py 的加载流程检查本插件。

用途：改完 nodes.py 想立刻知道有没有写错，不用等整个 ComfyUI 启动
（本机装了 50 多个插件，完整启动很慢）。

    H:\\~~~aki-v3.2\\python\\python.exe tools/check_load.py

退出码 0 表示通过，非 0 表示失败并打印原因。
"""

import asyncio
import importlib.util
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMFY_ROOT = os.path.dirname(os.path.dirname(PLUGIN_DIR))
PLUGIN_NAME = os.path.basename(PLUGIN_DIR)


def main() -> int:
    sys.path.insert(0, COMFY_ROOT)

    from comfy_api.latest import ComfyExtension

    # 对应 nodes.py:2266-2276：按包加载 __init__.py
    spec = importlib.util.spec_from_file_location(
        PLUGIN_NAME, os.path.join(PLUGIN_DIR, "__init__.py"),
        submodule_search_locations=[PLUGIN_DIR],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PLUGIN_NAME] = module
    spec.loader.exec_module(module)
    print(f"[1/4] 导入 {PLUGIN_NAME}/__init__.py 成功")

    # 对应 nodes.py:2316-2329
    entrypoint = getattr(module, "comfy_entrypoint", None)
    if entrypoint is None:
        if hasattr(module, "NODE_CLASS_MAPPINGS"):
            print("      检测到 NODE_CLASS_MAPPINGS（V1 写法），只做导入检查")
            print(f"\nOK: V1 插件可导入，注册 {len(module.NODE_CLASS_MAPPINGS)} 个节点")
            return 0
        print("错误: 既没有 comfy_entrypoint 也没有 NODE_CLASS_MAPPINGS", file=sys.stderr)
        return 1

    extension = asyncio.run(entrypoint())
    if not isinstance(extension, ComfyExtension):
        print("错误: comfy_entrypoint 没有返回 ComfyExtension 实例", file=sys.stderr)
        return 1
    asyncio.run(extension.on_load())
    print("[2/4] comfy_entrypoint 返回值合法")

    # 对应 nodes.py:2330-2341
    node_list = asyncio.run(extension.get_node_list())
    if not isinstance(node_list, list):
        print("错误: get_node_list() 必须返回 list", file=sys.stderr)
        return 1
    print(f"[3/4] get_node_list 返回 {len(node_list)} 个节点")

    seen = set()
    for node_cls in node_list:
        schema = node_cls.GET_SCHEMA()
        if schema.node_id in seen:
            print(f"错误: node_id 重复 {schema.node_id}", file=sys.stderr)
            return 1
        seen.add(schema.node_id)
        # get_v1_info 是执行期真正使用的那份定义，能提前暴露输入输出写错
        info = schema.get_v1_info(node_cls)
        required = list(info.input_order.get("required", []))
        optional = list(info.input_order.get("optional", []))
        print(f"      - {schema.node_id}  ({schema.display_name})")
        print(f"        分类 {schema.category} | 输出 {info.output}")
        print(f"        必填输入 {required}")
        if optional:
            print(f"        可选输入 {optional}")

    # 对应 nodes.py:2299-2302
    web_dir = getattr(module, "WEB_DIRECTORY", None)
    if web_dir:
        web_path = os.path.abspath(os.path.join(PLUGIN_DIR, web_dir))
        if not os.path.isdir(web_path):
            print(f"错误: WEB_DIRECTORY 指向的不是目录: {web_path}", file=sys.stderr)
            return 1
        js_files = []
        for root, _, files in os.walk(web_path):
            js_files += [os.path.join(root, f) for f in files if f.endswith(".js")]
        print(f"[4/4] WEB_DIRECTORY -> {web_path}")
        for path in js_files:
            print(f"      前端会加载 {os.path.relpath(path, web_path).replace(os.sep, '/')}")
    else:
        print("[4/4] 未设置 WEB_DIRECTORY（没有前端扩展）")

    print("\nOK: 插件加载链路全部通过")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"\n失败: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise
