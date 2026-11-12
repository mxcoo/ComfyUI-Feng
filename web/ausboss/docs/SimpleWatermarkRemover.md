# 简易水印去除器（AusBoss 兼容）

一个老节点，留着是为了旧工作流仍能加载、仍能运行。在本包的 `AUSBOSS_NODES_` 命名之前发布的工作流，用的就是这个一模一样的节点 id。

它接受与原版相同的输入（**image**、**mask** 和 **method**，后者唯一的选项是 `LAMA`），底下跑同样的 LaMa 局部重绘，图像批次和视频帧都算在内。它没有模型列表：它总是用 `ComfyUI/models/lama/` 里的 `big-lama.pt`，所以那个文件必须在那儿。新做的东西请改用 [LaMa 局部重绘 🆎](AUSBOSS_NODES_LaMaInpaint.md)：同样的引擎，带全套控件和实时预览。

这个 id 会一直能用；只是不会再长出新功能。
