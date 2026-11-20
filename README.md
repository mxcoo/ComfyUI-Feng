# Feng

ComfyUI 自定义节点插件。

## 节点

| 节点 | 分类 | 说明 |
| --- | --- | --- |
| **Feng · 多功能提示词预设** | `Feng/提示词` | 在节点里直接点选风格缩略图（`风格` 页签 275 条 Fooocus 风格、与 GJJ 同源；`本地风格` 页签 397 条离线风格包），支持搜索、分页、单选 / Shift 多选，另有证件照 / 多角度参数页签、主体与环境片段，输出混合后的正向与反向提示词。 |
| **Feng · 批量图片加载** | `Feng/图像` | 拖拽上传、或从 `input` / `output` 目录逐层选图；缩略图可 **拖拽排序**、**⇄ 替换**、单选 / Shift 多选；第一张可画笔编辑遮罩。输出 `图像组` 批次 + `次数` + `文件名` + `遮罩`（单张，只取第一张）+ `图像1..图像10` 单图口（关掉「单张接口」时 `图像1` 改输出图片列表）。 |
| **Feng 图像滤镜（示例）** | `Feng/示例` | IMAGE 进出，支持反相 / 灰度 / 提亮，可选用 MASK 控制作用区域，并带预览输出 |
| **Feng 文本重复（示例）** | `Feng/示例` | 把文本按次数拼接，用于不接图片时快速验证插件是否正常 |

> 另有 **55 个 AusBoss 节点**（分类 `🆎 AusBoss/…`）随本插件一起安装，界面全中文，
> 见下面的 [AusBoss 节点包](#ausboss-节点包内置已汉化)。

## AusBoss 节点包（内置，已汉化）

把 [ComfyUI-AusBoss](https://github.com/ausboss/ComfyUI-AusBoss)（MIT，作者 ausboss）整个包并进了本插件：

- **版本**：2.26.4（上游 `9e9121a`），随插件升级，不需要另装 AusBoss；
- **规模**：55 个节点 + 23 条后端路由 + 55 篇节点帮助 + 143 个前端模块；
- **语言**：节点名、分类、描述、输入标签与提示、下拉的显示文字、右键别名、帮助文档、所有前端面板文案，全中文。

### 分类与节点

| 分类 | 节点 |
| --- | --- |
| `🆎 AusBoss/图像`（15） | 对齐图像、颜色匹配、图像比较 A/B、编辑锁、编辑锁还原、图像裁剪 + 旋转 + 扩边、图像文件夹、图像缩放、图像尺寸、加载图像、加载图像 + 扩边、与源图重新对齐（实验性）、保存图像、分块放大、分块放大拼接 |
| `🆎 AusBoss/实用工具`（22） | 每隔 N 帧选取、拆分批次、合并批次、标注便签、标注图块、释放显存、H3 提示词撰写、布局框、文本、整数、浮点数、数学表达式、提示词变体、Latent 尺寸、运行计时器、种子、显示文本、分步预览、文本行、工作流说明卡、工作流说明磁贴、工作流开关 |
| `🆎 AusBoss/视频`（8） | 加载音频、加载视频、选择帧、帧插值、FlashVSR 放大、保存视频、视频裁剪 + 旋转 + 扩边 → 单帧、→ 片段 |
| `🆎 AusBoss/局部重绘`（3） | 局部重绘裁剪、局部重绘拼接、LaMa 局部重绘 |
| `🆎 AusBoss/遮罩`（3） | 按名字取遮罩、点选取遮罩、遮罩精修 |
| `🆎 AusBoss/Krea2`（2） | Krea 2 编码、Krea 2 扩图模型补丁 |
| `🆎 AusBoss/加载`（1） | LoRA 加载器 |
| `🆎 AusBoss/兼容`（1） | 简易水印去除器（AusBoss 兼容） |

节点内部都有各自的画布控件：图像/视频裁剪带全屏编辑器（缩放、平移、旋转、扩边、局部重绘与拼接），
比较节点可以滑动/擦除、导出对齐结果与图层 PSD，LoRA 加载器能直接从 Civitai 拉模型信息与触发词，
工作流开关可以在一条工作流里做分支。每个节点的用法见界面右上角的 **?**（就是那 55 篇中文帮助）。

### 中文到什么程度

- **翻成中文**：节点名与分类、节点描述、输入标签、每个输入的提示气泡、下拉框里显示的选项文字、搜索别名、帮助文档、前端所有按钮/菜单/提示/报错。
- **保持英文**：下拉框的**取值**（`crop`、`pad`、`input folder`、`one per run` 等）。它们会写进工作流 JSON，也是前端判断和 `/ausboss/*` 接口的入参，翻成中文会让旧工作流和前端逻辑同时失效。这也是为什么界面上看到的是「中文说明 + 英文取值」。
- 节点用的是 ComfyUI 官方中文口径：**遮罩**（不是「蒙版」）、**局部重绘**（不是「修补」）。

### 依赖与模型

- 后端只用 ComfyUI 自带的东西（torch / numpy / Pillow / PyAV），**本插件不新增第三方依赖**。
- 需要外部模型的节点，缺模型时会直接说缺哪个：
  - **LaMa 局部重绘** → `models/lama/big-lama.pt`；
  - **FlashVSR 放大** → `models/flashvsr/flashvsr_v1.1_fp16.safetensors`。
- 可选增强（不装也能用，用到时才提示）：`opencv-contrib-python`（遮罩精修的 guided filter）、`pymatting`（alpha matting，抠边更细）、`pillow-jxl-plugin`（JXL 读写）。

### 和官方 AusBoss 共存

如果 `custom_nodes` 里另外还装着官方 AusBoss，本插件会**自动让位**（只让官方那份注册节点和路由），
避免两套 `/ausboss/*` 路由互相覆盖。想用内置这份就把官方目录移走，重启即可。

### 示例工作流

`ausboss/example_workflows/` 有 12 组工作流（`.json` + 同名 `.jpg` 预览图）：
FlashVSR 视频放大、Krea 2 局部重绘 / 扩图 / 旋转扩图、Klein 9B 扩图等，拖进 ComfyUI 就能打开。

### 相关文档

- [docs/10-ausboss-port.md](docs/10-ausboss-port.md)：怎么并进来的、桥接原理、汉化分层、数据怎么重新生成；
- [docs/11-ausboss-maintenance-log.md](docs/11-ausboss-maintenance-log.md)：版本对照、与上游的等价性、升级 SOP、踩过的坑。

### 多功能提示词预设 怎么用

1. 把节点加到画布，先在上方页签里**点击启用**要用到的分组（按住 Shift 可同时启用多个）；
2. 在网格里点卡片选择风格（默认单选，Shift 多选），「搜索风格...」可按中英文名过滤，「清空已选」清空当前分组；
3. 需要的话填写正向 / 反向基础词、选一个通用反向预设；
4. 节点输出 **混合正向提示词** 和 **混合反向提示词**，直接接给 CLIP Text Encode。

选择会随工作流一起保存。风格数据在 `presets/presets.json`，缩略图在 `presets/thumbs/`，
可以用 `tools/import_presets.py` 批量导入自己的风格包。

### 在界面里管理自己的预设

不用改文件、不用重启：

- 页签栏最右的 **＋** 新建分类，**双击**自定义分类可改名；
- **＋ 新增预设** 在当前分类加一条（名称 / 提示词 / 反向词 / 可选缩略图上传）；
- 自定义卡片左上角 **✎** 编辑、**✕** 删除；
- 提示词里写 `{prompt}` 表示"已有正文插在这里"，所有分类都支持。

自定义内容存在 `presets/user_presets.json`，出厂预设只读、界面上删不掉。
备份或迁移自己的预设库，复制这一个文件即可。

### 批量图片加载 怎么用

1. **加图**：直接把图片文件拖到节点面板上（可多张），或点 **＋ 上传图片**，
   也可以点 **📁 选择已有** 从 `input` / `output` 里挑——选择器支持切换目录、
   点 📁 进子目录、⬆ 上级返回，每层只列当前目录，避免一次铺太多卡顿；
   缩略图走 WEBP，右下角放大镜悬停看 768px 大图，放大镜左侧的 ↗ 在新窗口打开原图，右上角可开删除模式；
   上传的图默认落到 input/Feng/<yyyyMM>/（例如 input/Feng/202610/），不再堆在 input 根目录；
2. **调顺序**：直接把缩略图**拖到另一格**上即可换位；也可以用每格的 **◀ ▶** 微调、**✕** 移除；
3. **换图**：点缩略图右上角的 **⇄** 打开「选择已有」窗口，点一张就**原地替换**这一格（位置不变）；
4. **改遮罩**：第一张缩略图上的 **◐** 打开画笔，涂完「保存遮罩」，只作用于第一张；
5. **选图**：点缩略图单选，Shift + 点击多选，「全选 / 反选 / 清空」批量操作。
6. **删图（可找回）**：在「选择已有」窗口点右上角 **🗑 删除**，每张图右上角出现 ✕；
   点 ✕ 把文件移到 ComfyUI 根目录的 `delltemp`（与 `input` / `output` 同级），
   保留原来的子目录和文件名，同名自动加 `_1`、`_2`。

输出：

| 端口 | 说明 |
| --- | --- |
| `图像组` | 标准批次张量 `[B,H,W,3]`，可直接接预览 / VAE / 编码 |
| `次数` / `文件名` | 张数、按顺序拼接的文件名 |
| `遮罩` | 只有第一张的遮罩，固定单张 `[1,H,W]`；其他图片没有遮罩，也不会进这个口 |
| `图像1..图像10` | 「单张接口」打开时**一一对应**：第 N 张只从 `图像N` 输出；加载不满 10 张时，多出来的口不输出。关闭时 `图像1` 输出图片列表 `[H,W,3] × N`（可接 PreviewImage 逐张预览），其余口无输出 |

节点宽度 420 时面板一屏约 2 行多，可把节点拉高看更多；图片多了在面板内滚动。

## 环境

- ComfyUI `0.42.3`（V3 节点 API）
- Python `3.13`
- 无额外依赖：Feng 自己只用标准库 + Pillow（导入脚本），内置的 AusBoss 用 ComfyUI 自带的
  torch / numpy / Pillow / PyAV；可选的 `opencv-contrib-python`、`pymatting`、`pillow-jxl-plugin`
  不装也能用，只在用到那项功能时提示。

## 安装

```powershell
cd H:\~~~aki-v3.2\ComfyUI\custom_nodes
git clone https://github.com/mxcoo/ComfyUI-Feng.git Feng
```

然后重启 ComfyUI。

## 开发

本插件自带秒级自检，改完代码不用等整个 ComfyUI 启动：

```powershell
& 'H:\~~~aki-v3.2\python\python.exe' tools\check_all.py
```

它跑加载自检和前端静态检查，秒级出结果，不用等整个 ComfyUI 启动。

完整的开发文档在 [`docs/`](docs/README.md)，包含插件加载机制、节点 API、类型速查、前端扩展、
服务端路由、打包发布、20 个常见坑，以及本节点自己的实现说明。

## 目录结构

```
Feng/
├── __init__.py              插件入口：comfy_entrypoint() + WEB_DIRECTORY
├── nodes.py                 示例节点
├── nodes_prompt_preset.py   多功能提示词预设节点 + 后端路由
├── nodes_batch_loader.py    批量图片加载节点 + 图片列表路由
├── preset_store.py          预设数据读写与缩略图路径校验
├── presets/                 presets.json（出厂）+ user_presets.json（自建）+ thumbs/
├── ausboss/                 内置的 AusBoss 节点包
│   ├── __init__.py          注册 55 个节点（V1 映射，由入口桥接进 V3）
│   ├── nodes/               97 个实现文件 + 23 条 /ausboss/* 路由
│   ├── zh/                  nodes.json（中文名/描述/标签/提示）+ localize.py（只改展示字段）
│   ├── locales/zh/          上游自带的中文参考数据
│   ├── example_workflows/   12 组示例工作流 + 预览图
│   └── _version.py          PACK_VERSION / UPSTREAM_COMMIT
├── tools/check_all.py       加载自检 + 前端静态检查
├── tools/check_ausboss.py   AusBoss 专项自检（编译、55 节点、汉化覆盖、前端语法）
├── tools/check_ausboss_upstream.py  与上游某个 tag/commit 对账
├── tools/import_presets.py  从外部风格包导入预设
├── web/js/prompt_preset.js  预设面板
├── web/js/batch_loader.js   批量图片面板
├── web/ausboss/             内置 AusBoss 的前端（143 个模块）
│   ├── <feature>/index.js   每个节点的画布控件
│   ├── shared/              共用模块（编辑器、时间轴、剪贴板…）
│   ├── docs/                55 篇中文节点帮助
│   └── zh_labels/           输入标签的中文化
├── docs/                    开发文档
├── requirements.txt         第三方依赖
└── pyproject.toml           项目与发布元数据
```

加一个新节点只需要两步：

1. 写一个 `io.ComfyNode` 子类；
2. 把它加进 `__init__.py` 的 `get_node_list()` 返回列表。

## 许可

代码以 [MIT License](LICENSE) 发布。

> presets/ 目录下的风格卡片与缩略图来自第三方风格包（Fooocus styles、Krea styles 等），
> 遵循其原始许可，不覆盖于本仓库的 MIT 许可之下。
>
> `ausboss/` 与 `web/ausboss/` 来自 [ComfyUI-AusBoss](https://github.com/ausboss/ComfyUI-AusBoss)，
> 同样是 MIT，原始许可见 [`ausboss/LICENSE`](ausboss/LICENSE)；本仓库对它的改动是：桥接进 V3 入口、
> 改三处路径与单副本判断、以及整套中文数据与前端文案。

## 致谢

- Fooocus 风格集合（275 条）
- Krea / GJJ 离线风格包（397 条）
- ComfyUI V3 节点 API
- [ComfyUI-AusBoss](https://github.com/ausboss/ComfyUI-AusBoss)（ausboss，MIT）：本插件内置的
  55 个节点、前端模块与帮助文档都来自这个包，中文界面是在它之上做的汉化层
