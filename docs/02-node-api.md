# 02 · 节点 API（V3）

本机 0.42.3 用 V3 API。全部定义在 `H:\~~~aki-v3.2\ComfyUI\comfy_api\latest\_io.py`（2700+ 行），
本文是它的用法说明；有疑问时以源码为准，行号随版本可能漂移。

## 1. 最小可用节点

```python
from comfy_api.latest import io


class MyNode(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="MyNode",
            display_name="我的节点",
            category="MyPlugin",
            inputs=[
                io.Image.Input("image"),
                io.Int.Input("steps", default=20, min=1, max=100, step=1),
            ],
            outputs=[io.Image.Output()],
        )

    @classmethod
    def execute(cls, image, steps) -> io.NodeOutput:
        return io.NodeOutput(image)
```

三个要点：

1. **两个方法都是 `@classmethod`**，`define_schema` 和 `execute` 是抽象方法，不实现没法实例化
   （`_io.py:2465-2475`）；
2. `execute` 的参数名必须和 `inputs` 里的 `id` 一一对应（多一个少一个都会报错）；
3. 输出**必须**用 `io.NodeOutput(...)` 包一层，不能直接返回张量。

## 2. `io.ComfyNode` 可以覆写的方法

| 方法 | 必填 | 作用 |
| --- | --- | --- |
| `define_schema(cls) -> io.Schema` | ✅ | 声明节点长什么样 |
| `execute(cls, **kwargs) -> io.NodeOutput` | ✅ | 干活 |
| `validate_inputs(cls, **kwargs) -> bool \| str` | ❌ | 执行前校验，等价 V1 的 `VALIDATE_INPUTS`（`_io.py:2478-2480`） |
| `fingerprint_inputs(cls, **kwargs) -> Any` | ❌ | 等价 V1 的 `IS_CHANGED`（`_io.py:2483-2485`） |
| `check_lazy_status(cls, **kwargs) -> list[str]` | ❌ | 懒执行，返回"接下来需要求值哪些输入"（`_io.py:2488-2501`） |

基类里的 `GET_BASE_CLASS()` 被标了 `@final`，**不要覆写**（`_io.py:2503-2507`）。

## 3. `io.Schema` 全部字段

来自 `_io.py:1841-1908`。前三个是主要字段，后面按需用。

### 基本字段

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `node_id` | `str` | **必填** | 全局唯一。自定义插件**建议加前缀**，否则和内置节点重名时会被内置节点占据 |
| `display_name` | `str` | `None` | 界面上显示的名字；为 `None` 时显示 `node_id` |
| `category` | `str` | `"sd"` | 添加节点菜单里的分类，`/` 可以分组：`"Feng/示例"` |
| `description` | `str` | `""` | 鼠标悬停时的说明 |
| `inputs` | `list[Input]` | `[]` | 输入列表 |
| `outputs` | `list[Output]` | `[]` | 输出列表 |
| `hidden` | `list[Hidden]` | `[]` | 需要框架注入的隐藏参数，见第 7 节 |
| `search_aliases` | `list[str]` | `[]` | 搜索别名，方便原来的名字/英文缩写也能搜到 |

### 行为开关

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `is_output_node` | `False` | 标记为输出节点。**只有连到输出节点的分支才会被执行**，所以"保存/预览"类节点必须设 `True` |
| `not_idempotent` | `False` | 相同的输入在另一个节点上也不复用缓存结果 |
| `enable_expand` | `False` | 允许 `NodeOutput(expand=...)` 做子图展开 |
| `accept_all_inputs` | `False` | prompt 里没在 schema 声明的输入也当 kwargs 传进来 |
| `is_input_list` | `False` | 等价 V1 的 `INPUT_IS_LIST`：同类输入合并成 list 一次传入 |
| `has_intermediate_output` | `False` | 有中间产物的交互式节点（裁剪、绘制）：UI 结果会缓存并在刷新后重新下发，但**不会**自动进入执行队列 |

### 标注 / 治理字段

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `is_deprecated` | `False` | 标记废弃，提示用户换节点 |
| `is_experimental` | `False` | 标记实验性，可能随时变 |
| `is_dev_only` | `False` | 仅在开发者模式可见 |
| `is_api_node` | `False` | Comfy 官方 API 节点用，会额外注入鉴权 hidden 参数 |
| `price_badge` | `None` | API 节点的价格角标声明 |
| `essentials_category` | `None` | Essentials 标签页下的分类 |
| `loop_boundary` | `None` | `"start"` / `"end"`，循环结构的校验边界 |

## 4. 输入：三种基类

不同的 `io.X.Input` 继承自不同的基类，**能吃哪些参数取决于基类**。

### 4.1 只有插槽的输入（`io.Input`，`_io.py:160-173`）

用于 `IMAGE`/`LATENT`/`MASK`/`MODEL`/`VAE`/`CLIP`/`CONDITIONING` 等"只能连线的数据"：

```python
io.Image.Input(
    "image",            # id，必须和 execute 参数名一致
    display_name=None,  # 界面上显示的名字
    optional=False,     # True 时可以不连（execute 里给默认值 None）
    tooltip=None,
    lazy=None,          # True 时参与懒执行
    extra_dict=None,    # 额外塞进 V1 input dict 的字段，高级用法
    raw_link=None,
    advanced=None,      # True 时收进"高级"折叠区
)
```

### 4.2 带控件的输入（`io.WidgetInput`，`_io.py:191-213`）

在上面全部参数之外，多了这些：

```python
default=None,        # 控件默认值
socketless=None,     # True 时只显示控件，不给输入插槽
widget_type=None,
force_input=None,    # True 时强制显示插槽，即使有控件
```

`Int` / `Float` / `String` / `Boolean` / `Combo` 用的都是这一套，另外各自还有专属参数，
见 [03-io-types.md](03-io-types.md)。

### 4.3 可选输入

```python
io.Mask.Input("mask", optional=True)

@classmethod
def execute(cls, image, mask=None) -> io.NodeOutput:   # 注意这里要有默认值
    ...
```

`optional=True` 只影响界面能不能不连；**`execute` 的签名也必须给默认值**，否则没连线时会报参数缺失。

## 5. 输出

### 5.1 `io.X.Output` 的参数（`_io.py:216-233`）

```python
io.Image.Output(
    id=None,               # 一般不用管，Schema.finalize 会自动补
    display_name=None,     # 输出插槽上显示的名字
    tooltip=None,
    is_output_list=False,  # 等价 V1 的 OUTPUT_IS_LIST
)
```

### 5.2 多输出

```python
outputs=[io.Image.Output(display_name="image"), io.Mask.Output(display_name="mask")]

return io.NodeOutput(image, mask)   # 顺序必须和 outputs 一致
```

### 5.3 `io.NodeOutput` 的完整签名（`_io.py:2514`）

```python
io.NodeOutput(
    *args,                  # 按 outputs 顺序给的值
    ui=None,                # 给前端的预览数据，见第 8 节
    expand=None,            # 需要 enable_expand=True 才能用
    block_execution=None,   # 传字符串则中断整条流程，字符串作为原因
)
```

- 没有输出时写 `io.NodeOutput()`；
- 只有一个输出但也别忘包一层：`return io.NodeOutput(image)`；
- `block_execution` 是"主动让整个队列停下"的唯一干净方式，慎用。

## 6. 缓存、重执行与懒执行

### 缓存与 `fingerprint_inputs`

ComfyUI 会按输入缓存节点结果，**输入没变就不重跑**。
有些节点的输入看起来没变，但结果应该变（典型：读文件的 LoadImage、抓取网页、读时间），
这时实现 `fingerprint_inputs`，返回一个"指纹"值，指纹变了就重跑：

```python
import hashlib, os, folder_paths

@classmethod
def fingerprint_inputs(cls, image_path):
    path = folder_paths.get_full_path_or_raise("input", image_path)
    st = os.stat(path)
    return f"{st.st_mtime_ns}:{st.st_size}"
```

等价于 V1 的 `IS_CHANGED`（`_io.py:2483-2485`）。
**别在里面做重活**——它每次执行都会跑，比 `execute` 还频繁。

### 懒执行

把某个输入标 `lazy=True`，然后实现 `check_lazy_status`：

```python
io.String.Input("prompt", multiline=True, lazy=True),
io.Int.Input("seed", default=0, lazy=True),

@classmethod
def check_lazy_status(cls, prompt, seed, mode):
    # 返回值里列出"我现在还需要哪些输入"，没列出的不会被求值
    if mode == "random":
        return ["seed"]
    return []
```

语义（`_io.py:2488-2501`）：拿到全部输入名，**还没求值的输入值为 `None`**（`is_input_list` 时是 `(None,)`），
返回列表后框架会去求值，然后**再次**调用本函数，直到返回空列表。
典型用途：根据下拉框决定要不要连那个昂贵的上游节点。

## 7. 隐藏参数 `hidden`

需要框架注入的信息，放进 `hidden` 列表（枚举见 `_io.py:1725-1744`）：

```python
io.Schema(
    ...,
    hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
)

@classmethod
def execute(cls, **kwargs):
    # hidden 参数以关键字参数形式传入，名字是全大写
    ...
```

| 枚举 | 注入值 |
| --- | --- |
| `io.Hidden.unique_id` | 节点在前端图里的 id |
| `io.Hidden.prompt` | 本次提交的完整 prompt |
| `io.Hidden.extra_pnginfo` | 会写进 PNG 元数据的额外信息 |
| `io.Hidden.dynprompt` | 执行期可变的 prompt（节点展开时用） |
| `io.Hidden.auth_token_comfy_org` | 登录 Comfy 账号后的 token |
| `io.Hidden.api_key_comfy_org` | API Key |
| `io.Hidden.comfy_usage_source` | 调用来源 |
| `io.Hidden.execution_list` | ⚠️ 明确标注"核心内部用、即将移除、不要用" |

**注意**：`is_output_node=True` 时，`prompt` 和 `extra_pnginfo` 会被自动加上（`_io.py:1956-1960`），
不用手动声明。

## 8. 给前端返回数据（UI 输出）

除了插槽输出，还可以附带一份只给界面看的 `ui` 数据。`execute` 里这样写：

```python
from comfy_api.latest import io, ui

return io.NodeOutput(image, ui=ui.PreviewImage(image))
```

可用的 UI 类型（`comfy_api/latest/_ui.py`）：

| 类型 | 用途 |
| --- | --- |
| `ui.PreviewImage(image, animated=False)` | 在节点上显示预览图（自动存到 temp 目录） |
| `ui.PreviewMask(mask)` | 预览遮罩 |
| `ui.PreviewAudio(audio)` | 预览音频 |
| `ui.PreviewVideo(values)` | 预览视频 |
| `ui.PreviewText(text)` | 节点上显示一段文字 |
| `ui.SavedImages` / `ui.SavedAudios` / `ui.Saved3DModels` | 保存类节点的结果列表 |

多个 UI 输出用字典：

```python
ui={"images": [...], "text": ["一行文字"]}
```

前端侧在 `onExecuted(message)` 里收到，配合见 [04-frontend.md](04-frontend.md)。

## 9. 一个完整参考

ComfyUI 自带的规范写法，比任何教程都可靠：

```text
H:\~~~aki-v3.2\ComfyUI\comfy_extras\nodes_attention_multiply.py     V3，结构最清晰
H:\~~~aki-v3.2\ComfyUI\custom_nodes\example_node.py.example         官方示例，含 lazy/fingerprint
H:\~~~aki-v3.2\ComfyUI\comfy_extras\nodes_*.py                       全部是 V3
```

## 10. V1 / V3 对照表

读老插件代码时用：

| V1（老写法，仍然支持） | V3（本机推荐） |
| --- | --- |
| `INPUT_TYPES()` 返回 `{"required": {...}}` | `define_schema().inputs` |
| `RETURN_TYPES` | `outputs=[io.X.Output()]` |
| `RETURN_NAMES` | `Output(display_name="...")` |
| `FUNCTION = "f"` 指向方法 | 固定方法名 `execute` |
| `CATEGORY` | `Schema(category=...)` |
| `OUTPUT_NODE = True` | `Schema(is_output_node=True)` |
| `IS_CHANGED` | `fingerprint_inputs` |
| `VALIDATE_INPUTS` | `validate_inputs` |
| `INPUT_IS_LIST` | `Schema(is_input_list=True)` |
| `OUTPUT_IS_LIST` | `Output(is_output_list=True)` |
| `INPUT_TYPES` 里的 `"hidden": {...}` | `Schema(hidden=[io.Hidden.prompt, ...])` |
| `DEPRECATED` / `EXPERIMENTAL` | `is_deprecated` / `is_experimental` |
| `NODE_CLASS_MAPPINGS` | `comfy_entrypoint()` → `get_node_list()` |

两套机制在框架内部会被翻译成同一份 `NodeInfoV1`（`_io.py:1966-2020`），所以**混用写法的插件可以共存**，
只是同一个 `__init__.py` 里不要让两套入口同时出现。
