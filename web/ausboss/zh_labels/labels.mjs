// 由 tools/_ausboss_zh_build.py 生成，不要手改。
// 只放「输入名 → 中文标签」：输入名本身是 prompt JSON 里的字段，不能改。
export const INPUT_LABELS = {
"AUSBOSS_NODES_AlignImage": {
"image": "图像",
"multiple": "倍数",
"mode": "模式",
"crop_position": "裁切位置",
"pad_position": "扩边位置",
"pad_fill": "扩边填充",
"pad_color": "扩边颜色"
},
"AUSBOSS_NODES_SelectEveryNth": {
"images": "图像批次",
"nth": "每隔 N 帧",
"offset": "偏移",
"fps": "帧率"
},
"AUSBOSS_NODES_SplitBatch": {
"images": "图像批次",
"index": "索引"
},
"AUSBOSS_NODES_MergeBatches": {
"a": "前半段",
"b": "后半段",
"on_mismatch": "不匹配时"
},
"AUSBOSS_NODES_Callout": {
"text": "文本"
},
"AUSBOSS_NODES_CalloutTile": {
"text": "文本"
},
"AUSBOSS_NODES_ColorMatch": {
"image": "图像",
"strength": "强度",
"reference": "参考",
"method": "方法",
"mask": "遮罩",
"invert_mask": "反相遮罩",
"reference_mode": "参考模式"
},
"AUSBOSS_NODES_Compare": {
"image_a": "图像 A",
"image_b": "图像 B",
"filename": "文件名"
},
"AUSBOSS_NODES_EditLock": {
"model": "模型",
"vae": "VAE",
"image": "图像",
"lock": "锁定",
"tolerance": "容差",
"mask": "遮罩"
},
"AUSBOSS_NODES_EditLockRestore": {
"image": "图像",
"edit_lock": "编辑锁",
"feather": "羽化"
},
"AUSBOSS_NODES_FlashVSRUpscale": {
"frames": "帧数",
"model": "模型",
"scale": "缩放",
"color_match": "颜色匹配",
"vae": "VAE"
},
"AUSBOSS_NODES_FrameInterpolate": {
"frames": "帧数",
"source_fps": "源帧率",
"target_fps": "目标帧率",
"method": "方法",
"scene_cut_threshold": "镜头切换阈值",
"batch_size": "批次大小"
},
"AUSBOSS_NODES_FreeMemory": {
"value": "数值"
},
"AUSBOSS_NODES_H3PromptWriter": {
"script": "脚本",
"seconds": "秒数",
"clip": "CLIP",
"picture_1": "图片 1",
"picture_2": "图片 2",
"picture_3": "图片 3",
"picture_4": "图片 4",
"video": "视频",
"video_sound": "视频声音",
"voice": "音色",
"song": "歌曲",
"camera": "机位",
"look": "外观",
"song_start": "歌曲起点",
"cut_on_beat": "按节拍切",
"language": "语言",
"job_1": "任务 1",
"job_2": "任务 2",
"job_3": "任务 3",
"job_4": "任务 4",
"video_job": "视频任务",
"sound": "声音",
"music": "音乐",
"clip_sound": "剪辑声音"
},
"AUSBOSS_NODES_ImageCropRotatePad": {
"image": "图像",
"rotation_degrees": "旋转角度",
"crop_aspect_ratio": "裁切比例",
"crop_x": "裁切 X",
"crop_y": "裁切 Y",
"crop_width": "裁切宽度",
"crop_height": "裁切高度",
"pad_left": "左扩边",
"pad_top": "上扩边",
"pad_right": "右扩边",
"pad_bottom": "下扩边",
"feather": "羽化",
"canvas_multiple": "画布倍数",
"fill_color": "填充颜色",
"resize_to_megapixels": "缩放到百万像素",
"megapixels": "百万像素",
"resize_method": "缩放方式",
"resolution_steps": "分辨率档位",
"stitch_blend": "拼接混合",
"stitch_grow": "拼接扩张",
"painted_area": "绘制区域"
},
"AUSBOSS_NODES_ImageFolder": {
"source": "源",
"folder": "文件夹",
"subfolders": "子文件夹",
"sort": "排序",
"pictures": "图片集",
"run": "运行",
"position": "位置",
"after_run": "运行后",
"at_the_end": "放到末尾"
},
"AUSBOSS_NODES_ImageResize": {
"image": "图像",
"target_mode": "目标模式",
"width": "宽度",
"height": "高度",
"edge_length": "边长",
"megapixels": "百万像素",
"scale_factor": "缩放系数",
"keep_proportion": "保持比例",
"fill_color": "填充颜色",
"divisible_by": "整除倍数",
"interpolation": "插值方式",
"mask": "遮罩"
},
"AUSBOSS_NODES_ImageSize": {
"image": "图像"
},
"AUSBOSS_NODES_CropForInpaint": {
"image": "图像",
"mask": "遮罩",
"context_factor": "上下文倍数",
"blend_pixels": "混合像素",
"output_multiple": "输出倍数",
"target_width": "目标宽度",
"target_height": "目标高度",
"mask_grow": "遮罩扩张",
"mask_blur": "遮罩模糊",
"invert_mask": "反相遮罩",
"context_pixels": "上下文像素",
"target_megapixels": "目标百万像素",
"rescale_algorithm": "重采样算法",
"extend_left": "向左扩展",
"extend_right": "向右扩展",
"extend_up": "向上扩展",
"extend_down": "向下扩展",
"keep_inside": "限制在内部"
},
"AUSBOSS_NODES_StitchInpaint": {
"stitcher": "拼接器",
"inpainted": "局部重绘结果",
"fix_edge_halo": "修复边缘光晕",
"color_match": "颜色匹配",
"seam": "接缝",
"paste_onto": "粘贴到"
},
"AUSBOSS_NODES_Krea2Encode": {
"clip": "CLIP",
"prompt": "提示词",
"negative_prompt": "反向提示词",
"vae": "VAE",
"reference": "参考",
"extra_image": "附加图像",
"vlm_reference": "视觉模型参考",
"mask": "遮罩"
},
"AUSBOSS_NODES_Krea2OutpaintModelPatch": {
"model": "模型",
"stitcher": "拼接器",
"kv_cache": "KV 缓存",
"placement": "放置方式"
},
"AUSBOSS_NODES_LaMaInpaint": {
"image": "图像",
"mask": "遮罩",
"model": "模型",
"preview": "预览",
"unique_id": "唯一 ID"
},
"SimpleWatermarkRemover": {
"image": "图像",
"mask": "遮罩",
"method": "方法"
},
"AUSBOSS_NODES_LayoutBoxes": {
"background": "背景",
"bboxes": "包围盒",
"width": "宽度",
"height": "高度",
"layout": "布局"
},
"AUSBOSS_NODES_Text": {
"text": "文本"
},
"AUSBOSS_NODES_Integer": {
"value": "数值"
},
"AUSBOSS_NODES_Float": {
"value": "数值"
},
"AUSBOSS_NODES_LoadImagePad": {
"image": "图像",
"pad_left": "左扩边",
"pad_top": "上扩边",
"pad_right": "右扩边",
"pad_bottom": "下扩边",
"mode": "模式",
"fill_color": "填充颜色",
"backdrop_blur": "背景模糊",
"feather": "羽化",
"canvas_multiple": "画布倍数",
"target_megapixels": "目标百万像素",
"source_image": "源图像",
"unique_id": "唯一 ID"
},
"AUSBOSS_NODES_LoadAudio": {
"audio": "音频",
"start_seconds": "起始秒数",
"end_seconds": "结束秒数",
"max_seconds": "最大秒数"
},
"AUSBOSS_NODES_LoadVideo": {
"video": "视频",
"start_seconds": "起始秒数",
"end_seconds": "结束秒数",
"custom_width": "自定义宽度",
"custom_height": "自定义高度",
"every_nth": "每隔 N 个",
"max_frames": "最大帧数",
"single_frame": "单帧"
},
"AUSBOSS_NODES_LoraLoader": {
"model": "模型",
"loras": "LoRA 链",
"clip": "CLIP",
"trigger_separator": "触发词分隔符",
"on_missing": "缺失时"
},
"AUSBOSS_NODES_MaskByName": {
"image": "图像",
"model": "模型",
"clip": "CLIP",
"name": "名称",
"several": "多个",
"grow": "扩张",
"soften": "柔化",
"if_nothing": "若为空",
"preview": "预览",
"threshold": "阈值",
"fill_holes": "填补空洞",
"free_vram": "释放显存"
},
"AUSBOSS_NODES_MaskByTouch": {
"image": "图像",
"model": "模型",
"clip": "CLIP",
"touches": "笔触",
"grow": "扩张",
"soften": "柔化",
"smooth": "平滑",
"fill_holes": "填补空洞",
"if_nothing": "若为空",
"free_vram": "释放显存",
"invert": "反相",
"ask": "询问",
"fine_edges": "精细边缘",
"new_picture": "新图",
"unique_id": "唯一 ID"
},
"AUSBOSS_NODES_MathExpression": {
"expression": "表达式",
"a": "前半段",
"b": "后半段",
"c": "第三段"
},
"AUSBOSS_NODES_PromptVariations": {
"text": "文本",
"seed": "种子"
},
"AUSBOSS_NODES_RealignToSource": {
"edited": "已编辑",
"source": "源",
"fit": "适配方式",
"empty_fill": "空白填充",
"max_zoom": "最大缩放",
"stitcher": "拼接器"
},
"AUSBOSS_NODES_RefineMask": {
"mask": "遮罩",
"expand": "扩展",
"blur": "模糊",
"fill_holes": "填补空洞",
"smooth": "平滑",
"black_point": "黑场",
"white_point": "白场",
"edge_refine": "边缘细化",
"preview": "预览",
"guide_image": "引导图",
"max_hole_size": "最大空洞尺寸"
},
"AUSBOSS_NODES_Resolution": {
"width": "宽度",
"height": "高度",
"latent": "Latent",
"batch_size": "批次大小",
"workflow_sizes": "工作流尺寸"
},
"AUSBOSS_NODES_RunTimer": {},
"AUSBOSS_NODES_SaveImage": {
"images": "图像批次",
"filename_prefix": "文件名前缀",
"format": "格式",
"save_metadata": "保存元数据",
"exact_name": "精确名称",
"on_existing": "已存在时",
"output_dir": "输出目录",
"caption": "说明文字",
"filename": "文件名",
"caption_text": "说明文本",
"name_counter": "计数器",
"name_date": "日期",
"name_time": "时间",
"name_size": "尺寸",
"name_batch": "批次编号",
"preview": "预览",
"step_preview": "步预览",
"autosave": "自动保存",
"prompt": "提示词",
"extra_pnginfo": "附加 PNG 信息"
},
"AUSBOSS_NODES_SaveVideo": {
"fps": "帧率",
"filename_prefix": "文件名前缀",
"crf": "画质(CRF)",
"frames": "帧数",
"audio": "音频",
"video": "视频",
"format": "格式",
"pingpong": "往复播放",
"save_metadata": "保存元数据",
"step_preview": "步预览",
"prompt": "提示词",
"extra_pnginfo": "附加 PNG 信息"
},
"AUSBOSS_NODES_Seed": {
"seed": "种子"
},
"AUSBOSS_NODES_SelectFrame": {
"frames": "帧数",
"frame_number": "帧号",
"preview": "预览"
},
"AUSBOSS_NODES_ShowText": {
"text": "文本"
},
"AUSBOSS_NODES_StepPreview": {},
"AUSBOSS_NODES_TextLines": {
"text": "文本",
"split": "拆分",
"remove_numbering": "去掉编号",
"limit": "上限"
},
"AUSBOSS_NODES_TiledUpscale": {
"image": "图像",
"megapixels": "百万像素",
"upscale_model": "放大模型",
"tile_megapixels": "每块百万像素",
"overlap": "重叠",
"multiple": "倍数",
"max_growth": "最大扩张"
},
"AUSBOSS_NODES_TiledUpscaleStitch": {
"tiles": "分块",
"stitcher": "拼接器",
"keep_colors": "保留颜色"
},
"AUSBOSS_NODES_VideoCropRotatePad": {
"video": "视频",
"source_mode": "源模式",
"local_path": "本地路径",
"seek_mode": "寻址方式",
"frame_index": "帧序号",
"frame_time": "帧时间",
"rotation_degrees": "旋转角度",
"crop_aspect_ratio": "裁切比例",
"crop_x": "裁切 X",
"crop_y": "裁切 Y",
"crop_width": "裁切宽度",
"crop_height": "裁切高度",
"pad_left": "左扩边",
"pad_top": "上扩边",
"pad_right": "右扩边",
"pad_bottom": "下扩边",
"feather": "羽化",
"canvas_multiple": "画布倍数",
"fill_color": "填充颜色",
"resize_to_megapixels": "缩放到百万像素",
"megapixels": "百万像素",
"resize_method": "缩放方式",
"resolution_steps": "分辨率档位"
},
"AUSBOSS_NODES_VideoCropRotatePadClip": {
"video": "视频",
"source_mode": "源模式",
"local_path": "本地路径",
"start_seconds": "起始秒数",
"end_seconds": "结束秒数",
"seek_mode": "寻址方式",
"frame_index": "帧序号",
"frame_time": "帧时间",
"rotation_degrees": "旋转角度",
"crop_aspect_ratio": "裁切比例",
"crop_x": "裁切 X",
"crop_y": "裁切 Y",
"crop_width": "裁切宽度",
"crop_height": "裁切高度",
"pad_left": "左扩边",
"pad_top": "上扩边",
"pad_right": "右扩边",
"pad_bottom": "下扩边",
"feather": "羽化",
"canvas_multiple": "画布倍数",
"fill_color": "填充颜色",
"resize_to_megapixels": "缩放到百万像素",
"megapixels": "百万像素",
"resize_method": "缩放方式",
"resolution_steps": "分辨率档位",
"every_nth": "每隔 N 个",
"max_frames": "最大帧数",
"frame_snap": "帧对齐",
"stitch_blend": "拼接混合",
"stitch_grow": "拼接扩张",
"force_rate": "强制帧率",
"start_frame": "起始帧",
"end_frame": "结束帧",
"frame_load_cap": "最多载入帧数",
"fixed_frames": "固定帧数",
"last_seconds": "末尾秒数"
},
"AUSBOSS_NODES_WorkflowNote": {
"note": "备注"
},
"AUSBOSS_NODES_WorkflowNoteTile": {
"note": "备注"
},
"AUSBOSS_NODES_WorkflowSwitches": {}
};
