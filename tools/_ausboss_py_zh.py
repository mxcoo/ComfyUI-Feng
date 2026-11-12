"""把 ausboss/nodes/*.py 里给用户看的报错与日志文案抽出来，翻好后按原位置写回。

为什么不用「就地 sed 替换英文句子」：这批文案里混着大量路径、格式串、SQL/HTTP 片段，
正则替换很容易把模型名、路由名一起改掉。用 AST 定位「raise / print / logging / warnings
的字符串参数」，只动这些字面量本身，位置由 lineno + col_offset 决定，写回时从后往前替换，
前面的偏移不会因为后面的长度变化而失效。

提取：  python3 tools/_ausboss_py_zh.py extract
写回：  python3 tools/_ausboss_py_zh.py apply
两者都只碰 ausboss/nodes 下的 .py；提取产物为 tools/_py_zh/messages.json，
译文放 tools/_py_zh/zh.json（{原文: 译文}）。
"""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NODES_DIR = ROOT / "ausboss" / "nodes"
WORK_DIR = Path(__file__).resolve().parent / "_py_zh"

# 这些调用里的字符串是给用户看的；其余（路由、文件名、格式串）不进来
CALL_NAMES = {
    "print",
    "warn",
    "warning",
    "error",
    "info",
    "debug",
    "exception",
    "critical",
    "warn_once",
}


def _is_message_call(node: ast.AST) -> bool:
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if isinstance(func, ast.Name):
        return func.id in CALL_NAMES
    if isinstance(func, ast.Attribute):
        return func.attr in CALL_NAMES
    return False


def _literals(node: ast.Call) -> list[ast.Constant]:
    """取调用里第一个「像人话」的字符串参数：长度 >= 12 且含空格或中文以外的单词。"""
    out = []
    for arg in list(node.args) + [kw.value for kw in node.keywords]:
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str) and len(arg.value) >= 12:
            out.append(arg)
            break
    return out


def collect(path: Path) -> list[dict]:
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    found = []

    def visit(node: ast.AST) -> None:
        if isinstance(node, ast.Raise) and node.exc is not None:
            exc = node.exc
            if isinstance(exc, ast.Call) and exc.args:
                for lit in _literals(exc)[:1]:
                    if len(lit.value) >= 12:
                        found.append(_record(path, lit, "raise"))
        elif _is_message_call(node):
            for lit in _literals(node)[:1]:
                found.append(_record(path, lit, "log"))
        for child in ast.iter_child_nodes(node):
            visit(child)

    visit(tree)
    return found


def _record(path: Path, node: ast.Constant, kind: str) -> dict:
    return {
        "file": path.resolve().relative_to(ROOT).as_posix(),
        "line": node.lineno,
        "kind": kind,
        "text": node.value,
    }


TOKEN = "\u27e6{}\u27e7"  # ⟦0⟧：给译文留位置，避免和 f-string 的花括号打架


def _template(node: ast.JoinedStr) -> tuple[str, list[str]]:
    """把 f-string 拆成「带占位符的模板 + 各占位符对应的源码表达式」。"""
    parts = []
    exprs = []
    for value in node.values:
        if isinstance(value, ast.Constant):
            parts.append(str(value.value))
        else:
            parts.append(TOKEN.format(len(exprs)))
            exprs.append(ast.unparse(value))
    return "".join(parts), exprs


def _message_joined(node: ast.AST) -> ast.JoinedStr | None:
    if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call):
        for arg in node.exc.args[:1]:
            if isinstance(arg, ast.JoinedStr):
                return arg
    elif _is_message_call(node):
        for arg in node.args[:1]:
            if isinstance(arg, ast.JoinedStr):
                return arg
    return None


def collect_templates(path: Path) -> list[dict]:
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    found = []
    for node in ast.walk(tree):
        joined = _message_joined(node)
        if joined is None or joined.lineno != joined.end_lineno:
            continue
        template, exprs = _template(joined)
        if len(template) < 12 or not any(c.isalpha() for c in template):
            continue
        found.append({
            "file": path.resolve().relative_to(ROOT).as_posix(),
            "line": joined.lineno,
            "col": joined.col_offset,
            "text": template,
            "exprs": exprs,
        })
    return found


def command_extract_f() -> int:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for path in sorted(NODES_DIR.glob("*.py")):
        rows.extend(collect_templates(path))
    unique = {}
    for row in rows:
        unique.setdefault(row["text"], []).append(row)
    payload = {
        "messages": [
            {"text": text, "sites": [f"{r['file']}:{r['line']}" for r in sites]}
            for text, sites in sorted(unique.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        ]
    }
    out = WORK_DIR / "templates.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"f-string 文案 {len(rows)} 处，去重后 {len(payload['messages'])} 条 → {out.relative_to(ROOT)}")
    return 0


def command_apply_f() -> int:
    zh_path = WORK_DIR / "zh-f.json"
    if not zh_path.exists():
        print(f"没有 {zh_path.relative_to(ROOT)}，先翻译")
        return 1
    mapping = json.loads(zh_path.read_text(encoding="utf-8"))
    changed = 0
    missing = 0
    for path in sorted(NODES_DIR.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        rows = collect_templates(path)
        for row in sorted(rows, key=lambda r: (r["line"], r["col"]), reverse=True):
            zh = mapping.get(row["text"])
            if not zh:
                missing += 1
                continue
            if zh == row["text"]:
                continue
            body = zh
            for index, expr in enumerate(row["exprs"]):
                body = body.replace(TOKEN.format(index), "{" + expr + "}")
            if "\u27e6" in body or "\u27e7" in body:
                print(f"占位符没对上，跳过：{row['file']}:{row['line']}")
                continue
            literal = 'f"' + body.replace('"', '\\"') + '"'
            lines = source.splitlines(keepends=True)
            line = lines[row["line"] - 1]
            # 用行内 ASCII 列号定位（col_offset 是 UTF-8 字节偏移，这里用前缀重算字符偏移）
            head = line.encode("utf-8")[: row["col"]].decode("utf-8", "ignore")
            tail = line[len(head):]
            start = source.index(line)
            match = tail.find('f"')
            if match == -1:
                match = tail.find("f'")
                if match == -1:
                    print(f"定位失败，跳过：{row['file']}:{row['line']}")
                    continue
                quote = "f'"
            else:
                quote = 'f"'
            # 找到这一行里该 f-string 的结束引号
            i = match + 2
            while i < len(tail):
                if tail[i] == "\\":
                    i += 2
                    continue
                if tail.startswith(quote[1], i):
                    break
                i += 1
            old = tail[match : i + 1]
            new_literal = quote + body.replace('"', '\\"') + quote[1]
            lines[row["line"] - 1] = head + tail.replace(old, new_literal, 1)
            source = "".join(lines)
            changed += 1
        path.write_text(source, encoding="utf-8")
    print(f"写回 {changed} 处，未翻译 {missing} 处")
    return 0


def command_extract() -> int:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for path in sorted(NODES_DIR.glob("*.py")):
        rows.extend(collect(path))
    # 同一句话在多个节点里复用，只翻一次
    unique = {}
    for row in rows:
        unique.setdefault(row["text"], []).append(row)
    payload = {
        "messages": [
            {"text": text, "sites": [f"{r['file']}:{r['line']}" for r in sites], "kind": sites[0]["kind"]}
            for text, sites in sorted(unique.items(), key=lambda kv: (-len(kv[1]), kv[0]))
        ]
    }
    out = WORK_DIR / "messages.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"文案 {len(rows)} 处，去重后 {len(payload['messages'])} 条 → {out.relative_to(ROOT)}")
    return 0


def command_apply() -> int:
    zh_path = WORK_DIR / "zh.json"
    if not zh_path.exists():
        print(f"没有 {zh_path.relative_to(ROOT)}，先翻译")
        return 1
    mapping = json.loads(zh_path.read_text(encoding="utf-8"))
    changed = 0
    missing = 0
    for path in sorted(NODES_DIR.glob("*.py")):
        raw = path.read_bytes()
        text = raw.decode("utf-8")
        rows = collect(path)
        edits = []
        for row in rows:
            zh = mapping.get(row["text"])
            if not zh or zh == row["text"]:
                if not zh:
                    missing += 1
                continue
            # 用 AST 记录的坐标定位字面量的字节范围
            span = _literal_span(text, row)
            if span is None:
                continue
            start, end = span
            literal = text[start:end]
            quote = literal[:1]
            if quote not in {'"', "'"}:
                continue
            # 只有「这段源码正好就是这句话」才替换，否则坐标算错了，宁可留英文也不错写
            if _span_value(literal) != row["text"]:
                print(f"坐标对不上，跳过：{row['file']}:{row['line']}")
                continue
            body = zh.replace("\\", "\\\\").replace(quote, "\\" + quote).replace("\n", "\\n")
            edits.append((start, end, quote + body + quote))
        if not edits:
            continue
        # 相邻/重叠的区间会让后一次替换吃掉前一次的结果，只保留最左最长的那条
        edits.sort(key=lambda item: (item[0], -item[1]))
        kept = []
        reach = -1
        for start, end, replacement in edits:
            if start < reach:
                continue
            kept.append((start, end, replacement))
            reach = end
        for start, end, replacement in sorted(kept, reverse=True):
            text = text[:start] + replacement + text[end:]
            changed += 1
        path.write_text(text, encoding="utf-8")
    print(f"写回 {changed} 处，未翻译 {missing} 处")
    return 0


def _span_value(literal: str) -> str:
    """把源码里的一个或多个相邻字面量还原成字符串值（只处理常见转义）。"""
    out = []
    index = 0
    while index < len(literal):
        char = literal[index]
        if char not in "\"'":
            index += 1
            continue
        quote = char
        index += 1
        while index < len(literal):
            char = literal[index]
            if char == "\\":
                out.append({"n": "\n", "t": "\t", "r": "\r"}.get(literal[index + 1], literal[index + 1]))
                index += 2
                continue
            if char == quote:
                index += 1
                break
            out.append(char)
            index += 1
    return "".join(out)


def _concat_span(text: str, start: int, value: str) -> tuple[int, int] | None:
    """从 start 处的引号开始，跨过若干相邻字面量，凑够 value 的长度。"""
    if start < 0 or start >= len(text) or text[start] not in "\"'":
        return None
    index = start
    eaten = 0
    while eaten < len(value) and index < len(text):
        quote = text[index]
        if quote not in "\"'":
            index += 1
            continue
        cursor = index + 1
        while cursor < len(text):
            if text[cursor] == "\\":
                cursor += 2
                eaten += 1
                continue
            if text[cursor] == quote:
                break
            cursor += 1
            eaten += 1
        index = cursor + 1
        end = index  # 记下最后一个闭合引号之后的位置，后面跳空白只是找下一段
        while index < len(text) and text[index] in " \t\r\n":
            index += 1
    if eaten < len(value):
        return None
    return start, end


def _literal_span(text: str, row: dict) -> tuple[int, int] | None:
    """在源码里找到这一行的那个字面量，返回 [start, end) 的字符下标。"""
    lines = text.splitlines(keepends=True)
    offset = sum(len(line) for line in lines[: row["line"] - 1])
    line = lines[row["line"] - 1] if row["line"] - 1 < len(lines) else ""
    needle = row["text"]
    for quote in ('"""', "'''", '"', "'"):
        for candidate in (quote + needle + quote,):
            index = line.find(candidate)
            if index != -1:
                return offset + index, offset + index + len(candidate)
    # 隐式拼接（相邻字面量在 AST 里已合并成一个值）：逐段吞掉引号内容，直到凑够长度
    span = _concat_span(text, offset + line.find('"') if '"' in line else -1, row["text"])
    if span is not None:
        return span
    # 隐式拼接或跨行：在全文里找带引号的原句
    for quote in ('"', "'"):
        index = text.find(quote + needle + quote)
        if index != -1:
            return index, index + len(needle) + 2
    # 跨行三引号
    start = text.find('"""' + needle + '"""', offset)
    if start == -1:
        start = text.find("'''" + needle + "'''", offset)
    if start == -1:
        return None
    return start, start + len(needle) + 6


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "extract"
    if command == "extract":
        return command_extract()
    if command == "apply":
        return command_apply()
    if command == "extract-f":
        return command_extract_f()
    if command == "apply-f":
        return command_apply_f()
    print(f"未知命令：{command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
