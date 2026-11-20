# AusBoss 移植：版本记录与维护过程

这份文档记两件事：**这个来回动了什么**（版本对照表 + 过程记录），以及**下次怎么动**
（升级 SOP + 回归清单 + 排错）。讲原理的正文在 [10-ausboss-port.md](10-ausboss-port.md)，
这里只记事实与操作。

> 一句话现状：本包移植的是上游 `ComfyUI-AusBoss`，当前对齐 **v2.26.4（commit `9e9121a`）**，
> 55 个节点、界面与文档全中文、后端报错/日志全中文；下拉框**取值**保持英文（理由见第 6 条）。

---

## 1. 版本对照表

`PACK_VERSION` 不是装饰：前端 `shared/index.mjs` 的 `AUSBOSS_JS_VERSION` 和它比对，
后端 `/ausboss/pack_version` 也返回它，不一致时 `cache_guard` 会提示刷新缓存。
所以**每次跟上游升级必须三处一起改**（`ausboss/_version.py`、`web/ausboss/shared/index.mjs`、
`ausboss/zh/nodes.json` 的 `pack_version`，后者由构建脚本从提取数据带出来）。

| 我们 | 上游 tag | 上游 commit | 上游日期 | 关键变化 | 对应本仓提交 |
| --- | --- | --- | --- | --- | --- |
| 2.23.0 | v2.23.0 之后的 main | `6008d31` | 2026-11-11 | 首次整体搬运；含 Edit Lock / Edit Lock Restore / Text Lines / Prompt Variations / FlashVSR Upscale | `1ee8d4a` |
| 2.24.0 | v2.24.0 | `431941f` | 2026-11-12 | 仅版本元数据（`pyproject.toml` 版本/描述/keywords、`AUSBOSS_JS_VERSION`、CHANGELOG 标题、readme svg）；**代码零变化** | 见本文件所在提交 |
| 2.26.4 | v2.26.4 | `9e9121a` | 2026-11-17 | 121 个提交：新增 Load Image 节点（第 55 个）、App 模式、Clear VRAM、时间轴改「起点 / 时长 / 终点」三框、H3 Prompt Writer 大扩、前端缓存改启动期白名单、上传 4 GB 上限 | 见本文件所在提交 |

两个提交之间的完整差异（`git diff --stat 6008d31..431941f`）：

```
 CHANGELOG.md              | 2 +-
 assets/readme/release.svg | 6 +++---
 js/shared/index.mjs       | 2 +-
 pyproject.toml            | 5 +++--
 4 files changed, 8 insertions(+), 7 deletions(-)
```

### 1.1 与上游的等价性

忽略「字符串内容」后的 AST 比对结论（`ausboss/nodes/` 下 44 个 `node_*.py`、93 个 py 文件）：

| 结论 | 数值 |
| --- | --- |
| 上游节点文件 | 45 个 `node_*.py`，注册出 55 个节点（97 个 py 文件） |
| 我们的节点文件 | 45 个 `node_*.py`，注册出 55 个节点（文件集完全一致，无缺无多） |
| 逻辑结构不同的文件 | 3 个，均为有意修改：`_frontend_cache.py`（插件目录 + `web/ausboss`）、`_media_helpers.py`（版本改读 `_version.py`）、`_single_copy.py`（不依赖 pyproject 判断重复安装） |
| f-string 插值表达式 | 与上游一致（唯一例外是重写过的 `_single_copy.py`） |

核对已经脚本化，不用手抄 AST 片段：

```powershell
git clone https://github.com/ausboss/ComfyUI-AusBoss D:\src\ComfyUI-AusBoss
cd D:\src\ComfyUI-AusBoss && git fetch origin main

cd H:\~~~aki-v3.2\ComfyUI\custom_nodes\Feng
& 'H:\~~~aki-v3.2\python\python.exe' tools\check_ausboss_upstream.py D:\src\ComfyUI-AusBoss FETCH_HEAD
```

它报三行结论：节点文件集是否一致、结构差异是否只在预期的三个文件里、f-string 插值表达式是否一致。
第二个参数不传就用上游的 `HEAD`，刚 `fetch` 完还没切分支时传 `FETCH_HEAD` 或 tag 更稳。

下面是同一条判断的手写版本，留着说明原理（脚本对上时不必再跑）：

```bash
python3 - <<'PY'
import ast, subprocess, os
root="/workspace/github/ComfyUI-Feng/ausboss/nodes"
def norm(s):
    t=ast.parse(s)
    class N(ast.NodeTransformer):
        def visit_Constant(self,n):
            if isinstance(n.value,str): n.value="S"
            return n
        def visit_JoinedStr(self,n):
            self.generic_visit(n)
            if all(isinstance(v,ast.Constant) for v in n.values):
                return ast.copy_location(ast.Constant(value="S"),n)
            return n
    t=N().visit(t); ast.fix_missing_locations(t); return ast.dump(t)
up=[l.strip() for l in open("/tmp/up_nodes.txt")]
bad=[]
for f in up:
    if not f.endswith(".py"): continue
    a=subprocess.run(["git","-C","/tmp/ComfyUI-AusBoss","show",f"FETCH_HEAD:nodes/{f}"],capture_output=True,text=True).stdout
    b=open(os.path.join(root,f),encoding="utf-8").read()
    if norm(a)!=norm(b): bad.append(f)
print("结构不同的文件:",bad)   # 期望只剩 _frontend_cache / _media_helpers / _single_copy
PY
```

---

## 2. 过程记录（2026-11-12 这一轮到底做了什么）

顺序就是实际执行顺序，每步留下「为什么这么做」，方便日后判断哪些是关节、哪些可以重来。

### 2.1 勘察（决定怎么搬）

1. 上游结构：`nodes/` 93 个 py（44 个 `node_*.py` + 47 个 helpers + `_single_copy` / `_frontend_cache`）、
   `js/` 133 个模块、`js/docs/` 56 篇帮助、`example_workflows/` 4.1M、`assets/` 18M（readme gif）、
   `tests/` 4.8M。`assets` / `tests` / `scripts` / `.github` 不参与运行，**不搬**。
2. 节点数：`NODE_CLASS_MAPPINGS` 组件出来 **54 个**（从 `__init__.py` 的 44 个模块映射合并而来）。
3. 关键约束：上游是 **V1 写法**（`NODE_CLASS_MAPPINGS`），Feng 是 **V3 写法**（`comfy_entrypoint`）。
   ComfyUI 的 `nodes.py` 对同一个 `__init__.py` 只会走一条分支，**V1 优先并直接 return**，
   两者不能共存；官方也没有 V1 类 → V3 schema 的包装器。
4. 结论：**不重写 54 个 V3 schema**（手写零验证风险太高），改为从 V3 入口把上游两套映射
   注入 ComfyUI 的全局注册表。节点类本体仍是上游 V1 类，执行、校验、`object_info`、
   后端 23 条 `/ausboss/*` 路由全部走原路径。

### 2.2 落地搬运

1. `ausboss/nodes/`（整包照搬，保留相对 import）、`ausboss/locales/`、`ausboss/example_workflows/`、
   `ausboss/LICENSE`、`ausboss/CHANGELOG.md`。
2. `web/ausboss/`（上游 `js/` 全部）。**import 深度改写**：文件 URL 从 `/extensions/<插件>/<feature>/`
   变成 `/extensions/<插件>/ausboss/<feature>/`，所以出根的 `../../../scripts/app.js`（42 处）与
   `../../../scripts/api.js`（25 处）统一改成多一层 `../../../../scripts/`。
   复核：`grep -rn "[^./]\.\./\.\./\.\./scripts/" web/ausboss | wc -l` 必须为 0。
3. 三个文件必须改（其余原样）：
   - `_frontend_cache.py`：`PLUGIN_DIR` 上溯两级、`JS_DIR = PLUGIN_DIR/"web"/"ausboss"`、
     `EXTENSION_KEY = PLUGIN_DIR.name`（中间件 marker 要等于扩展 URL 段）；
   - `_single_copy.py`：不再读 pyproject，改为扫 `folder_paths.get_folder_paths("custom_nodes")`
     顶层找独立安装的 AusBoss，有则整体让位；
   - `_media_helpers.py`：`_pack_version()` 改读 `ausboss/_version.py`（本包没有自己的 pyproject）。
4. `ausboss/_version.py`：`PACK_VERSION` + `UPSTREAM_COMMIT`，给前端缓存校验与日后对照上游用。

### 2.3 V1 → V3 桥

`__init__.py` 末尾的 `_register_ausboss_nodes()`：

- 取 `.ausboss` 的 `NODE_CLASS_MAPPINGS` / `NODE_DISPLAY_NAME_MAPPINGS`；
- 取 ComfyUI 的注册表模块（`sys.modules["nodes"]`，退路 `comfy.nodes`）；
- **逐个 id 判重后写入**：用户另外装了独立 AusBoss 时以独立那份为准（它还有自己的前端与路由）；
  用 `if id in ...: continue` 而不是清空重建，保证函数可重入；
- 冷环境（`tools/check_*.py` 里没有注册表）静默返回；
- 成功后打印 `[Feng] 并入 AusBoss 节点 54 个（本包共 54 个）`。

这条路径在沙箱里用「伪造 `nodes` 注册表 + 伪造 `comfy_api` + 真正 exec `__init__.py`」验证过
（`tools/check_ausboss.py` 的加载检查就是照这个思路做的）。

### 2.4 汉化：分层与数据

**分层决定**（这一层最容易被后人改坏，先说清边界）：

| 层 | 翻不翻 | 为什么 |
| --- | --- | --- |
| 节点显示名、分类、描述、输出名 | 翻 | 纯展示 |
| 输入 socket 标签、tooltip | 翻（只改 `label`，**不改输入名**） | 输入名进 prompt JSON，改了老工作流全废 |
| 下拉框的**显示标签** | 不翻（保持英文 token） | 见第 6 条铁律 |
| 下拉框的**取值** | 不翻 | 同上 |
| 前端按钮/提示/菜单 | 翻 | — |
| 后端 `raise` / `print` / `logging` | 翻 | — |
| 节点帮助文档 `web/ausboss/docs/` | 翻 | 代码块、标识符、按钮名原样 |

**数据与生成链**：英文原文用桩环境跑真实 `cls.INPUT_TYPES()` 抽出来（不需要 torch/ComfyUI），
译文分批写成 JSON，最后由构建脚本合并成两份产物：

- `ausboss/zh/nodes.json`：`{categories, nodes:{id:{name, category, description, outputs, labels, tooltips}}, pack_version}` —— 后端 `localize.py` 读它 patch 类属性；
- `web/ausboss/zh_labels/labels.mjs`：`{节点id: {输入名: 中文标签}}` —— 前端 `zh_labels/index.js` 读它贴 socket 标签。
  用 `.mjs` 而不是 `.js`，是因为 `web/` 下**所有 `.js` 都会被当扩展加载**，数据文件不该被单独执行。

**量化（2.24.0 这一版）**：

| 项目 | 数量 |
| --- | --- |
| 节点 / 分类 | 54 / 8（兼容、图像、局部重绘、Krea2、加载、遮罩、实用工具、视频） |
| 输入标签 / tooltip / 输出名 | 365 / 358 / 140 |
| 前端界面字符串 | 1693 条候选，回填 1484 条（其余是枚举值、CSS 类名、节点 id，按规则保留） |
| 后端文案 | 157 处消息 + 82 处 f-string 模板 |
| 帮助文档 | 54 篇，共约 4100 行 |
| 规模 | `ausboss/` 7.6M（97 个 py、2.9 万行）、`web/ausboss/` 2.7M（135 个 js/mjs、4.6 万行）、帮助文档 4144 行 |

### 2.5 汉化过程中真踩到的坑（都已修在工具里）

1. **`apply` 跑了两遍** → 第二遍用旧偏移量在已经变长的文件上替换，写出垃圾。
   教训：回填是「一次性」操作，重来必须先 `git checkout` / 从上游重拷。
2. **acorn 的 `TemplateElement` 起止不含反引号** → 照普通字面量做 `start+1 / end-1`，每段吃掉两个字符，
   出现 `处笔迹s`、`上面t` 这类半截英文。
3. **嵌套模板串区间互相重叠** → 按 `start` 升序、`end` 降序，`start < reach` 的整条丢弃（只保留最外层）。
4. **译文里的引号/换行截断字面量** → `escapeInner()` 只转义定界符与换行，**不动反斜杠**
   （翻译里写的 `\n` 就是想要的）。
5. **Python 侧隐式拼接字面量**（`"...A "\n "B..."`）跨行 → 需要 `_concat_span()` 逐段吞引号凑够长度；
   并且回填前要把源码字面量还原成字符串值和译文比对，**不一致就跳过并打印「坐标对不上」**，
   宁可留英文也不写坏代码。
6. **f-string 的花括号被「保护」成 `{{x}}`** → 报错信息会原样打印 `{ALIGN_MODES}` 而不是变量值。
   一次性中了 **82 处**，全部改回单花括号；`_image_save_helpers.py:207` 那条正则
   `\d{{{COUNTER_WIDTH},}}` 是**唯一允许**保留双括号的地方。`check_fstrings` 现在会拦住复发。
7. **下拉框取值不能中文化**（见第 6 条）。

### 2.6 验证

`tools/check_ausboss.py` 在沙箱里能跑完整套（不需要 torch / numpy / PIL / ComfyUI）：

- 编译：101 个 py 全过 `py_compile`；
- 加载：桩环境走真实 import 路径 → 55 个节点、`failed_modules == []`；
- 中文数据：55 节点的名称/描述/输出/标签/提示都含中文（`IMAGE`、`VAE` 这类类型名豁免）；
- 覆盖率：对照提取到的英文原文，输入标签、下拉选项、输出数量都要齐；
- 汉化层行为：注入假节点，断言**选项仍是 `["inner","outer"]`**、描述/输出名/分类变中文、
  `SEARCH_ALIASES` 里有中文名、`run(mode="inner")` 照常返回；
- 前端：括号配平（能识别正则字面量）、相对 import 按**浏览器 URL 深度**解析（不是文件系统）、
  `labels.mjs` 的键都在 `nodes.json` 里；
- 文档：55 篇都存在且含中文；
- 版本：`_version.py` / `shared/index.mjs` / `nodes.json` 三处一致；
- f-string：源码里除那条正则外不得出现 `{{`。

`tools/check_js.py` 会**跳过 `web/ausboss/`**（它的简易括号扫描会被 `/[\\/:*?"<>|]/` 这类正则误报），
该目录由 `check_ausboss.py` 负责。两项分工写在两个脚本的注释里。

---

### 2.7 第二轮：对齐 v2.26.4（2026-11-20）

上游从 `431941f`（2.24.0）走到 `v2.26.4`（`9e9121a`）累计 121 个提交、164 个文件、+9313/−1261：
`nodes/` 35 个（5 新增、30 修改）、`js/` 63 个（9 新增、54 修改）、节点 54 → 55、帮助文档 54 → 55。
HEAD（`aaf3ae6`）后面还挂 8 个未发版提交，**这次只跟 tag**，未发版功能等下一个 tag。

1. **不整目录覆盖，改用三方合并**。base = `git archive 431941f nodes`、theirs = `git archive v2.26.4 nodes`，
   工作区文件当 ours，对每个文件跑 `git merge-file -p --marker-size=7 <ours> <base> <theirs>`：
   上游新逻辑进来，既有中文留在原地。新增文件直接 `cp`。
   冲突一共 14 处（js 12 个文件、py 2 个文件），**策略固定**：py 取上游逻辑 + 保留我们的中文措辞；
   js 一律取上游代码块（新英文串留给前端翻译管线），只有 import 冲突手工合成单条——
   初版把「我们的 import」和「上游新增 import」都留着，`input_preview/index.js` 与
   `shared/moment_strip.mjs` 因此报 `Identifier 'panelSwitch' has already been declared`。
2. **两个自定义文件重打补丁**：`_frontend_cache.py` 取上游后重新指定 `PLUGIN_DIR` / `JS_DIR` /
   `EXTENSION_KEY`（上游 2.26 新增的 `list_served_scripts()` 白名单要留着）；
   `_media_helpers.py` 三方合并 0 冲突，但上游重新用上了 `re`，我们早先删过 `import re`，必须补回。
3. **import 深度归一**：`web/ausboss/**` 出根 import 必须四级。用
   `re.sub(r"(?:\.\./)+scripts/", "../../../../scripts/", s)` 一次抹平；
   别用带后视的「恰好三级」正则，它会把四级路径从中间再匹配一次，越改越深。
4. **Python 报错文案**：上游改写的 55 条（含 58 条 f-string 模板）要重译。**唯一可靠的做法**是
   `copy.deepcopy` 整个 `Call` 节点 → 按「该常量前面有几个 `FormattedValue`」把译文分段写回
   `Constant.value` → `ast.unparse(new_node)` → 用它替换 `Call` 自己的源码区间。
   三种看似更轻的做法都崩过：直接拼 `f"..."`（表达式被换成空占位 → `f-string: empty expression not allowed`）、
   按「常量数 = 占位符数 + 1」硬对齐（首尾空片段没有对应常量，错位切碎别的字符串）、
   按字节 offset 裁切（`ast` 的 `col_offset` 是 **UTF-8 字节**偏移；隐式拼接的 f-string 里
   `JoinedStr` 的位置指向后一段，会把译文插进前一段中间）。
5. **前端文案**：`extract` 在当前树上只得到 536 条（多数已中文），按 CJK 切成纯英文 440 条 / 混排 96 条，
   440 条分 4 份并行翻译后 `apply` → 回填 194 条、其余 246 条按规则原样保留（CSS、class 串、枚举取值、
   节点名、格式 token），`node --input-type=module --check` 全过。
6. **帮助文档**：合并后 13 篇里夹着英文段，按批重译；新节点的 `AUSBOSS_NODES_LoadImage.md` 整篇新译。
7. **`locales/zh/nodeDefs.json`** 跟着上游覆盖成 54 条（它只是随包参考数据，不参与生成我们的中文）。
8. **三处版本号**（`_version.py`、`shared/index.mjs`、`nodes.json`）一起改到 2.26.4，`UPSTREAM_COMMIT` 记 `9e9121a`。

> ⚠️ 这一轮最大的事故：为了撤销一次失败的回填，跑 `git checkout -- ausboss/nodes`，
> 把**还没提交**的三方合并整个打回 HEAD（2.24 版），30 个文件的中文与新逻辑全没了。
> 恢复靠上面第 1 步的脚本重跑（结果与回滚前逐节点一致），代价是重译 62 条文案。
> **教训：未提交的合并不能被 `git checkout -- <dir>` 撤销；动手改这类目录前先
> `cp -a ausboss /tmp/ausboss_bak`。**

### 2.8 第三节：界面短标签清扫（同日收尾）

同步完成后又扫了一遍「一个词的英文标签」——前端文案管线按「纯英文且 ≥2 个英文词」过滤，单词类的按钮/分区名会漏掉。

- 扫法（一次性脚本，不进仓库）：用正则从 `createElement(…, "字面量")`、`addLabeledControl/addScrubField/sectionHeading`、`textContent = "…"`、`label: "…"` 里取第三种参数，排除含中文、含类名/选择器/`${}` 的，人工过一遍。
- 一共补翻约 110 处，集中在三块：
  - `web/ausboss/widget_cards/index.js` 的 70 个卡片行标签（`Target→目标`、`Budget→预算`、`Multiple→倍数`、`Filter→滤镜`、`Language→语言`…）；
  - `web/ausboss/shared/transform_editor.mjs` 的编辑器 chrome（`Reset→重置`、`Cancel→取消`、`Rotate→旋转`、`Preview→预览`、`Fill→填充色`、`Feather→羽化`、`Center→居中`、`Align→对齐`、`Resize→缩放`、`Step→步长`、`Method→方法`、`More→更多`、`Advanced→高级`、`Degrees→角度`、`Megapixels→百万像素`，以及 `Held/Ratio/Source/Custom` 四个状态字 → `保持/比例/原图/自定义`）；
  - 其余零散：`compare` 的 `Slide/Erase`、`input_preview` 的 `AUTO/MORE/FIND`、`touch_stage` 的 `Pick/Paint/Erase`、`workflow_note` 的 `File/Folder/Size/Note`、`save_image_naming` 的 `Counter/Date/Time/Size`、`seed_look`/`text_look` 的 `Look`、`stitch_seam` 的 `Seam`、`compare_erase_stage` 的 `Erase/Restore`。
- **故意保留英文**：`A`/`B`（比较图的两侧）、`linked`/`exact`（保存命名的模式标记，文档里也按这个字面写）、`AusBoss` 品牌、`off`/`on` 之类枚举键、`pad`/`resize`（几何函数入参）、`AusBoss: ` 日志前缀。
- 顺带把文档里与 JS 已经不一致的编辑器按钮名对齐（`AUSBOSS_NODES_ImageCropRotatePad.md`、`AUSBOSS_NODES_VideoCropRotatePadClip.md` 里的 `Open editor / Save & close / Reset crop / Reset view / Reset transform / Inpaint & Stitch → 打开编辑器 / 保存并关闭 / 重置裁剪 / 重置视图 / 重置变换 / 局部重绘与拼接`），并把 `Aspect ratio`/`Fit to ratio` 换成真实控件名「裁切比例」/「适配比例」。
- 每次改完都要 `node --input-type=module --check < 文件` 逐个过（本轮踩过两次：把 `addLabeledControl(section, "Fill", color)` 连带右括号一起替换，变成 `addLabeledControl(section, "填充色"), color);`，六个文件语法崩），最后统一跑 `python3 tools/check_all.py`。

---

## 3. 升级 SOP（上游发新版时照着做）

```powershell
# 0) 看有没有新东西（不需要 token，公开仓库）
cd D:\src
git clone https://github.com/ausboss/ComfyUI-AusBoss.git   # 或复用已有检出
cd ComfyUI-AusBoss
git fetch origin main
git log --oneline <上次的 UPSTREAM_COMMIT>..FETCH_HEAD
git diff --stat <上次的 UPSTREAM_COMMIT>..FETCH_HEAD
```

**先看 diff 再动手**：如果只改了 `pyproject.toml` / `js/shared/index.mjs` / `CHANGELOG.md` /
`assets/`（像 2.23.0 → 2.24.0 这次），那就只是版本号，**不必重新搬代码**，
直接跳到第 4 步改三处版本号即可。

有真正的代码变化时：

1. **只搬变的文件，并且用三方合并而不是覆盖**。`git diff --name-only` 出来的清单里，对每个改过的文件跑
   `git merge-file -p --marker-size=7 <本地> <base> <上游>`（base = 上次的 `UPSTREAM_COMMIT`，
   可用 `git archive <commit> nodes` 落成目录），新增文件直接 `cp`。别整目录 `cp -r`——
   会把我们改过的三处（`_frontend_cache` / `_media_helpers` / `_single_copy`）和全部中文冲掉。
   冲突按固定策略解：py 取上游逻辑 + 保留中文措辞；js 取上游代码块（英文串留给翻译管线），
   import 冲突手工合成单条（两边都留会 `Identifier '…' has already been declared`）。
   ⚠️ **动手前先 `cp -a ausboss /tmp/ausboss_bak`**：这些改动在提交前不受 git 保护。
2. **新文件补 import 深度**：新增的 `web/ausboss/**` 文件若 import `../../../scripts/*.js`，改成 `../../../../scripts/`。
3. **新节点 / 新选项要补中文**：
   ```powershell
   python tools\ausboss_zh_extract.py     # 抽出新的英文原文 → tools\_ausboss_extracted.json
   python tools\_ausboss_zh_batches.py    # 切任务 → tools\_zh_tasks\batch-*.json
   #   翻译后放进 tools\_zh_out\batch-*.json
   python tools\_ausboss_zh_build.py      # 合并 → ausboss\zh\nodes.json + web\ausboss\zh_labels\labels.mjs
   ```
   构建脚本会逐条校验：缺译文 / name 或 description 为空 / outputs 数量不符 / 同一节点内两个
   取值译成同一中文（会让回映射歧义）——**报错就修，不要绕过**。
4. **改三处版本号**：`ausboss/_version.py` 的 `PACK_VERSION` 与 `UPSTREAM_COMMIT`、
   `web/ausboss/shared/index.mjs` 的 `AUSBOSS_JS_VERSION`，再重跑第 3 步让 `nodes.json` 跟上。
5. **跑检查**，再在浏览器里 `Ctrl+F5` 看一眼新节点的名字与帮助卡。

前端文案（`web/ausboss` 里的按钮与提示）如果上游改了字，按 `docs/10` 第 4 节的
`extract` → 翻译 → `apply` → `check` 流程走一遍；**回填前不要手改源码**，否则偏移失效。
只补新增/变动的条目时，`extract` 之后按「不含中文 + 有 2 个以上英文词」筛出待译子集即可
（其余条目过滤器已经放过）。

Python 侧的报错/日志若被上游改写，别按行号硬替换：`copy.deepcopy` 整个 `Call`、
按 `FormattedValue` 分段写回 `Constant.value`、`ast.unparse` 后替换 `Call` 的源码区间（理由见 2.7 第 4 条）。

---

## 4. 常规回归（每次改完都要跑）

```powershell
cd H:\~~~aki-v3.2\ComfyUI\custom_nodes\Feng
& 'H:\~~~aki-v3.2\python\python.exe' tools\check_all.py
```

沙箱（无 ComfyUI 的机器）里 `check_load.py` 会打印「跳过：当前环境没有 ComfyUI」并返回 0，
这是预期行为；真机必须看到它跑完四项。

顺手可做的两条硬校验：

```bash
# 出根 import 深度没被改坏
grep -rn "[^./]\.\./\.\./\.\./scripts/" web/ausboss | wc -l        # 必须 0

# 中文没混进比较/存值
grep -rnE "(===|!==|\.includes\(|setValue\()[^;]*['\"][^'\"]*[\x{4e00}-\x{9fff}]" web/ausboss | wc -l   # 必须 0
```

---

## 5. 排错：界面上看不到这 55 个节点

按顺序查，别跳步：

1. **本机是不是旧代码** —— `git log --oneline -1` 要看得到移植提交；`ausboss\nodes\*.py` 应为 93 个。
2. **有没有重启 ComfyUI** —— 这是新增 Python 包，`Ctrl+F5` 不够，必须重启进程。
3. **启动日志里有没有这一行** —— `[Feng] 并入 AusBoss 节点 54 个（本包共 54 个）`。
   没有就说明 `ausboss/` 导入失败，往上找 `Traceback`；常见是某个上游模块缺 `av` / `cv2`，
   那种情况只会少几个节点，不会全没。
4. **不启动 ComfyUI 直接问工具** —— `python tools\check_ausboss.py`，它会明确报
   「加载 55 个节点」还是 `failed_modules: [...]`。
5. **节点在界面哪儿** —— 节点面板分类 `🆎 AusBoss/…`；搜索框输入 `🆎`、`ausboss` 或中文名都能命中
   （中文名同时追加进了 `SEARCH_ALIASES`）。
6. **用户另外装了独立 AusBoss** —— 我们的桥会让位给独立那份（同一 id 不覆盖），此时界面上的
   55 个节点来自独立安装，中文界面由独立安装自己的 locale 决定。

---

## 6. 不能碰的六条（改之前先读）

1. **下拉框取值保持英文**。`ausboss/nodes/*.py` 里的选项常量同时是 prompt JSON 的存值和
   `/ausboss/*` 路由入参，前后端各有几十处 `===` 比对（`input folder` / `local path` /
   `one per run` / `crop` / `start over`…）。要汉化只翻 `tooltip` 与 `label`。
2. **输入名（input key）不翻译**。它在 prompt JSON 里；中文只挂在 `input.label` / `widget.label` 上。
3. **`ausboss/nodes/` 不改业务逻辑**。要改文案走 `ausboss/zh/nodes.json` 或翻译工具；
   要改行为先确认上游是否已经改过，避免下次升级覆盖。
4. **`nodes.json` / `labels.mjs` 不手改**，都由 `tools/_ausboss_zh_build.py` 生成。
5. **`web/` 下不放只供 import 的 `.js`**（会被当扩展加载），数据文件用 `.mjs`。
6. **f-string 里不要出现 `{{x}}`**（唯一例外是 `_image_save_helpers.py:207` 的正则）。

---

## 7. 已知边界

- **汉化只到「文本」层**：上游前端里有少量文案是靠拼接/复数后缀拼出来的（`${n===1?"":"s"}`），
  中文里已去掉大部分后缀，个别位置可能出现「3 个节点」这种正常但生硬的读法；
  真要顺得重写句子结构，代价大于收益。
- **`ausboss/assets/`（18M readme gif）与 `tests/`（4.8M）没有搬**：不参与运行，
  需要时从上游单独取。
- **`ausboss/locales/zh/nodeDefs.json`**（上游自带 53 条中文）保留在包里作参考，
  **不参与**本包的汉化生成（我们自己覆盖 365 个输入，比上游的 321 个更全）。
- **沙箱没有 ComfyUI，也没有浏览器**：`check_load.py` 在沙箱会跳过；节点的实际渲染
  （中文标签是否贴到 socket 上、帮助卡是否展开正常）必须在真机浏览器里确认。
