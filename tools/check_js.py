"""JS 静态体检：括号配平 + import 路径解析 + 明显误用扫描。

本机没有 Node 运行时，也没法做浏览器自动化，前端只能靠这个脚本做静态验证。
真正的渲染效果必须由人在浏览器里确认。

用法：
    & 'H:\\~~~aki-v3.2\\python\\python.exe' tools/check_js.py
"""

import os
import re
import sys

PLUGIN_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(PLUGIN_DIR, "web")

# 前端扩展在浏览器里的 URL 前缀，由插件目录名决定（ComfyUI 用模块名注册静态目录）
PLUGIN_PREFIX = f"/extensions/{os.path.basename(PLUGIN_DIR)}/"


def find_static_root() -> str:
    """找到 comfyui_frontend_package 的 static 目录，用来校验 import 目标是否存在。"""
    try:
        import comfyui_frontend_package

        return os.path.join(os.path.dirname(comfyui_frontend_package.__file__), "static")
    except Exception:
        pass
    for candidate in (
        r"H:\~~~aki-v3.2\python\Lib\site-packages\comfyui_frontend_package\static",
    ):
        if os.path.isdir(candidate):
            return candidate
    return ""


def strip_code(text: str) -> str:
    """去掉注释、字符串、模板字符串，只留下括号等结构字符。"""
    out: list[str] = []
    i = 0
    length = len(text)
    while i < length:
        ch = text[i]
        if ch == "/" and i + 1 < length and text[i + 1] == "/":
            while i < length and text[i] != "\n":
                i += 1
        elif ch == "/" and i + 1 < length and text[i + 1] == "*":
            i += 2
            while i + 1 < length and not (text[i] == "*" and text[i + 1] == "/"):
                i += 1
            i += 2
        elif ch in "\"'`":
            quote = ch
            i += 1
            while i < length:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == quote:
                    i += 1
                    break
                if quote == "`" and text[i] == "$" and i + 1 < length and text[i + 1] == "{":
                    depth = 1
                    i += 2
                    out.append("{")
                    while i < length and depth:
                        if text[i] == "{":
                            depth += 1
                            out.append("{")
                        elif text[i] == "}":
                            depth -= 1
                            out.append("}")
                        i += 1
                    continue
                i += 1
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def check_balance(name: str, code: str) -> list[str]:
    problems: list[str] = []
    pairs = {")": "(", "]": "[", "}": "{"}
    stack: list[tuple[str, int]] = []
    line = 1
    for ch in code:
        if ch == "\n":
            line += 1
        elif ch in "([{":
            stack.append((ch, line))
        elif ch in ")]}":
            if not stack:
                problems.append(f"{name}: 第 {line} 行多余的 {ch}")
            else:
                opener, opened_line = stack.pop()
                if opener != pairs[ch]:
                    problems.append(f"{name}: 第 {line} 行 {ch} 与第 {opened_line} 行 {opener} 不匹配")
    for opener, opened_line in stack:
        problems.append(f"{name}: 第 {opened_line} 行的 {opener} 没有闭合")
    return problems


def check_imports(name: str, text: str, url_path: str, static_root: str) -> list[str]:
    if not static_root:
        print("     跳过 import 校验（没找到前端包目录）")
        return []

    problems: list[str] = []
    for match in re.finditer(r'from\s+"([^"]+)"', text):
        spec = match.group(1)
        if not spec.startswith((".", "/")):
            problems.append(f"{name}: 只支持相对/绝对路径 import，发现 {spec!r}")
            continue
        if spec.startswith("/"):
            resolved = spec
        else:
            parts = [p for p in url_path.rsplit("/", 1)[0].split("/") if p]
            for piece in spec.split("/"):
                if piece == "..":
                    if parts:
                        parts.pop()
                elif piece == ".":
                    continue
                else:
                    parts.append(piece)
            resolved = "/" + "/".join(parts)
        disk = os.path.join(static_root, resolved.lstrip("/").replace("/", os.sep))
        ok = os.path.isfile(disk)
        print(f"     {'OK  ' if ok else '缺失'} {spec:28s} -> {resolved}")
        if not ok:
            problems.append(f"{name}: import {spec!r} -> {resolved} 解析失败")
    return problems


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    static_root = find_static_root()
    problems: list[str] = []
    checked = 0

    for root, _dirs, files in os.walk(WEB_DIR):
        for filename in sorted(files):
            if not filename.endswith(".js"):
                continue
            path = os.path.join(root, filename)
            rel = os.path.relpath(path, WEB_DIR).replace(os.sep, "/")
            url_path = PLUGIN_PREFIX + rel
            with open(path, encoding="utf-8") as handle:
                text = handle.read()
            checked += 1
            print(f"\n检查 {rel}  (URL {url_path}, {len(text.splitlines())} 行)")
            problems += check_balance(rel, strip_code(text))
            problems += check_imports(rel, text, url_path, static_root)

    print("\n" + "=" * 60)
    if problems:
        print(f"发现 {len(problems)} 个问题：")
        for item in problems:
            print("  -", item)
        return 1
    print(f"JS 静态检查通过（{checked} 个文件）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
