# 03 · `io.*` 类型速查

用法统一是 `io.类型名.Input(...)` / `io.类型名.Output(...)`。
能用的参数取决于它继承哪个基类，基类说明见 [02-node-api.md](02-node-api.md#4-输入三种基类)。

> 类型名和 `io_type` 字符串不是一回事：`io.Vae` 的 io_type 是 `"VAE"`。
> 节点之间靠 io_type 匹配连线，所以**同类数据必须用同一个 `io.*` 类型**。

## 1. 基础标量（都带控件）

### `io.Int.Input`

```python
io.Int.Input(
    "steps", display_name="步数", default=20, min=1, max=100, step=1,
    control_after_generate=None,   # 生成后自动变化：True 或 io.ControlAfterGenerate.increment
    display_mode=io.NumberDisplay.slider,   # number / slider / gradient_slider
    optional=False, tooltip=None, lazy=None, advanced=None,
    socketless=None, force_input=None,
)
```

### `io.Float.Input`

```python
io.Float.Input(
    "strength", default=1.0, min=0.0, max=2.0, step=0.01,
    round=0.001,                 # 显示精度，默认跟随 step；False 关闭取整
    display_mode=io.NumberDisplay.slider,
    gradient_stops=None,         # gradient_slider 模式下的色带
    ...其余同上
)
```

### `io.String.Input`

```python
io.String.Input(
    "text", default="", multiline=True,   # multiline=True 就是 ClipTextEncode 那种大框
    placeholder=None, dynamic_prompts=None,
    ...其余同上
)
```

### `io.Boolean.Input`

```python
io.Boolean.Input("enabled", default=True, label_on="开", label_off="关", ...)
```

### `io.Combo.Input`（下拉框）

```python
io.Combo.Input(
    "mode",
    options=["invert", "grayscale", "brighten"],   # 也可以是 Enum 类
    default="invert",
    control_after_generate=None,
)
```

三个实用扩展参数：

```python
# 1. 带上传按钮 + 可选文件列表（这就是新版 LoadImage 的做法）
io.Combo.Input(
    "image",
    options=[],
    upload=io.UploadType.image,          # image / audio / video / model
    image_folder=io.FolderType.input,    # input / output / temp
)

# 2. 远程列表，前端自动带刷新按钮
io.Combo.Input("model_name", options=[], remote=io.RemoteOptions(route="/my/models", refresh_button=True))
```

> ⚠️ `upload` 提供的只是"上传到哪里"的约定，**真正校验文件名仍是节点自己的责任**，
> 必须用 `folder_paths` 解析，见 [05-server-and-models.md](05-server-and-models.md)。

### `io.MultiCombo.Input`（多选）

```python
io.MultiCombo.Input("tags", options=["a", "b", "c"])   # execute 里收到 list[str]
```

## 2. 图像 / 视频 / 音频

| 类型 | Python 值 | 约定 |
| --- | --- | --- |
| `io.Image` | `torch.Tensor` | `[B, H, W, C]`，float32，范围 **0.0–1.0**；`C` 通常是 3，也可能 4 |
| `io.Mask` | `torch.Tensor` | `[B, H, W]`，float32，0–1 |
| `io.Latent` | `dict` | 至少含 `{"samples": Tensor}`，形状随模型家族不同 |
| `io.Audio` | `dict` | `{"waveform": Tensor[B,C,T], "sample_rate": int}` |
| `io.Video` | 见 `comfy_api/latest/_input/video_types.py` | V3 视频输入 |
| `io.SVG` | `str` | SVG 文本 |

图像处理的常见坑：**不要假设 batch=1，不要假设通道数=3**。
本骨架里的 `FengImageFilter` 用 `image[..., :3].mean(...)` 和 `expand_as(image)`
来处理任意通道数。

## 3. 模型与条件（只能连线，不带控件）

| 类型 | io_type | 说明 |
| --- | --- | --- |
| `io.Model` | `MODEL` | UNet/DiT 模型，可 `clone()` 后打 patch |
| `io.Clip` | `CLIP` | 文本编码器 |
| `io.Vae` | `VAE` | VAE |
| `io.Conditioning` | `CONDITIONING` | 条件，通常是 `[[tensor, dict], ...]` |
| `io.ClipVision` / `io.ClipVisionOutput` | `CLIP_VISION` / `CLIP_VISION_OUTPUT` | 视觉编码器及输出 |
| `io.StyleModel` | `STYLE_MODEL` | 风格模型 |
| `io.ControlNet` | `CONTROL_NET` | ControlNet |
| `io.Gligen` | `GLIGEN` | GLIGEN |
| `io.UpscaleModel` | `UPSCALE_MODEL` | 放大模型 |
| `io.LatentUpscaleModel` | `LATENT_UPSCALE_MODEL` | 潜空间放大模型 |
| `io.BackgroundRemoval` | `BACKGROUND_REMOVAL` | 抠图模型 |
| `io.LoraModel` | `LORA_MODEL` | LoRA 模型对象 |
| `io.ModelPatch` | `MODEL_PATCH` | 模型补丁 |
| `io.Hooks` / `io.HookKeyframes` | `HOOKS` / `HOOK_KEYFRAMES` | 钩子 |
| `io.AudioEncoder` / `io.AudioEncoderOutput` | `AUDIO_ENCODER` / `AUDIO_ENCODER_OUTPUT` | 音频编码器 |
| `io.Photomaker` | `PHOTOMAKER` | PhotoMaker |

## 4. 采样相关

| 类型 | io_type |
| --- | --- |
| `io.Sampler` | `SAMPLER` |
| `io.Sigmas` | `SIGMAS` |
| `io.Noise` | `NOISE` |
| `io.Guider` | `GUIDER` |
| `io.TimestepsRange` | `TIMESTEPS_RANGE` |
| `io.LatentOperation` | `LATENT_OPERATION` |
| `io.Accumulation` | `ACCUMULATION` |
| `io.FlowControl` | `FLOW_CONTROL` |

## 5. 3D 与几何

```python
io.Mesh        # MESH
io.Voxel       # VOXEL
io.Splat       # SPLAT
io.Point       # POINT
io.BBOX        # BBOX
io.SEGS        # SEGS
io.BoundingBox / io.BoundingBoxes   # BOUNDING_BOX / BOUNDING_BOXES
io.FaceAnalysis  # FACE_ANALYSIS
io.Tracks      # TRACKS
io.Layers      # LAYERS
io.Compositor  # COMPOSITOR
io.Curve       # CURVE
io.Load3D / io.Load3DAnimation / io.Load3DCamera / io.Load3DModelInfo
io.CameraInfoState
io.VideoEdit   # VIDEO_EDIT，视频裁剪/分段编辑
io.ResolutionPreview / io.Histogram / io.ImageCompare
io.Color / io.Colors
```

3D 文件类型单独一族，`execute` 里拿到的是文件路径字符串：

```
io.File3DAny     FILE_3D
io.File3DGLB     FILE_3D_GLB
io.File3DGLTF    FILE_3D_GLTF
io.File3DFBX     FILE_3D_FBX
io.File3DOBJ     FILE_3D_OBJ
io.File3DSTL     FILE_3D_STL
io.File3DUSDZ    FILE_3D_USDZ
io.File3DPLY     FILE_3D_PLY
io.File3DSPLAT / io.File3DSPZ / io.File3DKSPLAT / io.File3DSplatAny
io.File3DPointCloudAny
```

## 6. 万能类型与容器

| 类型 | io_type | 值 |
| --- | --- | --- |
| `io.AnyType` | `*` | 任意，**能连任何输出**，`execute` 里拿到的是原始值 |
| `io.Dict` | `DICT` | `dict` |
| `io.Array` | `ARRAY` | `list` |
| `io.Webcam` | `WEBCAM` | `str` |

`io.AnyType` 适合做"透传"节点，但**它会让类型检查失效**，用的时候自己判断值类型。

## 7. 动态输入（进阶）

### `io.Autogrow.Input`：可增删的重复输入

当节点需要"数量不定的同类输入"时用它，别定义 `image1 image2 image3` 这种固定几个。

```python
io.Autogrow.Input(
    "images",
    template=io.Autogrow.TemplatePrefix(
        input=io.Image.Input("image"),
        prefix="image_",   # 生成 image_0、image_1……
        min=1,
        max=10,
    ),
)

@classmethod
def execute(cls, images) -> io.NodeOutput:
    # images 是 dict：{"image_0": tensor, "image_1": tensor, ...}
    ordered = [images[k] for k in sorted(images, key=lambda s: int(s.rsplit("_", 1)[1]))]
    ...
```

也可以按固定名字：

```python
template=io.Autogrow.TemplateNames(input=io.String.Input("text"), names=["正面", "负面"], min=0)
```

约束来自源码（`_io.py:1094-1159`）：`min >= 0`、`max >= 1`、`max <= 100`；
模板输入里**不能**再嵌套动态输入。模型有"允许一个都没有"的合法路径时，`min` 设 0。

### `io.DynamicCombo.Input`：按选项切换不同输入组

```python
io.DynamicCombo.Input(
    "mode",
    options=[
        io.DynamicCombo.Option("直接缩放", [io.Int.Input("width", default=512)]),
        io.DynamicCombo.Option("按比例", [io.Float.Input("scale", default=0.5)]),
    ],
)
```

`execute` 里这个参数收到的是 `dict`，只包含**当前选中选项**的输入。

### 其它动态类型

| 类型 | io_type | 用途 |
| --- | --- | --- |
| `io.MatchType` | `COMFY_MATCHTYPE_V3` | 输入输出类型跟随连接自动匹配，需要 `Template` |
| `io.MultiType` | `COMFY_MULTITYPED_V3` | 一个插槽接受多种类型 |
| `io.DynamicSlot` | `COMFY_DYNAMICSLOT_V3` | 槽位随输入变化 |
| `io.DynamicGroup` | `COMFY_DYNAMICGROUP_V3` | 成组的动态输入 |

这几个参数都比较多，写的时候直接照 `_io.py:1018-1450` 附近的定义抄，别凭记忆。

## 8. 完整 io_type 清单

`_io.py` 里 `@comfytype(io_type=...)` 一共 89 个，需要确认某个类型是否存在时查这张表：

```text
基础   BOOLEAN INT FLOAT STRING COMBO
媒体   IMAGE MASK LATENT AUDIO VIDEO SVG WEBCAM WAN_CAMERA_EMBEDDING
模型   MODEL CLIP VAE CONDITIONING CLIP_VISION CLIP_VISION_OUTPUT STYLE_MODEL
       CONTROL_NET GLIGEN UPSCALE_MODEL LATENT_UPSCALE_MODEL
       BACKGROUND_REMOVAL LORA_MODEL MODEL_PATCH PHOTOMAKER
采样   SAMPLER SIGMAS NOISE GUIDER TIMESTEPS_RANGE LATENT_OPERATION
       ACCUMULATION FLOW_CONTROL HOOKS HOOK_KEYFRAMES
音频   AUDIO_ENCODER AUDIO_ENCODER_OUTPUT
3D     MESH VOXEL SPLAT POINT BBOX SEGS BOUNDING_BOX BOUNDING_BOXES
       FACE_ANALYSIS TRACKS LAYERS COMPOSITOR CURVE
       LOAD_3D LOAD_3D_ANIMATION LOAD3D_CAMERA LOAD3D_MODEL_INFO CAMERA_INFO_STATE
       FILE_3D FILE_3D_GLB FILE_3D_GLTF FILE_3D_FBX FILE_3D_OBJ FILE_3D_STL
       FILE_3D_USDZ FILE_3D_PLY FILE_3D_SPLAT FILE_3D_SPZ FILE_3D_KSPLAT
       FILE_3D_SPLAT_ANY FILE_3D_POINT_CLOUD_ANY
界面   IMAGECOMPARE COLOR COLORS VIDEO_EDIT RESOLUTION_PREVIEW HISTOGRAM RANGE
容器   *  DICT  ARRAY
动态   COMFY_MATCHTYPE_V3 COMFY_MULTITYPED_V3 COMFY_AUTOGROW_V3
       COMFY_DYNAMICCOMBO_V3 COMFY_DYNAMICSLOT_V3 COMFY_DYNAMICGROUP_V3
```

`LOSS_MAP` 也在里面。完整签名永远以 `H:\~~~aki-v3.2\ComfyUI\comfy_api\latest\_io.py` 为准。
