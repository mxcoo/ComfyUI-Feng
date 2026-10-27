# 06 · 依赖与发布

自己用的话，前两节就够了。想给别人安装再往下看。

## 1. 第三方依赖

写进 `requirements.txt`，一行一个，标准 pip 格式：

```
numpy>=1.24
opencv-python-headless>=4.8
```

ComfyUI 启动时不会自动装，用户需要自己 `pip install -r requirements.txt`；
ComfyUI-Manager 和 `comfy node install` 会自动处理这个文件。

注意：

- **能不装就不装。** torch、numpy、Pillow、safetensors、aiohttp 这些 ComfyUI 已经带了，
  重复声明版本约束容易和主程序冲突。
- 需要 GPU 相关库（`triton`、`xformers` 之类）时，最好别硬性写进依赖，
  ComfyUI 的 torch 版本是定制过的，pip 解析容易把 torch 换掉。
- 依赖装不上时，插件导入会失败并在日志里显示 `(IMPORT FAILED)`。

## 2. `pyproject.toml`

本地开发可以完全没有这个文件（`comfy_config/config_parser.py:103-109` 会用目录名兜底）。
要发布到 Registry 就必须有：

```toml
[project]
name = "feng"                        # Registry 上的安装 ID，全局唯一、小写
description = "ComfyUI 自定义节点示例插件"
version = "0.1.0"                    # 每次发布必须递增
requires-python = ">=3.10"
dependencies = []
classifiers = [
    "Operating System :: OS Independent",
]

[project.urls]
Repository = "https://github.com/your-name/Feng"

[tool.comfy]
PublisherId = "your-publisher-id"
DisplayName = "Feng"
Icon = ""
```

`[tool.comfy]` 支持的字段来自 `comfy_config/types.py:47-54`：

| 字段 | 说明 |
| --- | --- |
| `PublisherId` | 发布者 ID，首次发布时在 Registry 上注册得到 |
| `DisplayName` | 在 Manager / 网站上的显示名 |
| `Icon` | 图标 URL |
| `banner_url` | 详情页横幅图 URL |
| `Models` | 声明依赖的模型文件（`location` + `model_url`），Manager 会提示下载 |
| `includes` | 打包时要包含的额外路径 |
| `web` | 前端目录 —— **已经用了 `WEB_DIRECTORY` 就不要写这个**，会重复加载 |

另外还有一个不在上面表里、被单独读取的键（`config_parser.py:125`）：

```toml
[tool.comfy]
requires-comfyui = ">=0.4.0"
```

`project.classifiers` 会被解析成支持的系统与加速器（`config_parser.py:14-48`），
有效值只有这几组：

```
Operating System :: OS Independent
Operating System :: Microsoft :: Windows
Operating System :: POSIX
Operating System :: MacOS
Environment :: GPU :: NVIDIA CUDA
Environment :: GPU :: AMD ROCm
Environment :: GPU :: Intel Arc
Environment :: NPU :: Huawei Ascend
Environment :: GPU :: Apple Metal
```

## 3. 发布到 ComfyUI Registry

需要 `comfy-cli`：

```powershell
& 'H:\~~~aki-v3.2\python\python.exe' -m pip install comfy-cli

# 首次：在 https://comfyregistry.org 注册 publisher，拿到 PublisherId 填进 pyproject.toml
# 然后登录，token 会存在本地配置里
comfy --skip-prompt node publish --token <你的 token>
```

发布成功后别人就能：

```powershell
comfy node install feng
```

或直接在 ComfyUI-Manager 里搜索安装。

发布前的检查清单（按顺序，任一项不对都会被拒或装坏）：

1. `[project].version` 比上一次大；
2. `[project].name` 与 Registry 上已有的 ID 不冲突，且只用小写字母/数字/短横线；
3. `PublisherId` 与 token 对应；
4. `requirements.txt` 里没有和 ComfyUI 冲突的硬性版本约束；
5. 仓库根目录有 `README.md` 和 `LICENSE`；
6. 前端目录只通过一种方式声明（`WEB_DIRECTORY` **或** `[tool.comfy] web`）；
7. 本地先用 `tools/check_load.py` 和真实启动各验一次。

## 4. ComfyUI-Manager 收录

Manager 主要通过 Registry 获取插件列表，走上面的 `comfy node publish` 就会自动收录。
不发布 Registry 的话，用户只能用 `git clone` 装：

```powershell
cd H:\~~~aki-v3.2\ComfyUI\custom_nodes
git clone https://github.com/your-name/Feng.git
```

这种情况下建议写一个 `install.py`（Manager 会在安装后执行），
把依赖安装、模型下载等步骤自动化。

## 5. 版本号的实用建议

| 改动 | 版本 |
| --- | --- |
| 修 bug、改文案 | 0.1.0 → 0.1.1 |
| 加节点、加输入（向后兼容） | 0.1.1 → 0.2.0 |
| 改节点 ID、删输入、改语义 | 0.2.0 → 1.0.0，并在 README 写迁移说明 |

用户的工作流里存的是**节点 ID 和输入 ID**。改这两个名字会让别人的工作流直接报错，
所以宁可新增一个节点，也不要改老节点的 ID。
真要改，用 `io.NodeReplace`（`_io.py:2574`）做节点替换映射，详见源码。
