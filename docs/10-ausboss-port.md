# 10 · 并入 AusBoss 节点包

`Feng` 里带了一套从上游 [ComfyUI-AusBoss](https://github.com/ausboss/ComfyUI-AusBoss)
搬来的 54 个节点，并做了完整汉化：节点名、分类、描述、输入提示（tooltip）、输出名、
下拉框的**显示文字**、前端面板里的按钮与提示、以及每篇节点帮助文档，全部是中文。

上游版本固定在 `2.23.0`（commit `6008d31`），记录在 `ausboss/_version.py`。

## 1. 目录

| 路径 | 是什么 |
| --- | --- |
| `ausboss/nodes/` | 上游的 93 个 Python 模块（43 个节点文件 + 47 个 helpers + 门禁/缓存工具） |
| `ausboss/__init__.py` | 把 44 个节点模块并成 `NODE_CLASS_MAPPINGS`，末尾调用汉化层 |
| `ausboss/zh/` | 汉化层：`localize.py`（改类属性）+ `nodes.json`（中文数据） |
| `web/ausboss/` | 上游 133 个前端模块与 54 篇帮助文档（`docs/`），已按 Feng 的 URL 深度改写 import |
| `web/ausboss/zh_labels/` | 前端贴中文输入标签的小扩展（`labels.mjs` + `index.js`） |
| `ausboss/locales/zh/` | 上游自带的中文 `nodeDefs.json`，仅作参考，不参与生成 |
| `ausboss/example_workflows/` | 上游示例工作流 |

## 2. 怎么并进 V3 插件而不重写节点

Feng 自己是 V3（`io.ComfyNode` + `comfy_entrypoint`），上游 54 个节点全是 V1
（`INPUT_TYPES` + `NODE_CLASS_MAPPINGS`）。ComfyUI 的 `nodes.py` 里，同一个包**不能同时**
声明 `NODE_CLASS_MAPPINGS` 和 `comfy_entrypoint`——V1 分支先命中就 `return`，V3 那套根本不跑。

所以走「注入全局映射」而不是「给 54 个节点手写 schema」：

1. `ausboss/__init__.py` 按普通 Python 包被 import，产出两套映射；
2. `Feng/__init__.py` 在模块末尾把这两套映射**写进 ComfyUI 的全局 `NODE_CLASS_MAPPINGS`**
   （`sys.modules["nodes"]` 或 `comfy.nodes`），并在已经存在同名节点时让位；
3. ComfyUI 随后照常遍历全局映射，走的还是它自己的 V1 执行路径。

好处：不复制节点实现、不改上游语义、`object_info` 与执行链路完全一致，上游升级时
`ausboss/nodes/` 整目录替换即可。代价：节点在 `object_info` 里出现的时机取决于插件加载顺序，
不影响使用（面板是加载完成后才拉的）。

如果机器上同时装了独立的 `ComfyUI-AusBoss`（`custom_nodes` 顶层有同名 `pyproject.toml`），
`ausboss/nodes/_single_copy.py` 会让本移植整体退出，避免路由重复注册把启动搞崩。

## 3. 汉化怎么做的

### 3.1 只翻「看得见」的字段

`ausboss/zh/localize.py` 在类定义好之后改这几样：`CATEGORY`、`DESCRIPTION`、
`RETURN_NAMES`、`INPUT_TYPES` 里每个输入的 `tooltip`、以及中文名追加进 `SEARCH_ALIASES`。

**输入名（input key）不翻**：它写进 prompt JSON，改了老工作流和 API 调用全部失效。
中文 socket 标签由前端 `web/ausboss/zh_labels/` 在节点创建/加载时贴上去，只改显示。

### 3.2 下拉框只翻显示文字，取值保持英文

这一点是硬约束。上游的取值（`one per run`、`input folder`、`frame index`…）同时被三处使用：

- 前端脚本里的 `===` 比较与 `switch`（如 `web/ausboss/image_folder/index.js`、
  `web/ausboss/shared/transform_editor.mjs`）；
- 后端的 23 条 `/ausboss/*` 路由入参（`request.query.get("source_mode", "input folder")`）；
- 已经保存的工作流 JSON。

真把值改成中文，会同时打断这三条。所以 `INPUT_TYPES` 的选项列表与默认值原样返回，
中文只出现在描述与 tooltip 里（正文提到取值时写中文标签，值本身仍是英文 token）。

### 3.3 数据文件

- `ausboss/zh/nodes.json`：`{categories, nodes:{id:{name, category, description, outputs, labels, tooltips}}}`；
- `web/ausboss/zh_labels/labels.mjs`：`{节点id: {输入名: 中文标签}}`。

两份都由脚本生成，**不要手改**（见下一节）。

## 4. 重新生成汉化数据

```powershell
cd H:\~~~aki-v3.2\ComfyUI\custom_nodes\Feng

# 1) 抽出上游的英文原文（桩环境加载，不需要 torch/ComfyUI）
python tools\ausboss_zh_extract.py            # → tools\_ausboss_extracted.json

# 2) 按 54 个节点切任务，翻译稿放 tools\_zh_out\batch-01..08.json
python tools\ausboss_zh_batches.py

# 3) 合并 → ausboss\zh\nodes.json + web\ausboss\zh_labels\labels.mjs（带一致性校验）
python tools\ausboss_zh_build.py

# 4) 前端界面文案：抽 → 译（tools\_js_out\part-*.json）→ 回填 → 复核
node tools\_ausboss_js_zh.mjs extract
node tools\_ausboss_js_zh.mjs apply
node tools\_ausboss_js_zh.mjs check

# 5) 报错/日志文案（raise / print / logging）
python tools\_ausboss_py_zh.py extract    # → tools\_py_zh\messages.json
python tools\_ausboss_py_zh.py apply      # 读 tools\_py_zh\zh.json
python tools\_ausboss_py_zh.py extract-f  # f-string 版本，译文放 zh-f.json
python tools\_ausboss_py_zh.py apply-f
```

第 4 步的 `apply` 用 `acorn` 解析 AST 后按「字面量内部区间」替换，所以：

- 只替换字符串内部，引号、模板串的 `${...}`、代码结构都不动；
- 模板串的静态片段（`TemplateElement`）整段替换，**不能像普通字面量那样去掉首尾字符**，
  否则会留下半个单词（早期版本正是这样写出 `处笔迹s`、`上面t`）；
- 嵌套模板串会抽出互相重叠的区间，`apply` 只保留最外层，内层计入「嵌套跳过」；
- 同一棵树**只能 apply 一次**：改完再 apply 会按旧偏移写坏文件，重来请先把
  `web/ausboss` 恢复成上游原样（`git checkout -- web/ausboss`，或从上游 clone 重拷），
  再改 import 深度、再 apply。

第 5 步靠 AST 定位 `raise`/`print`/`logging` 的字符串参数，按字节坐标写回；
插值占位符用 `⟦0⟧`、`⟦1⟧` 表示，回填时换回原表达式，语序可以按中文重排。

## 5. 自检

```powershell
& 'H:\~~~aki-v3.2\python\python.exe' tools\check_all.py
```

其中 `tools/check_ausboss.py` 覆盖：

| 检查 | 做什么 |
| --- | --- |
| 编译 | `ausboss/**/*.py` 全部 `py_compile` |
| 加载 | 用 `tools/_ausboss_stub.py` 顶替 torch/numpy/PIL，走真实 import 路径取 54 个节点 |
| 中文数据 | 每个节点的名称/描述/输出/标签/提示都含中文（`IMAGE`、`VAE` 这类类型名豁免） |
| 覆盖率 | 对照 `tools/_ausboss_extracted.json` 的英文原文，确认输入标签、下拉选项、输出数量都齐 |
| 汉化层行为 | 注入假节点，断言选项**仍是英文**、描述/输出名/分类变成中文、执行入口没被改坏 |
| 前端 | 括号配平、相对 import 按浏览器 URL 深度解析、`labels.mjs` 的键都在 `nodes.json` 里 |
| 帮助文档 | 54 篇 md 都存在且含中文 |
| 版本 | `_version.py`、`shared/index.mjs`、`nodes.json` 三处版本号一致 |

`web/ausboss/**` 由这个脚本负责，`tools/check_js.py` 会跳过该目录（它的简易括号扫描
会被 `/[\\/:*?"<>|]/` 这类正则误报）。

## 6. 跟着上游升级

```powershell
git clone https://github.com/ausboss/ComfyUI-AusBoss /tmp/ausboss
# 对比 /tmp/ausboss 与本地的差异，按下面的规则搬：
```

1. `ausboss/nodes/`、`web/ausboss/`（除 `zh_labels/`）整目录替换；
2. 重新跑一遍 import 深度改写（`web/ausboss` 比上游多一层，`../../../scripts/` → `../../../../scripts/`）：
   `grep -rl '\.\./\.\./\.\./scripts/' web/ausboss | xargs sed -i 's|\.\./\.\./\.\./scripts/|../../../../scripts/|g'`
3. 更新 `ausboss/_version.py` 的 `PACK_VERSION`/`UPSTREAM_COMMIT` 与
   `web/ausboss/shared/index.mjs` 的 `AUSBOSS_JS_VERSION`（`check_ausboss.py` 会比对）；
4. 重新生成汉化数据（第 4 节整条链），新增节点会以英文名出现在校验报告里。

## 7. 已知边界

- 需要上游的可选依赖才有对应功能：LaMa 要 `models/lama/big-lama.pt`，
  FlashVSR / RAFT / SAM 3 需要各自的权重；缺权重时节点会直接报错，这是上游行为。
- 前端面板的文案由 `web/ausboss/**` 内联，Feng 没做二次抽象；上游改了措辞，
  中文要跟着重跑第 4 步。
- 移植包不带上游的 `assets/`、`tests/`、`scripts/`（体积 20M+，运行不需要）。
