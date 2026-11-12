// AusBoss 前端文案的提取与回填。
//
//   node tools/_ausboss_js_zh.mjs extract      # web/ausboss 下所有 .js/.mjs → tools/_js_tasks/tasks.json
//   node tools/_ausboss_js_zh.mjs apply        # tools/_js_out/*.json → 就地替换回源文件
//   node tools/_ausboss_js_zh.mjs check        # 统计还剩多少英文界面文案
//
// 为什么用 AST 而不是正则：这个包里字符串与代码混得很紧（拼接、模板串、对象字面量键），
// 正则会误伤属性名与 import 路径。acorn 只装在构建机的 /tmp 里，不进插件、不是运行依赖。

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let acorn;
try {
  acorn = require("/tmp/jsbuild/node_modules/acorn");
} catch (_error) {
  acorn = require("acorn");
}

const ROOT = path.resolve(import.meta.dirname, "..");
const WEB = path.join(ROOT, "web", "ausboss");
const TASKS_DIR = path.join(ROOT, "tools", "_js_tasks");
const OUT_DIR = path.join(ROOT, "tools", "_js_out");

const SKIP_DIRS = new Set(["docs", "zh_labels"]);

// 这些不是给用户看的：路径、URL、选择器、事件名、node id、模型/文件后缀、单位符号等
const NOT_UI = [
  /^(?:\.{1,2}\/|\/|https?:|data:|blob:)/,
  /^[.#][\w-]+$/,                       // CSS 选择器
  /^[a-z]+(?:_[a-z]+)*$/,               // 下划线小写标识符
  /^[A-Z][A-Z0-9_]{2,}$/,               // 常量名
  /AUSBOSS_/,
  /\.(?:mjs|js|json|md|png|jpe?g|webp|gif|mp4|safetensors|pt|css|html)$/,
  /^[\w-]+$/,                           // 单个词：多半是键或标识符
  /^[\s:;,.\-_/\\|]*$/,                 // 纯符号
  /[{}]/,                               // CSS 规则块、模板占位、JSON 片段
  /<[a-z!/]/i,                          // HTML 片段
  /(?:^|[;{])\s*[a-z-]+\s*:\s*[^;{}]+;/i, // CSS 声明（display:none; 之类）
  /^(?:px|em|rem|ms|s|%|kb|mb|gb)$/i,
];

function looksLikeUI(text) {
  const value = text.trim();
  if (value.length < 2) return false;
  if (NOT_UI.some((re) => re.test(value))) return false;
  // 至少两个英文单词，或者以句读结尾，或者含中文（已经是译文）
  const words = value.split(/\s+/).filter((w) => /[A-Za-z]{2,}/.test(w));
  if (words.length >= 2) return true;
  return /[.!?]$/.test(value) && words.length >= 1;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
      continue;
    }
    if (/\.(?:js|mjs)$/.test(entry.name)) out.push(path.join(dir, entry.name));
  }
  return out;
}

function parseFile(file) {
  const source = fs.readFileSync(file, "utf8");
  const ast = acorn.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true,
  });
  return { source, ast };
}

// 收集所有字符串字面量与模板串片段，带上「是不是对象键 / import 路径」这类上下文
function collectStrings(file) {
  const { source, ast } = parseFile(file);
  const found = [];
  const keyNodes = new Set();

  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "Property" && !node.computed && node.key.type === "Literal") {
      keyNodes.add(node.key);
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === "string") visit(child);
    }
  };
  visit(ast);

  const consider = (node, text, kind) => {
    if (keyNodes.has(node)) return;
    if (!looksLikeUI(text)) return;
    const lineStart = source.lastIndexOf("\n", node.start) + 1;
    const lineEnd = source.indexOf("\n", node.end);
    found.push({
      context: source
        .slice(lineStart, lineEnd === -1 ? source.length : lineEnd)
        .trim()
        .slice(0, 200),
      start: node.start,
      end: node.end,
      line: node.loc.start.line,
      kind,
      text,
      // 模板串里的 ${...} 必须原样保留，翻译时只动外面的字
      hasHoles: kind === "template" && text.includes("${"),
    });
  };

  const walkNode = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "Literal" && typeof node.value === "string") {
      consider(node, node.value, "literal");
    } else if (node.type === "TemplateElement") {
      consider(node, node.value.cooked ?? node.value.raw, "template");
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(walkNode);
      else if (child && typeof child.type === "string") walkNode(child);
    }
  };
  walkNode(ast);
  return { source, found };
}

function commandExtract() {
  fs.mkdirSync(TASKS_DIR, { recursive: true });
  const files = walk(WEB);
  const tasks = [];
  let total = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const { found } = collectStrings(file);
    if (!found.length) continue;
    for (const item of found) {
      item.file = rel;
      item.id = `${rel}#${item.line}:${item.start}`;
    }
    tasks.push(...found);
    total += found.length;
  }
  fs.writeFileSync(
    path.join(TASKS_DIR, "tasks.json"),
    JSON.stringify(tasks, null, 1),
    "utf8",
  );

  // 按文件数分成 8 份任务文件，方便并行翻译
  const byFile = new Map();
  for (const item of tasks) {
    if (!byFile.has(item.file)) byFile.set(item.file, []);
    byFile.get(item.file).push(item);
  }
  const buckets = Array.from({ length: 8 }, () => []);
  const weight = Array.from({ length: 8 }, () => 0);
  [...byFile.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .forEach(([file, items]) => {
      let target = 0;
      for (let i = 1; i < weight.length; i += 1) if (weight[i] < weight[target]) target = i;
      buckets[target].push({ file, items });
      weight[target] += items.length;
    });
  buckets.forEach((bucket, index) => {
    const name = `part-${String(index + 1).padStart(2, "0")}.json`;
    fs.writeFileSync(
      path.join(TASKS_DIR, name),
      JSON.stringify({ files: bucket }, null, 1),
      "utf8",
    );
  });
  console.log(`文件 ${files.length} 个，待译字符串 ${total} 条，任务分 ${buckets.length} 份`);
}

// 译文是纯文本：里面出现的引号与换行会截断/撑爆所在的字面量，落盘前按定界符转义。
// 反斜杠不动：翻译里写的 \n 这类转义本来就是想要的。
function escapeInner(text, quote) {
  let out = text.replace(/\r?\n/g, "\\n");
  if (quote === '"') out = out.replace(/"/g, '\\"');
  if (quote === "'") out = out.replace(/'/g, "\\'");
  if (quote === "`") out = out.replace(/`/g, "\\`");
  return out.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function commandApply() {
  if (!fs.existsSync(OUT_DIR)) {
    console.error("没有 tools/_js_out，先翻译");
    return;
  }
  const translations = new Map();
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (!name.endsWith(".json")) continue;
    const data = JSON.parse(fs.readFileSync(path.join(OUT_DIR, name), "utf8"));
    for (const entry of data.strings || []) {
      if (!entry.id || !entry.zh) continue;
      translations.set(entry.id, entry.zh);
    }
  }
  console.log(`载入译文 ${translations.size} 条`);

  const tasks = JSON.parse(fs.readFileSync(path.join(TASKS_DIR, "tasks.json"), "utf8"));
  const byFile = new Map();
  for (const item of tasks) {
    if (!byFile.has(item.file)) byFile.set(item.file, []);
    byFile.get(item.file).push(item);
  }

  let applied = 0;
  let missing = 0;
  let nested = 0;
  for (const [rel, items] of byFile) {
    const abs = path.join(ROOT, rel.split("/").join(path.sep));
    const { source } = parseFile(abs);
    const edits = [];
    for (const item of items) {
      const zh = translations.get(item.id);
      if (!zh || zh === item.text) {
        if (!zh) missing += 1;
        continue;
      }
      // 只替换字面量内部的字符，引号与 ${} 之外的结构一律不动
      const raw = source.slice(item.start, item.end);
      const quote = raw[0];
      if (item.kind === "literal") {
        if (quote !== '"' && quote !== "'") {
          console.warn(`跳过无法识别的字面量：${item.id} ${raw.slice(0, 20)}`);
          continue;
        }
        edits.push({ start: item.start + 1, end: item.end - 1, text: escapeInner(zh, quote) });
      } else {
        // 模板串的一个静态片段（acorn 的 TemplateElement 不含反引号与 ${}）：
        // 整段替换，不能像普通字面量那样去掉首尾字符，否则会留下半个单词。
        if (zh.includes("${")) {
          console.warn(`模板串片段译文里出现 \${} 会变成插值，跳过：${item.id}`);
          continue;
        }
        edits.push({ start: item.start, end: item.end, text: escapeInner(zh, "`") });
      }
      applied += 1;
    }
    if (!edits.length) continue;
    // 嵌套模板串会抽出相互重叠的条目（外层模板的整段 vs 内层模板的片段）：
    // 只保留最外层，否则内层的替换会落在被外层改过的位置，写出半截英文。
    edits.sort((a, b) => a.start - b.start || b.end - a.end);
    const kept = [];
    let reach = -1;
    for (const edit of edits) {
      if (edit.start < reach) {
        nested += 1;
        continue;
      }
      kept.push(edit);
      reach = edit.end;
    }
    edits.length = 0;
    edits.push(...kept.sort((a, b) => b.start - a.start));
    let next = source;
    for (const edit of edits) {
      next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
    }
    fs.writeFileSync(abs, next, "utf8");
  }
  console.log(`回填 ${applied} 条，未翻译 ${missing} 条，嵌套跳过 ${nested} 条`);
}

function commandCheck() {
  const files = walk(WEB);
  let remaining = 0;
  const perFile = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const { found } = collectStrings(file);
    if (found.length) perFile.push({ file: rel, count: found.length });
    remaining += found.length;
  }
  perFile.sort((a, b) => b.count - a.count);
  if (process.argv[3] === "--list") {
    for (const row of perFile) {
      const { found } = collectStrings(path.join(ROOT, row.file.split("/").join(path.sep)));
      for (const item of found) {
        console.log(`${row.file}:${item.line}\t${item.kind}\t${JSON.stringify(item.text).slice(0, 120)}`);
      }
    }
  }
  console.log(`剩余疑似英文界面文案 ${remaining} 条`);
  for (const row of perFile.slice(0, 15)) console.log(`  ${row.count}\t${row.file}`);
}

const command = process.argv[2] || "extract";
if (command === "extract") commandExtract();
else if (command === "apply") commandApply();
else if (command === "check") commandCheck();
else console.error(`未知命令：${command}`);
