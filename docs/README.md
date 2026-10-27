# Feng 插件开发资料

这套资料是为**在本目录开发 ComfyUI 自定义节点**准备的：一份可运行的骨架 + 一套按主题拆开的参考文档。
所有结论都对着本机实际安装的 ComfyUI 源码核对过，不是照搬网上旧教程。

## 本机环境（写文档时实测）

| 项目 | 值 |
| --- | --- |
| ComfyUI 版本 | `0.42.3`（`H:\~~~aki-v3.2\ComfyUI\comfyui_version.py`） |
| Python | `3.13.11`，`H:\~~~aki-v3.2\python\python.exe` |
| PyTorch | `2.13.0+cu130`，CUDA 可用 |
| 前端 | `comfyui_frontend_package 1.55.18` |
| 本插件目录 | `H:\~~~aki-v3.2\ComfyUI\custom_nodes\Feng` |
| 节点 API | V3（`comfy_api.latest` → `io.ComfyNode` + `comfy_entrypoint`） |

> 版本很关键：0.42.3 的 V3 API 和网上大量 2023–2024 年的 V1 教程差别很大。
> 遇到看不懂的老代码，看 [02-node-api.md](02-node-api.md) 末尾的 V1/V3 对照表。

## 资料索引

| 文档 | 讲什么 | 什么时候看 |
| --- | --- | --- |
| [01-plugin-structure.md](01-plugin-structure.md) | 目录结构、ComfyUI 怎么加载插件、V1/V3 两种入口 | **先看这个**，搞清楚它怎么找到你的代码 |
| [02-node-api.md](02-node-api.md) | 节点怎么写：`io.Schema` 全部字段、输入基类参数、`execute` 语义、缓存/懒执行、UI 输出 | 写第一个节点时 |
| [03-io-types.md](03-io-types.md) | 89 种 `io.*` 类型速查，各类输入可用参数 | 查"我要的数据类型叫什么" |
| [04-frontend.md](04-frontend.md) | 前端 JS 扩展：加载规则、`app.registerExtension`、加自定义控件 | 要改节点界面时 |
| [05-server-and-models.md](05-server-and-models.md) | 加 HTTP 路由、进度条、读模型文件目录 | 要联网/读写文件/长任务时 |
| [06-packaging.md](06-packaging.md) | 依赖、`pyproject.toml`、发布到 Registry / Manager | 要给别人安装时 |
| [07-pitfalls.md](07-pitfalls.md) | 20 个真实踩坑点与排错步骤 | 出问题时**先查这里** |
| [08-prompt-preset-node.md](08-prompt-preset-node.md) | 「多功能提示词预设」节点的实现、数据结构、怎么加自己的预设 | 要改这个节点时 |
| [09-batch-image-loader.md](09-batch-image-loader.md) | 「批量图片加载」节点：拖拽上传、排序、批次输出、取单张 | 要用/改这个节点时 |

## 骨架里有什么

> 给 AI 协作者的项目约定（环境事实、验证命令、数据不变量、禁止事项）在仓库根目录
> 的 [AGENTS.md](../AGENTS.md)，改代码前先看那份。

```
Feng/
├── __init__.py                     V3 入口：comfy_entrypoint() + WEB_DIRECTORY
├── nodes.py                        两个示例节点，复制改造即可
├── nodes_prompt_preset.py          多功能提示词预设节点 + 后端路由
├── nodes_batch_loader.py           批量图片加载节点（批次输出）
├── preset_store.py                 预设数据读写、索引、缩略图路径校验
├── presets/
│   ├── presets.json                出厂预设（只读：275 条 Fooocus + 397 条本地 + 各分组配置）
│   ├── user_presets.json           界面里新增的分类与预设
│   └── thumbs/                     缩略图（本地图片）
├── tools/check_all.py              一条命令跑完所有自动检查
├── tools/check_load.py             秒级自检：不启动 ComfyUI 验证加载链路
├── tools/check_js.py               前端静态检查（括号配平 / import 路径）
├── tools/import_fooocus.py         导入 Fooocus 风格包（GJJ 同源，275 条）
├── tools/import_gjj_tabs.py        导入证件照/多角度/主体/环境/随机灵感的字段与选项
├── tools/download_fooocus_thumbs.py 把远程缩略图下到本地，实现离线
├── tools/import_presets.py         从本地风格包导入「本地风格」（397 条）
├── web/js/feng_example.js          前端扩展示例（设置项 + 钩子）
├── web/js/prompt_preset.js         预设节点的可视化面板
├── web/js/batch_loader.js          批量图片节点的面板（拖拽上传 / 排序）
├── AGENTS.md                       给 AI 协作者的项目约定（环境/验证/禁区）
├── requirements.txt                第三方依赖（当前为空）
├── pyproject.toml                  项目元数据 + Registry 发布字段
├── README.md                       插件自身的说明（给别人看的）
└── docs/                           你正在看的这套资料
```

四个节点：

| 节点 ID | 说明 |
| --- | --- |
| `FengPromptPreset` | **多功能提示词预设**：风格缩略图网格 + 搜索 + 分页 + 多选，另有证件照/多角度参数页签，输出混合后的正负提示词 |
| `FengBatchImageLoader` | **批量图片加载**：拖拽上传、排序、单选/多选，按顺序输出 IMAGE 批次 + MASK + 数量 + 文件名 |
| `FengImageFilter` | 示例：IMAGE 进 / IMAGE 出、滑条、下拉框、可选 MASK、`ui.PreviewImage` 预览 |
| `FengTextRepeat` | 示例：多行文本框、整数控件、STRING 输出，不依赖图片，方便快速测试 |

## 三条最常用的验证命令

**1. 秒级自检（日常首选）**

它不启动 ComfyUI，直接按 `nodes.py` 的加载流程走一遍：导入 → 取 entrypoint →
取节点列表 → 校验每个节点的 schema → 解析 `WEB_DIRECTORY`。2 秒出结果。

```powershell
cd H:\~~~aki-v3.2\ComfyUI\custom_nodes\Feng
& 'H:\~~~aki-v3.2\python\python.exe' tools\check_load.py
```

**2. 只检查 Python 语法**

```powershell
& 'H:\~~~aki-v3.2\python\python.exe' -m py_compile `
  H:\~~~aki-v3.2\ComfyUI\custom_nodes\Feng\__init__.py `
  H:\~~~aki-v3.2\ComfyUI\custom_nodes\Feng\nodes.py
```

**3. 真实启动，看节点是否出现在菜单里**

用你平时的启动器启动 ComfyUI，节点在 **添加节点 → Feng → 示例** 下；
浏览器打开 `http://127.0.0.1:8188` 后按 `F5` 刷新即可，改 Python 代码需要重启 ComfyUI。

> ⚠️ 官方还有个 `main.py --quick-test-for-ci`（加载完全部插件后退出），但**本机装了 50 多个插件，
> 实测会卡在某个第三方插件的导入上十几分钟**。非要用的话加白名单，只加载自己：
>
> ```powershell
> cd H:\~~~aki-v3.2\ComfyUI
> & 'H:\~~~aki-v3.2\python\python.exe' -s main.py --windows-standalone-build `
>   --disable-auto-launch --quick-test-for-ci `
>   --disable-all-custom-nodes --whitelist-custom-nodes Feng
> ```
>
> 另外它加载失败也返回 0，务必看日志里的 `IMPORT FAILED`。详见 [07-pitfalls.md](07-pitfalls.md#坑-1quick-test-for-ci-永远返回-0看不出失败)。

## 改代码的正确姿势

1. 改 `nodes.py`：加一个 `io.ComfyNode` 子类；
2. 到 `__init__.py` 的 `get_node_list()` 里把它加进返回列表；
3. 重启 ComfyUI（Python 改动不会热重载）；
4. 如果节点没出现，看启动日志里 `Import times for custom nodes` 那段有没有 `IMPORT FAILED`。

## 官方文档

遇到本资料没覆盖的细节，优先查官方文档，但注意核对版本：

- 节点开发总览：<https://docs.comfy.org/custom-nodes/backend/overview>
- 后端列表/懒执行/进度条：<https://docs.comfy.org/custom-nodes/backend/lists>
- 前端扩展：<https://docs.comfy.org/custom-nodes/js/javascript_overview>
- Registry 发布：<https://docs.comfy.org/registry/overview>

本地还有两个比文档更权威的参考：

```text
H:\~~~aki-v3.2\ComfyUI\custom_nodes\example_node.py.example   官方 V3 示例
H:\~~~aki-v3.2\ComfyUI\comfy_api\latest\_io.py                V3 API 的全部定义（2700+ 行）
H:\~~~aki-v3.2\ComfyUI\comfy_extras\                          ComfyUI 自己的 V3 节点写法
```
