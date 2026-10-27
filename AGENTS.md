# AGENTS.md — Feng 插件

本文件只约束 `custom_nodes\Feng` 这个**插件项目**。

`H:\~~~aki-v3.2\ComfyUI\AGENTS.md` 是 **ComfyUI 核心仓库**的规范，那边关于模型加载、注意力实现、
量化算子、offload、显存策略的规则**不适用于本插件**——这里没有模型实现，只有节点、数据与前端。
核心规范里仍然适用的部分：节点写法约定、不联网、向后兼容、少依赖、代码要像手写的。

## 1. 环境事实（别猜，按这个来）

| 项目 | 值 |
| --- | --- |
| ComfyUI | `0.42.3`（V3 节点 API） |
| Python | `H:\~~~aki-v3.2\python\python.exe`（**系统没有 `python` 命令**，所有脚本都用这个绝对路径） |
| 前端 | `comfyui_frontend_package 1.55.18` |
| 节点 API | `comfy_api.latest` → `io.ComfyNode` + `comfy_entrypoint` |

限制：

- 工具沙箱**没有网络**，也**没有 Node 运行时**，**没有浏览器自动化**；
  用户浏览器可以联网（远程缩略图能加载）。
- 因此前端**无法自动验证渲染**，只能静态检查 + 由用户在浏览器里确认。

## 2. 改完必须做的验证

```powershell
cd H:\~~~aki-v3.2\ComfyUI\custom_nodes\Feng
& 'H:\~~~aki-v3.2\python\python.exe' tools\check_all.py
```

它跑两件事：`check_load.py`（按 ComfyUI 的加载流程验证插件与节点注册）、`check_js.py`（前端静态检查）。

生效方式：

| 改动 | 生效 |
| --- | --- |
| `web/**.js` | 浏览器 `Ctrl+F5` |
| `*.py`、`presets/*.json` | **重启 ComfyUI** |

不要用 `main.py --quick-test-for-ci` 做日常验证：本机装了 50+ 第三方插件，实测会卡十几分钟，
而且它**加载失败也返回 0**，只能靠翻日志判断。

## 3. 目录职责

| 路径 | 职责 | 不做什么 |
| --- | --- | --- |
| `__init__.py` | 只注册节点与 `WEB_DIRECTORY` | 不放业务逻辑 |
| `nodes.py` | 示例节点（演示用） | — |
| `nodes_prompt_preset.py` | 预设节点的 schema、提示词拼装、HTTP 路由 | 不直接读写文件（走 `preset_store`） |
| `nodes_batch_loader.py` | 批量图片加载节点：读 input 图片、拼批次、算遮罩 | 不做上传（复用核心 `/upload/image`） |
| `preset_store.py` | 数据读写、合并视图、CRUD、缩略图路径校验 | 不拼提示词 |
| `presets/presets.json` | 出厂数据（**只读**，由 tools 脚本生成） | 不手改 |
| `presets/user_presets.json` | 界面里新增的分类与预设（**可写**） | 不让出厂数据写进来 |
| `web/js/*.js` | 前端面板 | 不做业务计算（拼词在后端） |
| `tools/*.py` | 自检与数据导入脚本 | 运行时不参与 |

## 4. 数据模型（改之前先读懂）

### 两层数据

- `presets/presets.json`：出厂数据，**只读**。界面上删不掉、改不了。
- `presets/user_presets.json`：界面里新建的分类与预设，只有这里可写，写入一律走
  `preset_store` 的函数（带锁 + 原子替换）。

### 页签

```jsonc
// 卡片型：items 来自顶层数组
{ "id": "style", "label": "风格", "kind": "styles", "dataset": "fooocus_styles", "searchable": true }
{ "id": "style_local", "label": "本地风格", "kind": "styles", "dataset": "krea_styles" }
// 表单型
{ "id": "angle", "label": "多角度", "kind": "fields", "builder": "angle", "fields": [ ... ] }
```

`builder` 决定拼装规则，四种：

| builder | 页签 | 规则 |
| --- | --- | --- |
| `mapped` | 主体 / 环境 / 随机灵感 | 每个字段按 `option_map` 取片段，按字段顺序逗号拼接 |
| `idphoto` | 证件照 | 「一个 + 体型 国籍 性别」再逐项补充，最后加背景（中文输出） |
| `angle` | 多角度 | 旋转/俯仰/远近分档换算成英文机位描述 |
| `template` | 自定义 | `template` 里的 `{字段id}` 占位符格式化 |

### 字段

```jsonc
{
  "id": "subject_character", "label": "主体·角色", "type": "combo", "default": "无",
  "options": ["无", "随机", "二千酱"],              // 界面显示（中文）
  "option_map": { "二千酱": "2k-tan" },            // 选中后实际输出的片段（英文）
  "option_alias": { "2k-tan": "二千酱" },          // 旧存档里的英文值兼容
  "random_pool": ["2k-tan"]                        // 选“随机”时抽样
}
```

约定：`无` / `关闭` → 空；`随机` → 用节点种子从 `random_pool` 抽。

### 不变量

- `id` 只用 `[A-Za-z0-9._-]`，全局唯一；缩略图文件名同样受白名单校验。
- 缩略图两种来源：`thumb`（本地，走 `/feng_presets/thumb/<name>`）与 `thumbnail`（远程）。
  前端**本地优先、远程兜底**，都失败显示「无图」。
- **生成物不要手改**：`fooocus_styles`、`krea_styles`、以及四个字段页签的数据由
  `tools/import_fooocus.py`、`tools/import_presets.py`、`tools/import_gjj_tabs.py` 生成。
  要改内容就改脚本再重跑；手改会在下次导入时被覆盖。

## 5. 后端约定

- 路由前缀：预设相关用 `/feng_presets/`，图片列表用 `/feng_images/`；错误一律 `400` + `{"error": "..."}`。
- 任何来自前端的文件名字段都必须走 `preset_store.resolve_thumb()`（扩展名白名单 + 目录包含校验），
  不允许拼路径。图片节点的 input/output 文件名走 `nodes_batch_loader._resolve_file()`。
- 只允许新增 HTTP 方法到既有路由常量上，不要在别处再注册一遍。
- `_register_routes()` 在拿不到 `PromptServer.instance` 时必须静默返回（自检脚本会 import 本模块）。
- **不新增第三方依赖**。当前只用标准库 + PIL（ComfyUI 自带）。
- 运行时不联网、不上报任何数据。

## 6. 前端约定

- 隐藏 `config` 控件只设 `widget.hidden = true` + 零高度 + 画布外坐标，
  **不要改 `widget.type`**（`converted-widget` 之类会影响控件值提交，导致后端收不到配置）。
- 用户输入（分类名、预设名、提示词）**只能用 `textContent` 写 DOM，禁止 `innerHTML`**。
- 面板状态只写进 `config` 控件的 JSON；不要另建持久化。
- 调后端的预览请求要防抖（约 250ms），失败静默降级，不要打断交互。
- `web/` 下**所有 `.js` 都会被当扩展加载**，别放只供 import 的工具脚本。
- import 路径按**浏览器 URL 深度**算：`web/foo.js` 用 `../../scripts/app.js`，
  `web/js/foo.js` 用 `../../../scripts/app.js`。
- 破坏性操作（删分类）用输入名称确认，不用裸 `confirm()`。

## 7. 代码风格

- 小步改动，一个文件一个问题；不要为一次性需求造抽象层。
- 注释只解释"为什么"，不复述代码。
- 面向用户的文案用中文；标识符与注释里的术语用英文。
- 新增配置项默认向后兼容：老存档读不到就用默认值，不要抛错。

## 8. 外部数据源（只读）

- `custom_nodes\ComfyUI_GJJ_Nodes`：字段定义、选项映射、Fooocus 风格、中英词表。
- `custom_nodes\ComfyUI_Lazybuxuexi`：本地风格包与缩略图。
- **不要修改这两个目录**。导入脚本只读它们，把数据转换进本插件。

## 9. 已知坑（踩过的）

1. `preset_store._merged()` 合并页签时会**丢掉没显式透传的键**——漏传 `builder` 曾导致字段页签
   全部走模板分支、输出为空。给页签加新字段时，同步改 `_merged()` 和 `build_index()`。
2. 前端 `confirm()` 只适合轻量确认；删分类必须输入名称。
3. 卡片高度不一致会破坏网格观感：图片区固定 `aspect-ratio:1/1`、标题固定两行高度。
4. 远程缩略图在断网环境会「无图」，不要据此判断节点坏了。
5. 改完 `presets.json` 后索引体积会变（当前约 224 KB），别在前端做全量重解析。
6. `folder_paths.get_full_path("input", name)` 对 input 目录**不可用**（input 不是按模型目录注册的）。
   读 input/output 图片要用 `get_input_directory()` / `get_output_directory()` 自己拼路径，再用
   `os.path.commonpath` 校验没有越界；参考 `nodes_batch_loader._resolve_file`。
