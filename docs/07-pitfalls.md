# 07 · 常见坑与排错

按"现象 → 原因 → 解决"写，先收藏这一页，遇到问题直接搜现象。

## 排错三步走

```powershell
# 1. 插件能不能加载（最快，2 秒）
cd H:\~~~aki-v3.2\ComfyUI\custom_nodes\Feng
& 'H:\~~~aki-v3.2\python\python.exe' tools\check_load.py

# 2. 语法有没有错
& 'H:\~~~aki-v3.2\python\python.exe' -m py_compile __init__.py nodes.py

# 3. 启动日志里有没有 IMPORT FAILED（要真启动一次）
#    日志里搜 "Import times for custom nodes"
```

---

## 坑 1：`--quick-test-for-ci` 永远返回 0，看不出失败

**现象**：跑完 `--quick-test-for-ci`，退出码 0，以为没问题，结果界面上没有节点。

**原因**：`main.py:621-622` 在加载完插件后无条件 `exit(0)`，**导入失败也返回 0**。

**解决**：只看日志，不看退出码：

```powershell
cd H:\~~~aki-v3.2\ComfyUI
& 'H:\~~~aki-v3.2\python\python.exe' -s main.py --windows-standalone-build --disable-auto-launch --quick-test-for-ci *>&1 |
  Select-String 'Import times|IMPORT FAILED|Feng'
```

**本机特别注意**：这套环境装了 50 多个插件，实测完整 `--quick-test-for-ci`
会在导入某个第三方插件时**卡住十几分钟**（日志停在 `No OpenGL_accelerate module loaded`）。
所以日常验证请用 `tools/check_load.py`，它只加载本插件，秒出结果。

---

## 坑 2：节点写了但界面里没有（不报错）

按可能性从高到低排查：

| 检查 | 说明 |
| --- | --- |
| 有没有加进 `get_node_list()` 的返回列表 | 最容易忘记的一步 |
| `__init__.py` 里是不是同时有 `NODE_CLASS_MAPPINGS` | **有它就会走 V1 分支，`comfy_entrypoint` 被完全忽略**（`nodes.py:2305-2314`），且不报警告 |
| `node_id` 是否和内置节点重名 | 重名时加载器把你当"已存在"跳过（`nodes.py:2367`、`2396`），加前缀即可 |
| 分类写对了吗 | 添加节点菜单里按 `category` 分组，`"Feng/示例"` 在 `Feng` 下的 `示例` 子菜单 |
| 是不是被 `.disabled` 了 | 目录名或文件名以 `.disabled` 结尾会被跳过（`nodes.py:2379`） |
| 有没有真的重启 | Python 改动不热重载 |

---

## 坑 3：`execute` 里报 `KeyError` 或参数不匹配

**原因**：`execute` 的形参名必须和 `inputs` 里的 `id` **完全一致**。

```python
inputs=[io.Int.Input("steps", ...)]

@classmethod
def execute(cls, step) -> io.NodeOutput:   # ❌ 少个 s
```

---

## 坑 4：可选输入没连线时报 `TypeError: missing argument`

```python
io.Mask.Input("mask", optional=True)        # ✅ 界面可以不连

@classmethod
def execute(cls, image, mask=None) -> io.NodeOutput:   # ✅ 这里也必须给默认值
```

`optional=True` 只管界面，**函数签名要自己兜底**。

---

## 坑 5：节点跑不出结果，也不报错

**原因**：ComfyUI 只执行"能连到输出节点的分支"。你的节点如果没接 `SaveImage`/`PreviewImage`
这类输出节点，它根本不会被执行。

**解决**：接一个输出节点；或者这个节点本身就是"终点"（保存/预览），
那就在 schema 里设 `is_output_node=True`。

```python
io.Schema(..., is_output_node=True)   # 等价 V1 的 OUTPUT_NODE = True
```

---

## 坑 6：前端扩展加载了两次 / 改了不生效

| 现象 | 原因 |
| --- | --- |
| 控制台日志出现两次 | `pyproject.toml` 里有 `[tool.comfy] web`，和 `WEB_DIRECTORY` 重复注册（`nodes.py:2293` 和 `2302` 各存一份） |
| `Failed to fetch dynamically imported module` | import 相对路径层级错了，见 [04-frontend.md](04-frontend.md#2-import-路径数清楚层级) |
| 改了 JS 没反应 | 前端有 module 缓存，`Ctrl+F5` 强刷 |
| `web/` 下的工具 JS 也报错 | 该目录下**所有** `.js` 都会被递归当扩展加载（`server.py:428`），工具文件要么移走，要么保证顶层无副作用 |

---

## 坑 7：Tracing 到 `execute` 里张量形状对不上

ComfyUI 的图像/遮罩约定是固定的，别按自己习惯来：

| 类型 | 形状 | 取值范围 |
| --- | --- | --- |
| IMAGE | `[B, H, W, C]`，C 通常 3，可能 4 | float32，**0.0–1.0**（不是 0–255） |
| MASK | `[B, H, W]` | float32，0–1 |

常见错误：

```python
image[0]                        # ❌ 假设 batch=1，上游 rebatch 后会挂
image[:, :, :, :3]              # ❌ 假设一定是 3 通道
image * 255                     # 转 uint8 时才乘 255，中间计算保持 0-1
mask.unsqueeze(-1)              # ✅ 让 MASK 能广播到 IMAGE
```

---

## 坑 8：`ValueError: The truth value of a Tensor is ambiguous`

```python
if mask:            # ❌ 张量不能直接当布尔用
if mask is not None: # ✅
```

---

## 坑 9：ComfyUI 启动变慢或卡死（不是本插件的问题也要知道）

**原因**：插件在 `import` 阶段做重活——扫描全部模型文件、加载大模型、请求网络、下载依赖。

**规则**：

- 模块顶层只做"定义"，不做"执行"；
- 初始化放 `on_load()`，且要快；
- 真的需要联网/下载，放成节点里由用户点按钮触发。

**排查方法**：看启动日志的 `Import times for custom nodes`，哪一行秒数大就是它。

---

## 坑 10：控制台中文乱码

Python 输出中文在 GBK 控制台下会变乱码，且日志文件里可能写不进去。

**解决**：脚本开头加

```python
import sys
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
```

或者设环境变量 `PYTHONUTF8=1`。本插件的 `tools/check_load.py` 已经处理了。

---

## 坑 11：`ProgressBar` 不更新，用户以为卡死

```python
pbar = comfy.utils.ProgressBar(total)
for i, x in enumerate(items):
    do_work(x)
    pbar.update(1)     # 别忘，且要在循环里
```

一次循环跑很久的话，每步都 update；否则进度条会从 0 直接跳到 100。

---

## 坑 12：把用户传进来的文件名直接拼路径

```python
path = os.path.join(folder_paths.models_dir, model_name)   # ❌ 可以传 ../../ 越界
path = folder_paths.get_full_path_or_raise("checkpoints", model_name)   # ✅
```

combo 的 options 只是界面提示，工作流 JSON 里的值是用户可控的。
**所有作为路径/folder/后缀用的值，都要在读取处重新解析和校验。**

---

## 坑 13：`NodeOutput` 返回格式错

```python
return image                        # ❌ 必须是 NodeOutput
return (image, mask)                # ❌
return io.NodeOutput(image, mask)   # ✅ 顺序和 outputs 一致
return io.NodeOutput()              # ✅ 没有输出时
```

`NodeOutput` 的 `ui=` 是给前端看的，**不占 outputs 位置**，别混在一起数。

---

## 坑 14：一个节点只返回第一个结果 / 多输出错位

`outputs` 列表顺序 = `NodeOutput(*args)` 的顺序 = 界面上插槽的顺序。
中间插入新的 `Output` 会让老工作流的连线错位，所以**新输出只能往后加**。

---

## 坑 15：改了代码报 `ModuleNotFoundError`

自建的子模块要用**相对导入**：

```python
from .utils import helper     # ✅
from utils import helper      # ❌ 会去 sys.path 里找，找不到
```

插件是按包加载的（`nodes.py:2266-2276`），相对导入没问题。

---

## 坑 16：`Combo` 没有默认值导致节点加载报错

```python
io.Combo.Input("mode", options=["a", "b"])              # default 为 None
io.Combo.Input("mode", options=["a", "b"], default="a") # ✅ 更稳
```

另外 `min`/`max` 的类型要和输入类型一致：`io.Int` 用 `int`，`io.Float` 用 `float`，
混用会被前端当字符串处理，滑条行为会怪。

---

## 坑 17：工作流分享给别人后报"节点未找到"

**原因**：节点 ID 或插件 ID 改了。

- 节点 ID 一旦发布就当 API 看待，只增不改；
- 真的要重命名，用 `io.NodeReplace` 做映射（`_io.py:2574`），让老工作流自动迁移。

---

## 坑 18：改了 Python 但界面没变化

Python **不会**热重载。任何 `.py` 改动（包括 `nodes.py` 里的常量、默认值）都要重启 ComfyUI。
只有 `web/` 下的 JS 是刷新浏览器就生效。

---

## 坑 19：`requirements.txt` 写了但别人装不上

- 固定死版本（`torch==2.5.0`）会把 ComfyUI 的 torch 换掉，直接导致整个环境崩；
- 需要可选依赖时，在代码里 `try: import xxx` 并在节点里给出清晰提示，而不是让插件导入失败。

---

## 坑 20：依赖装错 Python

本机 ComfyUI 用的是 **`H:\~~~aki-v3.2\python\python.exe`**，不是系统 Python
（系统的 `python` 命令在这里甚至不存在）。装包一定要用完整路径：

```powershell
& 'H:\~~~aki-v3.2\python\python.exe' -m pip install <包名>
```

用错解释器装包，症状是"明明装了却 `ModuleNotFoundError`"。
