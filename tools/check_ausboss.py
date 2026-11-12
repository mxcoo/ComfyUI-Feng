"""AusBoss 移植包的体检：编译、加载、汉化覆盖、汉化层行为、前端静态检查。

用法：
    python3 tools/check_ausboss.py           # 全部检查
    python3 tools/check_ausboss.py --quiet   # 只报失败

它在没有 torch / ComfyUI 的环境里也要能跑：节点模块靠 tools/_ausboss_stub.py 顶替依赖。
"""

from __future__ import annotations

import argparse
import json
import py_compile
import re
import sys
import traceback
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

TOOLS_DIR = Path(__file__).resolve().parent
PLUGIN_DIR = TOOLS_DIR.parent
PACK_DIR = PLUGIN_DIR / "ausboss"
WEB_PACK_DIR = PLUGIN_DIR / "web" / "ausboss"
ZH_JSON = PACK_DIR / "zh" / "nodes.json"
EXTRACTED_JSON = TOOLS_DIR / "_ausboss_extracted.json"

CJK = re.compile(r"[\u4e00-\u9fff]")

# 这些标签保持英文更清楚：用户在所有插件里看到的都是它们。
TECH_ONLY = {
    "AUDIO",
    "CLIP",
    "FLOAT",
    "IMAGE",
    "INT",
    "Latent",
    "MASK",
    "MODEL",
    "SEED",
    "STRING",
    "VAE",
    "VIDEO",
    "fps",
}


class Report:
    def __init__(self) -> None:
        self.fails: list[str] = []
        self.notes: list[str] = []

    def fail(self, message: str) -> None:
        self.fails.append(message)

    def note(self, message: str) -> None:
        self.notes.append(message)


def _has_chinese(text: str) -> bool:
    return bool(CJK.search(text or ""))


# ---------------------------------------------------------------- 编译与加载


def check_compile(report: Report) -> None:
    files = sorted(PACK_DIR.rglob("*.py"))
    if not files:
        report.fail("ausboss/ 下没有 Python 文件")
        return
    target = TOOLS_DIR / "_check_compile.pyc"
    for path in files:
        try:
            py_compile.compile(str(path), doraise=True, cfile=str(target))
        except py_compile.PyCompileError as error:
            report.fail(f"编译失败 {path.relative_to(PLUGIN_DIR)}: {error.msg.splitlines()[0]}")
    target.unlink(missing_ok=True)
    report.note(f"编译 {len(files)} 个 Python 文件")


def _load_package(report: Report):
    sys.path.insert(0, str(TOOLS_DIR))
    try:
        import _ausboss_stub  # noqa: PLC0415  运行期才装桩，避免影响其它检查

        _ausboss_stub.install()
        package = _ausboss_stub.load_package(str(PLUGIN_DIR), "Feng")
    except Exception:
        report.fail(f"加载 ausboss 包失败\n{traceback.format_exc()}")
        package = None
    finally:
        sys.path.pop(0)
    return package


def check_load(report: Report, package) -> dict:
    if package is None:
        return {}
    classes = dict(getattr(package, "NODE_CLASS_MAPPINGS", {}) or {})
    failed = list(getattr(package, "failed_modules", []) or [])
    if failed:
        report.fail(f"{len(failed)} 个模块加载失败: {', '.join(failed)}")
    if not classes:
        report.fail("没有拿到任何节点")
    report.note(f"加载 {len(classes)} 个节点")
    return classes


# ---------------------------------------------------------------- 汉化数据


def check_zh_data(report: Report, classes: dict) -> dict:
    if not ZH_JSON.is_file():
        report.fail("缺少 ausboss/zh/nodes.json（跑 tools/_ausboss_zh_build.py 生成）")
        return {}
    data = json.loads(ZH_JSON.read_text(encoding="utf-8"))
    nodes = data.get("nodes") or {}
    categories = data.get("categories") or {}

    missing = sorted(set(classes) - set(nodes))
    if missing:
        report.fail(f"这些节点没有中文数据: {', '.join(missing)}")

    for node_id in classes:
        entry = nodes.get(node_id)
        if not entry:
            continue
        for field in ("name", "description"):
            text = (entry.get(field) or "").strip()
            if not text:
                report.fail(f"{node_id}: {field} 是空的")
            elif not _has_chinese(text):
                report.fail(f"{node_id}: {field} 没有中文 —— {text[:40]}")
        for index, text in enumerate(entry.get("outputs") or []):
            if text in TECH_ONLY:
                continue
            if not _has_chinese(text):
                report.fail(f"{node_id}: 第 {index} 个输出名没有中文 —— {text!r}")
        for name, label in (entry.get("labels") or {}).items():
            if label in TECH_ONLY:
                continue
            if not _has_chinese(label):
                report.fail(f"{node_id}.{name}: 标签没有中文 —— {label!r}")
        for name, tip in (entry.get("tooltips") or {}).items():
            if not _has_chinese(tip):
                report.fail(f"{node_id}.{name}: 提示没有中文 —— {tip!r}")
        for token, label in (entry.get("options") or {}).items():
            if not (label or "").strip():
                report.fail(f"{node_id}: 选项 {token!r} 的标签是空的")

    for english, category in categories.items():
        if english == category:
            continue  # 纯品牌名（AusBoss/Krea2）本来就不用翻
        if not _has_chinese(category):
            report.fail(f"分类没有中文: {english!r} → {category!r}")

    report.note(f"中文数据 {len(nodes)} 个节点、{len(categories)} 个分类")
    return data


def check_zh_coverage(report: Report, data: dict, extracted: dict) -> None:
    """拿英文原文逐节点比对：输入标签、下拉选项、输出数量。"""
    nodes = data.get("nodes") or {}
    for node_id, source in extracted.items():
        entry = nodes.get(node_id)
        if not entry:
            report.fail(f"{node_id}: 中文数据里没有这个节点")
            continue
        labels = entry.get("labels") or {}
        options = entry.get("options") or {}
        outputs = entry.get("outputs") or []
        return_names = source.get("return_names") or []
        if len(outputs) != len(return_names):
            report.fail(f"{node_id}: 中文输出 {len(outputs)} 个，英文 {len(return_names)} 个")
        for name, record in (source.get("inputs") or {}).items():
            if name not in labels:
                report.fail(f"{node_id}.{name}: 缺中文标签")
            for token in record.get("options") or []:
                if token not in options:
                    report.fail(f"{node_id}.{name}: 选项 {token!r} 缺中文标签")
    report.note(f"中文覆盖 {len(extracted)} 个节点的输入与选项")


# ---------------------------------------------------------------- 运行时行为


def check_runtime(report: Report) -> None:
    """构造一个假节点，验证汉化层只动展示字段：描述/输出名/分类/别名变中文，选项取值不动。"""
    from Feng.ausboss.zh import localize as zh_localize  # noqa: PLC0415

    class Fake:
        CATEGORY = "🆎 AusBoss/Test"
        DESCRIPTION = "English description."
        FUNCTION = "run"
        RETURN_TYPES = ("STRING",)
        RETURN_NAMES = ("value",)

        @classmethod
        def INPUT_TYPES(cls):
            return {
                "required": {
                    "mode": (["inner", "outer"], {"tooltip": "Pick a mode."}),
                }
            }

        def run(self, mode):
            return (mode,)

    mappings = {"FENG_CHECK_FAKE": Fake}
    display = {"FENG_CHECK_FAKE": "Fake"}

    backup = ZH_JSON.read_text(encoding="utf-8")
    payload = json.loads(backup)
    payload.setdefault("nodes", {})["FENG_CHECK_FAKE"] = {
        "name": "假节点",
        "category": "🆎 AusBoss/测试",
        "description": "中文描述。",
        "outputs": ["取值"],
        "labels": {"mode": "模式"},
        "tooltips": {"mode": "选一个模式。"},
        "options": {"inner": "内圈", "outer": "外圈"},
    }
    payload.setdefault("categories", {})["🆎 AusBoss/Test"] = "🆎 AusBoss/测试"
    payload.setdefault("strings", {})["English description."] = "中文描述。"
    ZH_JSON.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    try:
        zh_localize._data = None  # 丢掉加载时读进内存的旧数据，改读刚写进去的
        zh_localize.localize_nodes(mappings, display)

        options = list(Fake.INPUT_TYPES()["required"]["mode"][0])
        # 下拉取值必须保持英文：它既写进 prompt JSON，也被前端脚本与后端路由拿去比较
        if options != ["inner", "outer"]:
            report.fail(f"下拉取值被改动了，会毁掉老工作流与前端判断: {options!r}")
        size = Fake.INPUT_TYPES()["required"]["mode"][1]
        if size.get("tooltip") != "选一个模式。":
            report.fail(f"tooltip 没换: {size.get('tooltip')!r}")
        if Fake.DESCRIPTION != "中文描述。":
            report.fail(f"描述没换: {Fake.DESCRIPTION!r}")
        if Fake.RETURN_NAMES != ("取值",):
            report.fail(f"输出名没换: {Fake.RETURN_NAMES!r}")
        if display["FENG_CHECK_FAKE"] != "假节点":
            report.fail(f"显示名没换: {display['FENG_CHECK_FAKE']!r}")
        if not _has_chinese(Fake.CATEGORY):
            report.fail(f"分类没换: {Fake.CATEGORY!r}")
        if "假节点" not in (Fake.SEARCH_ALIASES or []):
            report.fail("中文名没有进 SEARCH_ALIASES，中文搜索不到")

        node = Fake()
        if node.run(mode="inner") != ("inner",):
            report.fail(f"执行入口被改坏了: {node.run(mode='inner')!r}")
    except Exception:
        report.fail(f"汉化层行为检查抛异常\n{traceback.format_exc()}")
    finally:
        ZH_JSON.write_text(backup, encoding="utf-8")
    report.note("汉化层行为（展示字段中文、下拉取值保持英文）")


# ---------------------------------------------------------------- 前端静态


def _starts_regex(text: str, index: int, prev: str) -> bool:
    """判断这个 `/` 是正则开头还是除号。

    只看前一个字符不够：`return /^"?.../` 里的 `/` 前面是关键字，照样是正则。
    """
    if prev == "" or prev in "(,=:[!&|?{};+-*%~^<>":
        return True
    window = text[max(0, index - 24) : index]
    return bool(
        re.search(
            r"(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)\s*$",
            window,
        )
    )


def _strip_js(text: str) -> str:
    """去掉注释、字符串与正则字面量，只留结构字符，用来配平括号。

    正则字面量必须单独处理：里面的 `/` 与引号（如 `/[\\/:*?"<>|]/`）否则会被当成
    除号或字符串开头，导致后面的结构字符全部错位。
    """
    out: list[str] = []
    i = 0
    length = len(text)
    prev = ""  # 上一个结构字符：判 `/` 是除号还是正则开头
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
                i += 1
            prev = quote
        elif ch == "/" and _starts_regex(text, i, prev):
            i += 1
            in_class = False
            while i < length:
                current = text[i]
                if current == "\\":
                    i += 2
                    continue
                if current == "[":
                    in_class = True
                elif current == "]":
                    in_class = False
                elif current == "/" and not in_class:
                    i += 1
                    break
                elif current == "\n":
                    break
                i += 1
            while i < length and (text[i].isalnum() or text[i] == "_"):
                i += 1
            prev = "/"
        else:
            out.append(ch)
            if not ch.isspace():
                prev = ch
            i += 1
    return "".join(out)


def _url_segments(path: Path) -> list[str]:
    """扩展脚本在浏览器里的 URL 段（相对站点根）。"""
    segments = ["extensions", PLUGIN_DIR.name]
    segments.append("ausboss")
    segments.extend(path.parent.relative_to(WEB_PACK_DIR).parts)
    return list(segments)


def _resolve_import(path: Path, target: str) -> str | None:
    """按浏览器 URL 语义解析相对 import，返回问题说明或 None。

    直接 `path.parent / target` 是错的：`../../../../scripts/app.js` 在文件系统上
    指向插件之外，在浏览器里指向前端自己的 `scripts/`，本地没有前端包，只能跳过。
    也正因为如此，只有解析结果仍落在 `/extensions/<插件目录名>/` 之下时才能校验。
    """
    base = ["extensions", PLUGIN_DIR.name]
    segments = _url_segments(path)
    for piece in target.split("/"):
        if piece in ("", "."):
            continue
        if piece == "..":
            if not segments:
                return None
            segments.pop()
            continue
        segments.append(piece)
    if segments[: len(base)] != base or len(segments) <= len(base):
        return None
    if not (PLUGIN_DIR / "web" / Path(*segments[len(base) :])).is_file():
        return f"import 指向不存在的文件 {target}"
    return None


def check_frontend(report: Report, data: dict) -> None:
    files = [
        path
        for path in sorted(WEB_PACK_DIR.rglob("*"))
        if path.suffix in {".js", ".mjs"} and path.is_file()
    ]
    if not files:
        report.fail("web/ausboss 下没有前端文件")
        return

    for path in files:
        text = path.read_text(encoding="utf-8")
        code = _strip_js(text)
        for open_ch, close_ch in (("{", "}"), ("(", ")"), ("[", "]")):
            if code.count(open_ch) != code.count(close_ch):
                report.fail(f"{path.relative_to(WEB_PACK_DIR)}: {open_ch}{close_ch} 不配平")
        for match in re.finditer(r"""from\s+["']([^"']+)["']""", text):
            target = match.group(1)
            if not target.startswith("."):
                continue
            problem = _resolve_import(path, target)
            if problem:
                report.fail(f"{path.relative_to(WEB_PACK_DIR)}: {problem}")

    labels_js = WEB_PACK_DIR / "zh_labels" / "labels.mjs"
    if not labels_js.is_file():
        report.fail("缺少 web/ausboss/zh_labels/labels.mjs")
    else:
        text = labels_js.read_text(encoding="utf-8")
        keys = set(re.findall(r'"((?:AUSBOSS_NODES_|Feng)[A-Za-z0-9_]*)"', text))
        keys |= set(re.findall(r'"(SimpleWatermarkRemover)"', text))
        unknown = sorted(keys - set(data.get("nodes") or {}))
        if unknown:
            report.fail(f"labels.mjs 里有数据里不存在的节点: {', '.join(unknown)}")

    report.note(f"前端 {len(files)} 个文件")


def check_docs(report: Report, data: dict) -> None:
    docs_dir = WEB_PACK_DIR / "docs"
    docs = sorted(docs_dir.glob("*.md")) if docs_dir.is_dir() else []
    if not docs:
        report.fail("缺少 web/ausboss/docs 帮助文档")
        return
    names = {path.stem for path in docs}
    missing = sorted(set(data.get("nodes") or {}) - names)
    if missing:
        report.fail(f"这些节点没有帮助文档: {', '.join(missing)}")
    english = [path.name for path in docs if not _has_chinese(path.read_text(encoding="utf-8"))]
    if english:
        report.fail(f"这些帮助文档还没有中文: {', '.join(english[:8])}")
    report.note(f"帮助文档 {len(docs)} 篇")


def check_version(report: Report, data: dict) -> None:
    version_file = PACK_DIR / "_version.py"
    pack_version = ""
    match = re.search(r'PACK_VERSION\s*=\s*"([^"]+)"', version_file.read_text(encoding="utf-8"))
    if match:
        pack_version = match.group(1)
    shared = (WEB_PACK_DIR / "shared" / "index.mjs").read_text(encoding="utf-8")
    js_match = re.search(r'AUSBOSS_JS_VERSION\s*=\s*"([^"]+)"', shared)
    if js_match and pack_version and js_match.group(1) != pack_version:
        report.fail(f"前后端版本号不一致: _version.py {pack_version} / index.mjs {js_match.group(1)}")
    zh_version = data.get("pack_version")
    if zh_version and pack_version and zh_version != pack_version:
        report.fail(f"汉化数据来自 v{zh_version}，代码是 v{pack_version}，需要重跑提取")
    report.note(f"版本 {pack_version or '未知'}")


# ---------------------------------------------------------------- 入口


def main() -> int:
    parser = argparse.ArgumentParser(description="AusBoss 移植包体检")
    parser.add_argument("--quiet", action="store_true", help="只输出问题")
    args = parser.parse_args()

    report = Report()
    check_compile(report)
    package = _load_package(report)
    classes = check_load(report, package)
    data = check_zh_data(report, classes) if classes else {}

    extracted: dict = {}
    if EXTRACTED_JSON.is_file():
        extracted = json.loads(EXTRACTED_JSON.read_text(encoding="utf-8")).get("nodes") or {}
    else:
        report.fail("缺少 tools/_ausboss_extracted.json（跑 tools/ausboss_zh_extract.py 生成）")

    if classes and data:
        if extracted:
            check_zh_coverage(report, data, extracted)
        check_frontend(report, data)
        check_docs(report, data)
        check_version(report, data)
        sys.path.insert(0, str(TOOLS_DIR))
        try:
            check_runtime(report)
        except Exception:
            report.fail(f"行为检查无法运行\n{traceback.format_exc()}")
        finally:
            sys.path.pop(0)

    if report.fails:
        print(f"AusBoss 移植包：{len(report.fails)} 个问题")
        for line in report.fails:
            print(f"  ✗ {line}")
    else:
        print("AusBoss 移植包：全部通过")
    if not args.quiet:
        for line in report.notes:
            print(f"  · {line}")
    return 1 if report.fails else 0


if __name__ == "__main__":
    sys.exit(main())
