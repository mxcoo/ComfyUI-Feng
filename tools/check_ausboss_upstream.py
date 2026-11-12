"""对照上游 AusBoss 的检出，检查本包有没有走样。

用法：
    python tools/check_ausboss_upstream.py <上游检出目录> [上游的 tag 或 commit]

第二个参数省略时用 `HEAD`；上游刚 `git fetch` 完还没切过去时，直接传 `FETCH_HEAD`
或 tag 名（例如 `v2.24.0`）更稳。

它回答三个问题（对应 docs/11 第 1.1 节）：
  1. 节点文件集是否与上游一致（无缺无多）；
  2. 忽略字符串内容后，有哪些文件的结构与上游不同（应当只有我们有意改的那三个）；
  3. f-string 的插值表达式是否与上游一致（防译文把 {x} 写成 {{x}}）。

上游目录用 git clone 或 `git -C <dir> fetch` 拿到最新即可，不需要装在 ComfyUI 里。
"""

from __future__ import annotations

import ast
import subprocess
import sys
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parent.parent
NODES_DIR = PLUGIN_DIR / "ausboss" / "nodes"

# 这三处是移植时有意改的，结构本来就与上游不同。
EXPECTED = {"_frontend_cache.py", "_media_helpers.py", "_single_copy.py"}


def _git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, encoding="utf-8"
    )
    if result.returncode:
        raise SystemExit(f"git {' '.join(args)} 失败：{result.stderr.strip()}")
    return result.stdout


def _normalized(source: str) -> str:
    """AST 文本，但所有字符串常量都抹成 "S"，纯字面量 f-string 也降级成常量。"""
    tree = ast.parse(source)

    class Flatten(ast.NodeTransformer):
        def visit_Constant(self, node):  # noqa: N802
            if isinstance(node.value, str):
                node.value = "S"
            return node

        def visit_JoinedStr(self, node):  # noqa: N802
            self.generic_visit(node)
            if all(isinstance(value, ast.Constant) for value in node.values):
                return ast.copy_location(ast.Constant(value="S"), node)
            return node

    tree = Flatten().visit(tree)
    ast.fix_missing_locations(tree)
    return ast.dump(tree)


def _expressions(source: str) -> set[str]:
    names = set()
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.JoinedStr):
            for value in node.values:
                if isinstance(value, ast.FormattedValue):
                    names.add(ast.unparse(value.value))
    return names


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print("用法: python tools/check_ausboss_upstream.py <上游检出目录> [tag 或 commit]")
        return 2
    ref = sys.argv[2] if len(sys.argv) == 3 else "HEAD"
    upstream = Path(sys.argv[1]).resolve()
    if not (upstream / "nodes").is_dir():
        print(f"{upstream} 下没有 nodes/，是不是指错了目录？")
        return 2

    listed = _git(upstream, "ls-tree", "-r", "--name-only", ref, "nodes/").split()
    upstream_files = sorted(Path(name).name for name in listed if name.endswith(".py"))
    local_files = sorted(path.name for path in NODES_DIR.glob("*.py"))

    problems = 0
    only_upstream = sorted(set(upstream_files) - set(local_files))
    only_local = sorted(set(local_files) - set(upstream_files))
    if only_upstream:
        problems += 1
        print(f"上游有、我们没有: {', '.join(only_upstream)}")
    if only_local:
        problems += 1
        print(f"我们有、上游没有: {', '.join(only_local)}")
    if not problems:
        print(f"对比上游 {ref}：节点文件集一致，{len(local_files)} 个 py")

    structural = []
    interpolation = []
    for name in upstream_files:
        if name not in local_files:
            continue
        source = _git(upstream, "show", f"{ref}:nodes/{name}")
        local = (NODES_DIR / name).read_text(encoding="utf-8")
        if source == local:
            continue
        if _normalized(source) != _normalized(local):
            structural.append(name)
        if _expressions(source) != _expressions(local):
            interpolation.append(name)

    unexpected = sorted(set(structural) - EXPECTED)
    if unexpected:
        problems += 1
        print("结构与上游不同（不在预期清单里）: " + ", ".join(unexpected))
    else:
        print(f"结构差异只在预期的文件里: {', '.join(sorted(structural)) or '无'}")

    unexpected = sorted(set(interpolation) - {"_single_copy.py"})
    if unexpected:
        problems += 1
        print("f-string 插值表达式与上游不同: " + ", ".join(unexpected))
    else:
        print("f-string 插值表达式与上游一致")

    print("对齐检查：" + ("有问题" if problems else "全部通过"))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
