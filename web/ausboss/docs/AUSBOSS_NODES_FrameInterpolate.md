# 帧插值 🆎

改变片段的帧率，例如从 24 到 30，方式是生成中间的画面。用它把生成的
片段变平滑，或与另一段片段的帧率对齐；`24 -> 30` 与倍帧一样自然。
每个输出帧都映射到源时间线上的一个位置：正好落在源帧上的位置原样
复制，只有真正的中间帧才被合成。

## 方法

- **blend**：在相邻两帧之间做交叉淡化。瞬时且无依赖，但快速运动会
  显得发软，因为它求平均而不是移动像素。
- **optical flow (RAFT)**（`optical flow (requires cached RAFT weights)`）：
  双向估计 RAFT 运动矢量，把两个邻帧都朝中间的时点形变，再融合两个
  形变结果。运动上锐利得多。它读取 torchvision 官方 RAFT-small
  checkpoint `raft_small_C_T_V2-01064c6d.pth`，从 torch hub 缓存
  （`~/.cache/torch/hub/checkpoints/`，除非 `TORCH_HOME` 把它挪走），
  运行期间从不下载。从
  `https://download.pytorch.org/models/raft_small_C_T_V2-01064c6d.pth`
  下载到那个文件夹；没有它，节点会说出它查找的确切路径。或者改用
  **blend**。

## 场景切换

跨越硬切做插值会产生形变伪影：两个无关镜头彼此涂抹一两帧。当相邻
源帧之间的平均绝对差超过 **Scene cut**（`scene_cut_threshold`）时，
节点把这一对当作切点，保持切点前的最后一帧，而不是做形变。把阈值
设为 `0` 可关闭检测，对一切都插值。

## 控件

- **frames**：视频帧，BHWC 的 `IMAGE` 批次。
- **FPS** 左框（`source_fps`）：输入批次的帧率；接上 Load Video 的
  fps 输出以匹配源。
- **FPS** 右框（`target_fps`）：要改成的帧率。与源帧率一致时批次
  原样通过。新节点从 24 → 30 开始。
- **Method**（`method`）：`blend` 或 **optical flow (RAFT)**，如上所述。
- **Scene cut**（`scene_cut_threshold`）：切点敏感度，0 到 1；`0.35`
  适合大多数素材，`0` 关闭。
- **Batch**（`batch_size`，起始为 `8`）：每批计算的中间帧数。越高越快，
  但占用更多显存；每批完成即落到系统内存。

## 输出

- **frames**：重采样后的 BHWC 帧批次。
- **fps**：实际输出帧率。输出长度为保持片段时长会做取整，所以在短
  片段上这可能与请求值略有出入；把它接进 Save Video，时间就不会
  漂移。

两种方法都不发起网络请求，也不写文件。光流法从本地 torch hub 缓存
读取已有的 checkpoint。
