# Feng

ComfyUI 自定义节点插件。

## 节点

| 节点 | 分类 | 说明 |
| --- | --- | --- |
| **Feng · 多功能提示词预设** | `Feng/提示词` | 在节点里直接点选风格缩略图（`风格` 页签 275 条 Fooocus 风格、与 GJJ 同源；`本地风格` 页签 397 条离线风格包），支持搜索、分页、单选 / Shift 多选，另有证件照 / 多角度参数页签、主体与环境片段，输出混合后的正向与反向提示词。 |
| **Feng · 批量图片加载** | `Feng/图像` | 拖拽上传、或从 `input` / `output` 目录逐层选图；缩略图可 **拖拽排序**、**⇄ 替换**、单选 / Shift 多选；第一张可画笔编辑遮罩。输出 `图像组` 批次 + `次数` + `文件名` + `遮罩`（单张，只取第一张）+ `图像1..图像10` 单图口（关掉「单张接口」时 `图像1` 改输出图片列表）。 |
| **Feng 图像滤镜（示例）** | `Feng/示例` | IMAGE 进出，支持反相 / 灰度 / 提亮，可选用 MASK 控制作用区域，并带预览输出 |
| **Feng 文本重复（示例）** | `Feng/示例` | 把文本按次数拼接，用于不接图片时快速验证插件是否正常 |
| **孤海外补画板（可视化）· 联动** | （无新节点） | 给 [goohaitools](https://github.com/goohai/Goohaitools-comfyui) 的「外补画板（可视化）」补一个前端补丁：当「图像」上游是 `Feng · 批量图片加载` 时，画板直接显示**第一张勾选的图**与**第一张遮罩**，不触发上游执行；批量加载器里换图 / 排序 / 改遮罩，画板实时刷新。 |

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

### 与孤海外补画板联动

装了 [goohaitools](https://github.com/goohai/Goohaitools-comfyui) 后，把「外补画板（可视化）」的
**图像**直接连到 `Feng · 批量图片加载` 的「图像组」（或「图像1」），本插件会在前端
自动做两件事：

1. **首图预览**：画板画布直接显示批量加载器里**第一张勾选的图**（按面板顺序），
   不执行上游、不解码整批，秒开；批量面板换图 / 排序 / 勾选 / 重画遮罩，画板自动刷新。
2. **遮罩自动接线**：画板的「遮罩」口为空时，自动连到批量加载器的「遮罩」输出
   （和后端口径一致，只取第一张）；你手动拆掉就不会再抢。

画板工具栏上多了「**首图跟随**」开关，关掉就回到 goohaitools 原生的「加载」按钮行为。

> **配套补丁（可选，但推荐打）**：goohaitools 的可视化画板把单张遮罩按 batch 广播，
> 批量加载器默认又会把第一张的透明通道当遮罩，结果就是整批图都会被第一张的遮罩涂成
> 外补色。本仓库自带工具 `tools/patch_outpaint_mask.py` 一键修正：
>
> ```powershell
> & 'H:\~~~aki-v3.2\python\python.exe' tools\patch_outpaint_mask.py --check
> & 'H:\~~~aki-v3.2\python\python.exe' tools\patch_outpaint_mask.py
> ```
>
> 脚本自动在 `ComfyUI\custom_nodes` 下找 `外补画板（可视化）.py`，自带 `.bak`，
> `--revert` 可还原；goohaitools 更新后重跑一次即可。

## 环境

- ComfyUI `0.42.3`（V3 节点 API）
- Python `3.13`
- 无额外依赖（导入脚本用到 Pillow，ComfyUI 已自带）

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
├── tools/check_all.py       加载自检 + 前端静态检查
├── tools/import_presets.py  从外部风格包导入预设
├── tools/patch_outpaint_mask.py  给 goohaitools 可视化画板打遮罩 batch 修正
├── patches/goohaitools-outpaint-mask.diff  上面这个补丁的 diff 存档
├── web/js/prompt_preset.js  预设面板
├── web/js/batch_loader.js   批量图片面板
├── web/js/gh_outpaint_follow.js  孤海外补画板自动跟随（首图 + 遮罩）
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

## 致谢

- Fooocus 风格集合（275 条）
- Krea / GJJ 离线风格包（397 条）
- ComfyUI V3 节点 API
