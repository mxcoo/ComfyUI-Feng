# 08 · 「多功能提示词预设」节点

这个节点是本插件的主体功能：在节点里直接点选风格缩略图，后端把选中的片段合并成一对正负提示词。
交互参考了 GJJ_Nodes 的 `GJJ_PromptPresetStudio`，但数据完全走本地 JSON + 本地图片，不依赖任何远程链接。

## 1. 界面

```
┌─ Feng · 多功能提示词预设 ─────────────┐
│ 正向基础词   [__________________]      │
│ 反向基础词   [__________________]      │
│ 通用反向预设 [通用写实        ▾]      │
│ 随机种子     [0            🎲]        │
│ ┌───────────────────────────────────┐ │
│ │ 风格 | 证件照 | 多角度 | 主体 | … │ │  ← 页签（Shift 多选）
│ │ [搜索风格...]        [清空已选]   │ │
│ │ 当前「风格」分组未启用…           │ │  ← 提示行
│ │ ┌────┐┌────┐┌────┐                │ │
│ │ │缩略││缩略││缩略│                │ │  ← 卡片网格
│ │ │ 图 ││ 图 ││ 图 │                │ │
│ │ └────┘└────┘└────┘                │ │
│ │  上一页   1 / 34   下一页          │ │
│ └───────────────────────────────────┘ │
└───────────────────────────────────────┘
```

- 点页签 = **只启用该分组**（不会把自己关掉，所以点了一定有反应）；**按住 Shift 点 = 在已启用分组上增删**（多分组同时生效）；
- 卡片**默认单选**：点另一张卡片就替换掉原来的；再点一次已选中的唯一项 = 取消选中；
- 卡片标题固定占**两行**高度（只有一行也留白），缩略图区固定 **1:1 正方形**（图片 `cover` 裁切填满），
  保证每张卡片等高、网格整齐；
- 缩略图加载失败时图片区显示「无图」，不影响点选和提示词输出；
- 按住 **Shift** 点卡片 = 多选/取消；
- 选中卡片会**自动启用**它所在的分组，避免"选了却不出提示词"；
- 「清空已选」清空当前分组。

## 2. 数据怎么流动

```
presets/presets.json       （出厂，只读）──┐
presets/user_presets.json  （界面增删改）──┼─ preset_store.py ─┬─ GET  /feng_presets/index
presets/thumbs/*.jpg                      ─┘                   ├─ GET  /feng_presets/thumb/<name>
                                                                ├─ POST /feng_presets/upload
                                                                ├─ POST /feng_presets/category
                                                                ├─ POST /feng_presets/item
                                                                └─ DELETE ...
                                                                        │
                                                          web/js/prompt_preset.js
                                                                        │
                                                写回节点的隐藏控件 config（JSON）
                                                                        │
                                                nodes_prompt_preset.py execute()
                                                                        ▼
                                                         混合正向 / 混合反向 两个 STRING
```

关键设计：**前端只拿 id、label、缩略图名，不拿提示词正文**；提示词正文只在执行时按 id 从后端取。
索引只有 65 KB，页面不会因为几百条风格而变重。

## 3. `presets/presets.json` 格式

```jsonc
{
  "version": 1,
  "page_size": 12,                       // 每页卡片数
  "negative_presets": {                  // 通用反向预设下拉框的内容
    "关闭": "",
    "通用写实": "(worst quality, ...)"
  },
  "tabs": [ /* 见下 */ ],
  "fooocus_styles": [                    // 风格页签用的数据集（与 GJJ 一致的 275 条）
    {
      "id": "fooocus-enhance",
      "label": "Fooocus-优化增强",        // 界面上显示的
      "name": "Fooocus Enhance",          // 英文名，用于搜索
      "prompt": "... {prompt} ...",       // {prompt} 会被已有正文替换
      "negative_prompt": "...",
      "thumbnail": "https://raw.githubusercontent.com/.../fooocus_enhance.jpg"
    }
  ],
  "krea_styles": [ /* 本地风格页签用的 397 条，thumb 指向 presets/thumbs/ 下的本地 jpg */ ]
}
```

一条风格有两种缩略图来源，前端**本地优先、远程兜底**：

| 字段 | 含义 |
| --- | --- |
| `thumb` | `presets/thumbs/` 下的本地文件名，走 `/feng_presets/thumb/<name>` |
| `thumbnail` / `thumb_url` | 远程图片地址，直接给 `<img src>` |

页签支持三种 `kind`：

### `"styles"` —— 引用一个顶层数据集

```jsonc
{ "id": "style",       "label": "风格",     "kind": "styles", "dataset": "fooocus_styles", "searchable": true },
{ "id": "style_local", "label": "本地风格", "kind": "styles", "dataset": "krea_styles",    "searchable": true }
```

`dataset` 指向 `presets.json` 顶层的数组名，省略时默认 `"styles"`。
所以想要第三套风格包，只要加一个数组 + 一个页签。

### `"cards"` —— 页签自带 `items`

```jsonc
{
  "id": "subject", "label": "主体", "kind": "cards", "searchable": true,
  "items": [
    { "id": "subject_cat", "label": "猫", "prompt": "a cat as the main subject" }
  ]
}
```

有 `thumb` 字段就显示图片，没有就显示纯文字卡片。

### `"fields"` —— 表单型页签

字段型页签有两个概念：**字段**（界面上的下拉/滑条）和**构建器**（怎么把字段拼成提示词）。
`builder` 决定用哪种拼装规则：

| `builder` | 用于 | 行为 |
| --- | --- | --- |
| `"mapped"` | 主体 / 环境 / 随机灵感 | 每个字段按 `option_map` 查出片段，按字段顺序用逗号拼接 |
| `"idphoto"` | 证件照 | 先拼「一个 + 体型 国籍 性别」，再依次补构图/佩饰/表情/妆容/配饰、发色发型、服装、背景（中文输出） |
| `"angle"` | 多角度 | 旋转/俯仰/远近按分档换算成英文机位描述，`视角描述=详细` 时附带数值 |
| `"template"`（默认） | 自定义 | 用 `template` 里的 `{字段id}` 占位符格式化 |

`"mapped"` 形式的字段长这样（界面显示中文，内部映射到英文片段）：

```jsonc
{
  "id": "subject_character",
  "label": "主体·角色",
  "type": "combo",
  "default": "无",
  "options": ["无", "随机", "二千酱", "艾丽丝·马格特罗伊德", "..."],   // 界面显示的
  "option_map": { "二千酱": "2k-tan", "艾丽丝·马格特罗伊德": "alice margatroid" },  // 实际输出的片段
  "option_alias": { "2k-tan": "二千酱" },        // 旧存档里的英文值仍能解析
  "random_pool": ["2k-tan", "alice margatroid"]  // 选“随机”时抽样的池子
}
```

中文标签是导入时用 GJJ 的 `label_translations.json`（8143 条英文→中文）翻译好的，
不依赖运行时翻译：主体/环境 **100%** 命中，随机灵感 **99.1%** 命中，剩下的是很长的地点描述句，
保持英文原文。

`"angle"` 形式的字段用 `type: int / float` + `min / max / step`，前端渲染成滑条：

```jsonc
{ "id": "rotate", "label": "视角旋转", "type": "int", "default": 0, "min": 0, "max": 360, "step": 1 }
```

通用规则：`无` / `关闭` 输出空；`随机` 按节点的 **随机种子** 从 `random_pool` 里抽一个。
字段型页签底部还有一条**实时预览**，调参数时会显示当前拼出来的片段（后端
`POST /feng_presets/preview` 计算，和正式执行同一套代码，不会不一致）。

`多角度` 页签的预览更完整：一个俯视罗盘（指针跟着旋转角转）+ 中文方位摘要
（水平 / 垂直 / 景别）+ 数值（旋转° 俯仰° 缩放）+ 单独标注的「角度提示词预览」。
罗盘是前端用 SVG 画的，不依赖 GJJ 的图片素材。

这 5 个页签的字段和选项全部来自本机 GJJ_Nodes 的数据，用
`tools/import_gjj_tabs.py` 一键导入（只读它的文件，不改它）：

```powershell
& 'H:\~~~aki-v3.2\python\python.exe' tools\import_gjj_tabs.py
```

导入后：证件照 13 字段 / 253 选项，多角度 4 字段，主体 21 字段 / 2247 选项，
环境 6 字段 / 432 选项，随机灵感 19 字段 / 5689 选项。

## 4. 加自己的预设

### 方式一：在节点面板里直接增删改（推荐）

不用改任何文件、不用重启，全部在画布上完成：

| 操作 | 怎么做 |
| --- | --- |
| 新建分类 | 页签栏最右边的 **＋** 按钮，输入分类名 |
| 分类改名 | **双击**自定义分类的页签 |
| 加预设 | 先切到目标分类，点 **＋ 新增预设**，填名称 / 提示词 / 反向词，可选上传缩略图 |
| 改预设 | 卡片左上角的 **✎**（会回填原有内容，正文也能改） |
| 删预设 | 卡片左上角的 **✕**，或编辑弹窗里的「删除」 |
| 删分类 | 自定义分类页签右侧的 **✕**；弹窗里要**手动输入分类名**才能点删除（会连带删除该分类下的所有预设） |

提示词里可以写 `{prompt}`，表示"已有正文放在这里"——所有分类（含自定义分类）都支持这个占位符。

写到哪里：自定义内容存 `presets/user_presets.json`，**出厂预设（`presets.json`）永远是只读的**，
界面上删不掉、也改不了出厂条目。用户文件格式：

```jsonc
{
  "version": 1,
  "categories": [ { "id": "user-28059ccae9", "label": "我的风格库" } ],
  "items": [
    {
      "id": "user-70fcdcccc9",
      "tab_id": "user-28059ccae9",     // 也可以填 "style" / "subject" 等出厂页签
      "label": "赛博朋克",
      "prompt": "cyberpunk city, neon, {prompt}",
      "negative_prompt": "",
      "thumb": "user-a0fa48f0d6.jpg"   // 可选，指向 presets/thumbs/
    }
  ]
}
```

想备份/迁移自己的预设库，复制这一个文件就行。

### 方式二：换成 Fooocus 风格包（和 GJJ 同款内容）

`风格` 页签现在装的就是 GJJ 用的那套 **Fooocus 风格包（275 条，23 页）**，来源是本机
`ComfyUI_GJJ_Nodes/presets/prompt_presets/fooocus_styles.json`。重新导入：

```powershell
& 'H:\~~~aki-v3.2\python\python.exe' tools\import_fooocus.py
# 换来源（例如 ComfyUI-Easy-Use 里那份）
& '...\python.exe' tools\import_fooocus.py --source "...\ComfyUI-Easy-Use\resources\fooocus_styles.json"
```

这批数据的缩略图是**远程 URL**（和 GJJ 完全一样），所以浏览器需要能访问
`raw.githubusercontent.com`；断网时卡片会退化成文字，但**选择与提示词合并照常工作**。

想让它们完全离线，在能上网的环境跑一次（ComfyUI 自带的 Python 就行）：

```powershell
& 'H:\~~~aki-v3.2\python\python.exe' tools/download_fooocus_thumbs.py
```

它会把这 275 张图压成 256px 存进 `presets/thumbs/` 并改成本地引用，之后再断网也有图。
`--limit 20` 可先试 20 张，`--force` 强制重下。

### 方式三：跑导入脚本（批量）

```powershell
cd H:\~~~aki-v3.2\ComfyUI\custom_nodes\Feng
& 'H:\~~~aki-v3.2\python\python.exe' tools\import_presets.py
```

默认从本机 `ComfyUI_Lazybuxuexi\styles` 读 `krea2_*_styles.json`，把缩略图等比缩到 256px
写进 `presets/thumbs/`，再重写 `presets.json` 的 `krea_styles` 段（也就是「本地风格」页签）。
其它段（证件照、主体等）原样保留。

常用参数：

```powershell
# 换数据源
& '...\python.exe' tools\import_presets.py --source "D:\我的风格包"
# 缩略图更小 / 更大
& '...\python.exe' tools/import_presets.py --max-size 192 --quality 78
# 先导入 20 条试试
& '...\python.exe' tools/import_presets.py --limit 20
```

外部风格包需要是这种结构：

```
我的风格包/
├── krea2_xxx_分类名_styles.json     # 数组，每项含 name/name_cn/prompt/negative_prompt/thumbnail
└── samples/xxx.jpg                  # thumbnail 里的相对路径
```

### 方式四：手动改 JSON

1. 把图片放进 `presets/thumbs/`（jpg/png/webp 都行）；
2. 在 `presets.json` 的 `styles` 数组里加一项：

```json
{
  "id": "my-style-1",
  "label": "我的风格",
  "name": "My Style",
  "prompt": "my style keywords, {prompt}",
  "negative_prompt": "",
  "thumb": "my-style-1.jpg"
}
```

3. 重启 ComfyUI（数据文件有 mtime 缓存，重启最稳；`preset_store` 也会按修改时间自动重载）。

`id` 必须唯一且只用 `字母/数字/-/_`，缩略图文件名同理，后端会做白名单校验。

## 5. 提示词合并规则

顺序：

```
正向 = 正向基础词
     + 已启用 fields 页签渲染出的片段（按页签顺序）
     + 已启用 cards 页签里选中项的 prompt
     ↓ 再套风格
     若第一个选中风格含 {prompt}：用风格模板包住上面全部内容
     其余风格：去掉 {prompt} 后追加
反向 = 反向基础词 + 通用反向预设 + 每个选中风格的 negative_prompt
```

举例（`正向基础词 = "a cat"`，选中一个 `Fooocus-胶片` 风格）：

```
Style: cinematic film still, {prompt} ...
        ↓ {prompt} 被替换
Style: cinematic film still, a cat ...
```

这与 GJJ 的 `_apply_style_mix` 语义一致：**只有第一个带占位符的风格负责"包裹"，后面的只做追加**，
所以多选风格时不会出现嵌套两次的情况。

## 6. 前端面板的实现要点

`web/js/prompt_preset.js` 里几个值得学的点：

| 要做的事 | 写法 |
| --- | --- |
| 在节点里嵌一整块自定义 UI | `node.addDOMWidget(name, type, element, { serialize: false })` |
| 把状态存进工作流 | 写进一个普通 STRING 控件的 `value`，它会被自动序列化和提交 |
| 让那个控件看不见 | 覆写 `widget.computeSize = () => [0, -4]` 和 `widget.draw = () => {}`（**不要**改 `type`，会影响控件值序列化） |
| 工作流重新打开时恢复 | 覆写 `node.onConfigure`，重新读控件值再渲染 |
| 节点拉大时面板跟着变高 | 覆写 `node.onResize`，改外层 `height` |
| 请求后端 | `api.fetchApi("/feng_presets/index")` |

数据加载失败时不会白屏：节点标题会追加提示，`config` 控件仍为 `{}`，节点照样能执行（只是不合并任何片段）。

## 7. 已验证 / 未验证

已验证（有自动化脚本或实测结果）：

- `风格` 页签 275 条与 GJJ 完全同源（名称、顺序、提示词、缩略图 URL 一致）、23 页；
- `本地风格` 页签 397 条，缩略图 100% 本地可解析，`id` 与文件名均唯一；
- 索引接口返回 200、`application/json`，`page_size` / 页签结构正确；
- 缩略图接口返回合法 JPEG（`ffd8ff` 魔数），不存在的文件、路径穿越、非图片扩展名一律 404；
- 提示词合并：单风格包裹、多风格追加、主体/环境组合、证件照固定种子可复现、多角度参数渲染；
- **五个表单页签的输出与 GJJ 同规则**：证件照 `一个苗条的 女孩, 上半身近景特写, 微笑, 黑色 波波头, 白色 衬衫, 蓝色背景`；
  多角度 `front-right view, low angle, wide shot (horizontal: 45, vertical: -30, zoom: 3.0)`；
  主体/环境/随机灵感的选项映射与「随机」抽样正常，同种子可复现；
- 选项中文标签：主体 2247 项、环境 432 项全部为中文，随机灵感 5692 项中 99% 为中文；
  中文标签（二千酱/蓝月亮/女刺客）能正确解析回英文片段，旧存档里的英文原值通过
  `option_alias` 仍可解析；
- 预览接口 `POST /feng_presets/preview`：字段页签 200 并返回片段，非字段页签返回 400；
  多角度额外返回中文方位摘要（如 `97°/15°/3.8 → 右侧 / 俯视 / 远景`）；
- **用户预设 CRUD（30 项断言全过）**：新建/改名/删除分类、新增/修改/删除预设、
  读取单条回填、上传图片并访问、重复上传不重名、`{prompt}` 在自定义分类里同样生效、
  出厂预设不可删除、空名称/空正文/错误分类/非 multipart 上传全部返回 400、
  写入只落 `user_presets.json` 且 `presets.json` 哈希不变；
- 坏 JSON 容错（空串、非 JSON、类型错误都不抛异常）；
- 插件加载自检、`pyproject.toml` 解析、Python 语法、JS 括号配平与 import 路径解析全部通过。

未验证：

- **浏览器里的实际渲染与交互**。本机没有 Node 运行时也没有浏览器自动化，前端只做了静态检查。
  启动 ComfyUI 后请按 `F12` 看控制台是否有报错，并实际点一遍新增/编辑/删除。

## 8. 已知限制

- 风格数据来自本机已安装的 `ComfyUI_Lazybuxuexi` 风格包（`krea2` 系列），版权归其原作者，
  这里只做本地转换以便离线使用；对外发布前请自行确认素材授权，或换用自己的图。
- `证件照` / `多角度` 用模板拼接，比 GJJ 那套逐条件判断的逻辑简单，输出会包含
  `rotated 0 degrees` 这类中性描述。
- 面板最多同时显示一页 12 张卡片；搜索是前端过滤（几百条在内存里过滤，无延迟）。
