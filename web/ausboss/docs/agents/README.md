# AusBoss 节点：给 AI agent 的指南

把这一页交给 AI agent，它就能为一项工作挑对 AusBoss 节点、接进工作流，并找到每个输入的帮助。这一页随包发布，所以它也在你的 ComfyUI 安装里，位于 `custom_nodes/<this pack>/js/docs/agents/`。

**如果你是 agent：** 在下表里找到那项工作，接线之前先读那个节点的帮助页。每个帮助页都是本包里的 `js/docs/<node id>.md`。ComfyUI 在节点帮助面板里显示的是同一页。

## 哪项工作用哪个节点

| 工作 | 节点（id） |
|---|---|
| 按形状和百万像素挑画面尺寸，替代 Empty Latent | Latent 尺寸 🆎（`AUSBOSS_NODES_Resolution`） |
| 缩放画面，或把尺寸对齐到某个倍数 | 图像缩放 🆎（`AUSBOSS_NODES_ImageResize`）、对齐图像 🆎（`AUSBOSS_NODES_AlignImage`） |
| 读出画面的宽与高 | 图像尺寸 🆎（`AUSBOSS_NODES_ImageSize`） |
| 扩图：加载画面并在四周加出空白 | 加载图像 + 扩边 🆎（`AUSBOSS_NODES_LoadImagePad`） |
| 在一个节点里旋转、裁剪、扩边画面 | 图像裁剪 + 旋转 + 扩边 🆎（`AUSBOSS_NODES_ImageCropRotatePad`） |
| 只对遮罩住的部分做局部重绘，再贴回原处 | 局部重绘裁剪 🆎（`AUSBOSS_NODES_CropForInpaint`），再接 局部重绘拼接 🆎（`AUSBOSS_NODES_StitchInpaint`） |
| 不用提示词去掉水印或某个物体 | LaMa 局部重绘 🆎（`AUSBOSS_NODES_LaMaInpaint`） |
| 输入要找的东西来取遮罩 | 按名字取遮罩 🆎（`AUSBOSS_NODES_MaskByName`） |
| 点一下那个东西来取遮罩 | 点选取遮罩 🆎（`AUSBOSS_NODES_MaskByTouch`） |
| 把遮罩长、缩、填补或平滑 | 遮罩精修 🆎（`AUSBOSS_NODES_RefineMask`） |
| 编辑模型改图时，让没动过的部分保持原样 | 编辑锁 🆎（`AUSBOSS_NODES_EditLock`），再接 编辑锁还原 🆎（`AUSBOSS_NODES_EditLockRestore`） |
| 把改过的画面重新对齐回原图 | 与源图重新对齐（实验性 🧪） 🆎（`AUSBOSS_NODES_RealignToSource`） |
| 把一张画面的颜色匹配到另一张 | 颜色匹配 🆎（`AUSBOSS_NODES_ColorMatch`） |
| 分块放大画面 | 分块放大 🆎（`AUSBOSS_NODES_TiledUpscale`），再接 分块放大拼接 🆎（`AUSBOSS_NODES_TiledUpscaleStitch`） |
| 比较两张画面 | 图像比较 A/B 🆎（`AUSBOSS_NODES_Compare`） |
| 保存画面（PNG、无损 WebP 或 JPEG XL） | 保存图像 🆎（`AUSBOSS_NODES_SaveImage`） |
| 对文件夹里的每张画面跑一遍工作流 | 图像文件夹 🆎（`AUSBOSS_NODES_ImageFolder`） |
| 叠一串 LoRA | LoRA 加载器 🆎（`AUSBOSS_NODES_LoraLoader`） |
| 用大白话写出 MiniMax H3 或 Pika H3 Flex 的提示词 | H3 提示词撰写 🆎（`AUSBOSS_NODES_H3PromptWriter`）：[节点帮助](../AUSBOSS_NODES_H3PromptWriter.md) |
| Krea 2 提示词，以及 Krea 2 扩图 | Krea 2 编码 🆎（`AUSBOSS_NODES_Krea2Encode`）、Krea 2 扩图模型补丁 🆎（`AUSBOSS_NODES_Krea2OutpaintModelPatch`） |
| 加载或保存视频 | 加载视频 🆎（`AUSBOSS_NODES_LoadVideo`）、保存视频 🆎（`AUSBOSS_NODES_SaveVideo`） |
| 加载声音文件，只留其中一段，最长到设定长度 | 加载音频 🆎（`AUSBOSS_NODES_LoadAudio`） |
| 旋转、裁剪、扩边视频：单帧，或整段片段 | 视频裁剪 + 旋转 + 扩边 → 单帧 🆎（`AUSBOSS_NODES_VideoCropRotatePad`）、→ 片段 🆎（`AUSBOSS_NODES_VideoCropRotatePadClip`） |
| 改片段的帧率 | 帧插值 🆎（`AUSBOSS_NODES_FrameInterpolate`） |
| 把片段放大得更清晰 | FlashVSR 放大 🆎（`AUSBOSS_NODES_FlashVSRUpscale`） |
| 处理帧批次 | 选择帧 🆎、每隔 N 帧选取 🆎、拆分批次 🆎、合并批次 🆎（`AUSBOSS_NODES_SelectFrame`、`_SelectEveryNth`、`_SplitBatch`、`_MergeBatches`） |
| 每行文字跑一遍工作流，比如一串提示词 | 文本行 🆎（`AUSBOSS_NODES_TextLines`） |
| 共用一个种子、数字或文本 | 种子 🆎、整数 🆎、浮点数 🆎、文本 🆎（`AUSBOSS_NODES_Seed`、`_Integer`、`_Float`、`_Text`） |
| 每次运行按种子从 `{a\|b\|c}` 这样的选项里挑一个的提示词 | 提示词变体 🆎（`AUSBOSS_NODES_PromptVariations`） |
| 对数字做运算 | 数学表达式 🆎（`AUSBOSS_NODES_MathExpression`） |
| 在节点上显示文本，或在画面生成过程中显示它 | 显示文本 🆎（`AUSBOSS_NODES_ShowText`）、分步预览 🆎（`AUSBOSS_NODES_StepPreview`） |
| 在步与步之间释放显存 | 释放显存 🆎（`AUSBOSS_NODES_FreeMemory`） |
| 给整次运行计时 | 运行计时器 🆎（`AUSBOSS_NODES_RunTimer`） |
| 开关工作流里的部分节点 | 工作流开关 🆎（`AUSBOSS_NODES_WorkflowSwitches`）：[它自己的 agent 指南](workflow_switches.md) |
| 在画布上说明分享出去的工作流 | 工作流说明卡 🆎（`AUSBOSS_NODES_WorkflowNote`）、标注便签 🆎（`AUSBOSS_NODES_Callout`） |
| 加上紧凑的帮助，或彩色链接按钮 | 工作流说明磁贴 🆎（`AUSBOSS_NODES_WorkflowNoteTile`）、标注图块 🆎（`AUSBOSS_NODES_CalloutTile`） |
| 把物件和文字的框摆在画布上 | 布局框 🆎（`AUSBOSS_NODES_LayoutBoxes`） |

每个节点的显示名都以 🆎 结尾，在节点菜单里位于 `🆎 AusBoss/<group>` 之下。在工作流文件和 API 里，节点用它的 id 命名，就是上面那些 `AUSBOSS_NODES_...` 键。

## 改工作流之前

- **按名字读设置。** 存下来的工作流把每个节点的设置存两遍：按位置存在 `widgets_values` 里，按名字存在 `widgets_values_named` 里。按名字读写，并让两份保持同步。
- **在运行中的 ComfyUI 里看一个节点的输入与输出**：`GET /object_info/<node id>` 会连同类型和默认值一起列出它们。
- **输入在发布之后不会改名，也不会换序**，所以能跑的工作流会一直能跑。
- **示例工作流里的媒体加载器是空的。** 排队之前先填进对方要用的文件。

## H3 换人与片段时长

做换人时，把目标选择器单独放一行。还可以另起一行，`@1 looks like a woman with blonde hair and a black hoodie.`，描述图片 1 里接上的替换人物；用它实际的图片编号。这一行有助于表达外观，但不保证身份一致。不要把它加到其他工作上。没有这一行的现有脚本保持原来的行为。

接上视频时，**swap the person**、**change something** 和 **new voice** 的时长由它决定。卡片上显示 **From the clip**，并隐藏对时间轴的数值重定时；改为在上游裁短或限制片段。不要用源文件的元数据推断最终帧数：上游的处理和 H3 的帧取整都会起作用。其他工作以及视频关闭时，仍照常用 **Length**。

## 示例工作流

本包的 `example_workflows/` 里是完整的工作流，每个都带一张它产出的画面。每个都以一张工作流说明卡开头，列出它需要的模型文件以及该放的位置。从最接近的那个改起，不要从零搭。

## 出问题的时候

- 再读一遍那个节点的帮助页，有「技术细节」或「备注」部分的话一并读。
- 搜本包的 GitHub issues：https://github.com/ausboss/ComfyUI-AusBoss/issues
- 新的 bug 报告要写明 ComfyUI 版本、控制台横幅里的包版本、涉及的节点，以及能复现它的最小工作流。
