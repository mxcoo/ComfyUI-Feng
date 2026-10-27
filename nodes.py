"""示例节点。

一个节点 = 一个 io.ComfyNode 子类：
  define_schema()  声明节点在界面上的样子（输入、输出、分类、显示名）
  execute()        真正干活，返回 io.NodeOutput

把这两个类换成你自己的功能即可。详见 docs/02-node-api.md。
"""

from comfy_api.latest import io, ui


class FengImageFilter(io.ComfyNode):
    """IMAGE 进、IMAGE 出，带数值、下拉和可选输入。"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="FengImageFilter",
            display_name="Feng 图像滤镜（示例）",
            category="Feng/示例",
            description="示例节点：演示 IMAGE 输入输出、滑条、下拉框、可选输入和预览输出。",
            inputs=[
                io.Image.Input("image"),
                io.Float.Input(
                    "strength",
                    display_name="强度",
                    default=1.0,
                    min=0.0,
                    max=1.0,
                    step=0.01,
                    display_mode=io.NumberDisplay.slider,
                ),
                io.Combo.Input(
                    "mode",
                    display_name="模式",
                    options=["invert", "grayscale", "brighten"],
                    default="invert",
                ),
                io.Mask.Input(
                    "mask",
                    display_name="遮罩",
                    optional=True,
                    tooltip="留空则整张图生效",
                ),
            ],
            outputs=[io.Image.Output(display_name="image")],
        )

    @classmethod
    def execute(cls, image, strength, mode, mask=None) -> io.NodeOutput:
        if mode == "grayscale":
            gray = image[..., :3].mean(dim=-1, keepdim=True).expand_as(image)
            filtered = image + (gray - image) * strength
        elif mode == "brighten":
            filtered = (image * (1.0 + strength)).clamp(0.0, 1.0)
        else:
            filtered = image + ((1.0 - image) - image) * strength

        if mask is not None:
            alpha = mask.unsqueeze(-1)
            filtered = image + (filtered - image) * alpha

        return io.NodeOutput(filtered, ui=ui.PreviewImage(filtered))


class FengTextRepeat(io.ComfyNode):
    """纯 Python 示例，方便不接图片时快速测试。"""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="FengTextRepeat",
            display_name="Feng 文本重复（示例）",
            category="Feng/示例",
            description="示例节点：演示多行文本框、整数控件和 STRING 输出。",
            inputs=[
                io.String.Input("text", display_name="文本", multiline=True, default="hello"),
                io.Int.Input("count", display_name="次数", default=2, min=1, max=100, step=1),
                io.String.Input("separator", display_name="分隔符", default="\n"),
            ],
            outputs=[io.String.Output(display_name="text")],
        )

    @classmethod
    def execute(cls, text, count, separator) -> io.NodeOutput:
        return io.NodeOutput(separator.join([text] * count))
