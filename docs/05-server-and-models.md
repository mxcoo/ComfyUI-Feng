# 05 · 服务端路由、进度与模型目录

节点需要"跟界面单独通信"或"读写文件"时看这篇。

## 1. 加一个 HTTP 路由

ComfyUI 的后端是 aiohttp，挂在 `PromptServer.instance.routes` 上。
官方示例 `example_node.py.example:112-118` 就是最标准的写法：

```python
from aiohttp import web
from server import PromptServer

@PromptServer.instance.routes.get("/feng/hello")
async def feng_hello(request):
    name = request.query.get("name", "world")
    return web.json_response({"message": f"hello {name}"})
```

要点：

| 事项 | 说明 |
| --- | --- |
| 写在哪 | `__init__.py` 顶层（导入时注册），或 `on_load()` 里；两者都在 `main.py:616` 的 `add_routes()` 之前 |
| 路径前缀 | **务必加插件前缀**，如 `/feng/...`。裸 `/clear`、`/upload` 这种会和核心路由撞车，且后注册的会被忽略或覆盖 |
| 日志 | 路由处理函数里的异常不会自动上报，自己 `try` 并返回错误 JSON |
| 返回 | 一律 `web.json_response(...)` / `web.Response(...)` |

前端调用：

```javascript
import { api } from "../../../scripts/api.js";

const resp = await api.fetchApi("/feng/hello?name=abc");
const data = await resp.json();
```

`api.fetchApi` 会自动带上用户鉴权和 basePath，**不要用裸 `fetch("/feng/hello")`**，
否则在多用户或子路径部署下会 404。

## 2. 进度条

长任务一定要报进度，否则用户会以为卡死。

### 节点内最常用

```python
import comfy.utils

@classmethod
def execute(cls, items) -> io.NodeOutput:
    pbar = comfy.utils.ProgressBar(len(items))   # comfy/utils.py:1306
    for item in items:
        ...
        pbar.update(1)                            # comfy/utils.py:1347
    return io.NodeOutput(...)
```

`ProgressBar(total, node_id=None)` 会自动对应到当前正在执行的节点（`comfy/utils.py:1307`）。
需要显示预览图时用 `pbar.update_absolute(value, total, preview=img)`（`comfy/utils.py:1316`）。

### 给节点下方推一行文字

```python
from server import PromptServer

PromptServer.instance.send_progress_text("正在下载模型...", node_id)
```

`send_progress_text(text, node_id, sid=None)`（`server.py:1581`）。`node_id` 从 `io.Hidden.unique_id` 拿：

```python
io.Schema(..., hidden=[io.Hidden.unique_id])

@classmethod
def execute(cls, unique_id, **kwargs):
    PromptServer.instance.send_progress_text("处理中", unique_id)
```

## 3. 向前端主动推事件

后端：

```python
PromptServer.instance.send_sync("feng-update", {"percent": 42, "text": "ok"})
```

`send_sync(event, data, sid=None)`（`server.py:1488`），广播给所有已连接页面。

前端：

```javascript
import { api } from "../../../scripts/api.js";

api.addEventListener("feng-update", (e) => {
  console.log(e.detail.percent, e.detail.text);
});
```

事件名同样建议加插件前缀。

## 4. 模型与文件目录（`folder_paths`）

**永远不要自己拼 `models/checkpoints` 这种路径**——用户可能配了 `extra_model_paths.yaml`，
模型放在别的盘。统一走 `folder_paths`：

| 函数 | 作用 | 位置 |
| --- | --- | --- |
| `folder_paths.get_filename_list("checkpoints")` | 列出某个类别下的文件名，适合做下拉框 options | `folder_paths.py:519` |
| `folder_paths.get_folder_paths("checkpoints")` | 该类别的所有根目录 | `folder_paths.py:400` |
| `folder_paths.get_full_path("checkpoints", name)` | 由文件名得到绝对路径，找不到返回 `None` | `folder_paths.py:450` |
| `folder_paths.get_full_path_or_raise(...)` | 同上，找不到抛异常 | `folder_paths.py:470` |
| `folder_paths.get_input_directory()` | `input/` 目录 | `folder_paths.py:147` |
| `folder_paths.get_output_directory()` | `output/` 目录 | `folder_paths.py:139` |
| `folder_paths.get_temp_directory()` | `temp/` 目录 | `folder_paths.py:143` |
| `folder_paths.get_save_image_path(prefix, output_dir, w, h)` | 生成不重名的保存路径，返回 `(目录, 文件名, 序号, 子目录, 前缀)` | `folder_paths.py:529` |

### 下拉框 + 安全读取

```python
import folder_paths

class FengLoadSomething(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="FengLoadSomething",
            inputs=[
                # options 在类定义时就要求值，所以用默认参数懒算或模块级缓存
                io.Combo.Input("model_name", options=[]),
            ],
            outputs=[io.AnyType.Output()],
        )

    @classmethod
    def execute(cls, model_name) -> io.NodeOutput:
        # 关键：传入的值来自前端，必须重新解析，不能直接拼路径
        path = folder_paths.get_full_path_or_raise("checkpoints", model_name)
        ...
```

⚠️ **安全边界**：combo 的 options 只是"界面上能选什么"，用户可以手工改工作流 JSON 传任意字符串。
凡是用作文件名/路径的值，必须在读取处用 `get_full_path*` 再校验一次（它内部有 containment 检查），
不要 `os.path.join(models_dir, user_value)`。

### 新增一个模型类别

```python
# 在 __init__.py 或 on_load() 里，加载时注册一次
folder_paths.add_model_folder_path(
    "feng_models",
    os.path.join(folder_paths.models_dir, "feng"),
    is_default=True,
)
```

之后就能用 `get_filename_list("feng_models")`。注册必须在节点执行前完成——
放模块顶层或 `on_load()` 都可以。

## 5. 保存文件

```python
import folder_paths
import numpy as np
from PIL import Image

output_dir = folder_paths.get_output_directory()
full_folder, filename, counter, subfolder, prefix = folder_paths.get_save_image_path(
    "Feng/result", output_dir, width, height
)
os.makedirs(full_folder, exist_ok=True)
Image.fromarray((image[0].cpu().numpy() * 255).astype(np.uint8)).save(
    os.path.join(full_folder, f"{filename}_{counter:05}_.png")
)
```

想同时输出元数据，用 V3 的 `ui.SavedImages`，前端会显示成结果画廊。

## 6. 长任务与异步注意事项

- ComfyUI 的节点 `execute` 是**同步**运行在 worker 线程里的，别在里面 `asyncio.run()`
  去跑协程（会踩到已有事件循环）。要发请求用 `requests` 这类同步库。
- 阻塞时间长的任务记得 `pbar.update()`，否则队列看起来像死了。
- 需要后台常驻任务，在 `on_load()` 里用 `threading.Thread(daemon=True)` 起，
  不要阻塞 `on_load()` 本身——它被 `await` 着，卡住会导致整个插件加载超时。

## 7. 下载模型（需要用户主动触发）

本插件如果要下载模型，遵守两条：

1. **只由用户操作触发**，不要在导入时、启动时、后台静默下载；
2. 只下载用户明确要求的那个文件，不要附带上报使用数据、设备信息、统计信息。

下载目标目录用 `folder_paths.get_folder_paths(...)` 或自己注册的类别，
不要把文件写到插件目录里（更新插件会丢）。
