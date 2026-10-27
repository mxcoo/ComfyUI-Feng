# 01 · 插件结构与加载机制

先把"ComfyUI 是怎么找到并加载你的插件"这件事弄清楚，后面所有问题都好排查。

## 1. 什么算一个插件

`custom_nodes` 下的**每一个条目**都会被尝试加载（`nodes.py:2370-2396`）：

```
custom_nodes/
├── Feng/                 ← 目录型插件（推荐），必须有 __init__.py
├── some_single_node.py   ← 单文件插件，也支持
├── old_plugin.disabled/  ← 名字以 .disabled 结尾，直接跳过
└── __pycache__/          ← 特殊忽略
```

规则来自 `init_external_custom_nodes()`：

| 情况 | 行为 | 源码 |
| --- | --- | --- |
| 不是 `.py` 的普通文件（如 `.txt`、`.zip`） | 跳过 | `nodes.py:2377-2378` |
| 路径以 `.disabled` 结尾 | 跳过 —— **这是临时禁用插件的标准做法** | `nodes.py:2379-2380` |
| 目录 | 加载其中的 `__init__.py` | `nodes.py:2271` |
| 单个 `.py` 文件 | 按文件加载，模块名取文件名 | `nodes.py:2267-2268` |

注意：插件目录**内部的子目录不会被单独扫描**。只有 `custom_nodes` 这一层。

## 2. 加载流程（`nodes.py:2255-2352`）

`load_custom_node()` 做的事，按顺序：

```
1. 建模块 spec，执行 __init__.py            nodes.py:2266-2276
2. 解析 pyproject.toml（可选）               nodes.py:2280-2297
   └─ 读 [tool.comfy] web 决定前端目录
3. 读模块级 WEB_DIRECTORY（可选）            nodes.py:2299-2302
4. 找节点定义，二选一：
   ├─ 有 NODE_CLASS_MAPPINGS → V1 分支       nodes.py:2305-2314
   └─ 有 comfy_entrypoint    → V3 分支       nodes.py:2316-2345
5. 都不满足 → 警告并跳过                     nodes.py:2346-2348
```

### 关键规则：V1 优先，V3 会被静默忽略

`nodes.py:2305` 是 `if hasattr(module, "NODE_CLASS_MAPPINGS")`，命中后 `return True`
（`nodes.py:2314`），**根本不会再看 `comfy_entrypoint`**。

所以 `__init__.py` 里两种入口只能留一个，否则你会对着 `nodes.py` 里明明写好的节点
在界面上找不到它——而不报任何错。详见 [07-pitfalls.md](07-pitfalls.md#坑1)。

### V3 入口的确切要求（`nodes.py:2316-2345`）

```python
async def comfy_entrypoint() -> FengExtension:   # 同步函数也可以
    return FengExtension()
```

对返回值的要求，逐条都有检查：

| 检查 | 不满足的后果 | 源码 |
| --- | --- | --- |
| `comfy_entrypoint` 可调用 | 警告 `is not callable, skipping` | `nodes.py:2318-2320` |
| 返回值是 `ComfyExtension` 实例 | 警告 `did not return a ComfyExtension` | `nodes.py:2326-2328` |
| `await extension.on_load()` 能跑完 | 整个插件加载失败 | `nodes.py:2329` |
| `get_node_list()` 返回 `list` | 警告 `did not return a list of nodes` | `nodes.py:2331-2333` |

每个节点类上：

- 注册 key 取 `schema.node_id`（`nodes.py:2336-2338`）；
- `schema.display_name` 非空时写进 `NODE_DISPLAY_NAME_MAPPINGS`（`nodes.py:2340-2341`）。
- 如果 `node_id` 与 ComfyUI 内置节点重名，**会被内置节点占据**——因为加载时传了
  `base_node_names` 作为忽略集合（`nodes.py:2367`、`2396`）。所以自定义节点请加前缀。

`ComfyExtension` 还有 `on_load()` 钩子（`comfy_api/latest/__init__.py:117-121`），
在取节点列表之前被 `await` 调用，适合放"整个插件只做一次"的初始化。

## 3. 推荐目录结构

小插件就三个文件起步，够用很久：

```
Feng/
├── __init__.py        入口，只做注册，不放业务逻辑
├── nodes.py           节点定义
└── requirements.txt   第三方依赖（没有就留空/注释）
```

规模变大之后再拆，这个顺序比较自然：

```
Feng/
├── __init__.py
├── nodes/
│   ├── __init__.py        汇总导出
│   ├── image.py
│   └── text.py
├── utils.py               纯函数放这里，被节点 import
├── web/js/*.js            前端扩展
├── requirements.txt
├── pyproject.toml
└── README.md
```

## 4. 前端目录：WEB_DIRECTORY

`__init__.py` 里写：

```python
WEB_DIRECTORY = "./web"
```

- 是**相对 `__init__.py` 所在目录**的路径（`nodes.py:2300`）；
- 必须真实存在且是目录，否则静默忽略（`nodes.py:2301`）；
- 注册名是**模块名**，也就是目录名 `Feng`，前端访问前缀是 `/extensions/Feng/`。

### 别和 pyproject 的 `web` 字段同时用

`pyproject.toml` 里也能声明前端目录：

```toml
[tool.comfy]
web = "web"
```

这条路径注册时用的是 `project.name`（`nodes.py:2285-2295`），而 `WEB_DIRECTORY` 用的是
**目录名**。你的 `project.name` 是 `feng`、目录名是 `Feng`，两者大小写不同，
就会在 `EXTENSION_WEB_DIRS` 里存两份（`nodes.py:2293` 和 `2302`），
同一个 JS 被服务两次 → 扩展注册两遍。

**建议：只用 `WEB_DIRECTORY`，`pyproject.toml` 里不写 `web`。** 本骨架就是这么做的。

## 5. pyproject.toml 是可选的

没有 `pyproject.toml` 时，`extract_node_configuration()` 会用目录名造一个默认配置
（`comfy_config/config_parser.py:103-109`），不报警告。

有但写错时，异常被捕获后只打一条警告，插件照样能加载（`nodes.py:2296-2297`）：

```
Unable to parse pyproject.toml due to lack dependency pydantic-settings, please run 'pip install -r requirements.txt'
```

这条警告挺误导人的——它几乎总是格式问题，不是缺依赖。

## 6. 怎么确认插件真的加载了

启动日志末尾一定有这一段（`nodes.py:2399-2407`）：

```
Import times for custom nodes:
   0.1 seconds: H:\~~~aki-v3.2\ComfyUI\custom_nodes\Feng
   1.3 seconds (IMPORT FAILED): H:\~~~aki-v3.2\ComfyUI\custom_nodes\ComfyUI-GGUF
```

- 没有 `(IMPORT FAILED)` 而只有秒数 = 插件导入成功；
- 导入成功 **不等于** 节点注册成功（比如 V3 分支里 `get_node_list` 返回了空列表）；
- 界面上看：`添加节点` 菜单里的分类来自 `io.Schema(category="Feng/示例")`。

## 7. 改了代码什么时候生效

| 改动 | 生效方式 |
| --- | --- |
| `.py` 任何改动 | **重启 ComfyUI** |
| `web/` 下的 `.js` | 浏览器 `F5` 刷新（有时要 `Ctrl+F5` 清缓存） |
| 新增插件目录 | 重启 ComfyUI |

前端扩展有 module 缓存，改了 JS 但界面没反应时，`Ctrl+F5` 或开无痕窗口验证一次。
