"""AusBoss 节点包 —— 上游 ComfyUI-AusBoss v2.24.0 的整体移植。

上游用 V1 写法（ComfyUI 直接读本模块的 NODE_CLASS_MAPPINGS），Feng 主体用 V3 写法
（comfy_entrypoint + io.ComfyNode）。ComfyUI 的加载器对同一个 __init__.py 只走一条分支，
而且是 V1 优先 —— 两种写法挤在同一个 __init__.py 里，V3 那一半会被静默丢掉。

所以这里**不**导出 NODE_CLASS_MAPPINGS 给 ComfyUI，只把它算出来交给 Feng/__init__.py，
由后者注入全局表（见 Feng/__init__.py 里的 _register_ausboss_nodes）。节点类本体仍是上游
对象，执行、校验、object_info、路由全走原来的 V1 路径，语义与单独安装 AusBoss 一致。

前端在 web/ausboss/，由 Feng 的 WEB_DIRECTORY 统一服务，因此本文件不声明 WEB_DIRECTORY
（一个插件只能有一个）。
"""

import importlib
import os
import traceback

from ._version import PACK_VERSION
from .nodes._single_copy import other_install_that_loads

# 每个文件一个条目，与 nodes/ 下一致。顺序无功能影响。
NODE_MODULES = [
    "node_align_image",
    "node_batch_utils",
    "node_callout",
    "node_color_match",
    "node_compare",
    "node_edit_lock",
    "node_flashvsr_upscale",
    "node_frame_interpolate",
    "node_free_memory",
    "node_h3_prompt_writer",
    "node_image_crop_rotate_pad",
    "node_image_folder",
    "node_image_resize",
    "node_image_size",
    "node_inpaint_crop_stitch",
    "node_krea2_encode",
    "node_krea2_model_patch",
    "node_lama_inpaint",
    "node_layout_boxes",
    "node_literals",
    "node_load_image_pad",
    "node_load_audio",
    "node_load_video",
    "node_lora_loader",
    "node_mask_by_name",
    "node_mask_by_touch",
    "node_math",
    "node_prompt_variations",
    "node_realign_to_source",
    "node_refine_mask",
    "node_resolution",
    "node_run_timer",
    "node_save_image",
    "node_save_video",
    "node_seed",
    "node_select_frame",
    "node_show_text",
    "node_step_preview",
    "node_text_lines",
    "node_tiled_upscale",
    "node_video_crop_rotate_pad",
    "node_video_crop_rotate_pad_clip",
    "node_workflow_note",
    "node_workflow_switches",
]

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
failed_modules = []

# 用户另外装了一份独立 AusBoss（Manager 装的 ausboss-nodes 或 git clone）时，两份都会注册
# 同样的节点 id，还会把 /ausboss/... 路由注册两遍，ComfyUI 启动就炸。让独立那份加载，
# 本包整体让位。
try:
    _other_install = other_install_that_loads()
except Exception:
    _other_install = None

if not _other_install:
    for _module_name in NODE_MODULES:
        try:
            _module = importlib.import_module(f".nodes.{_module_name}", __name__)
            NODE_CLASS_MAPPINGS.update(getattr(_module, "NODE_CLASS_MAPPINGS", {}))
            NODE_DISPLAY_NAME_MAPPINGS.update(getattr(_module, "NODE_DISPLAY_NAME_MAPPINGS", {}))
        except Exception:
            # 一个节点坏了不该拖垮整包：记下来继续加载其余节点。
            failed_modules.append(_module_name)
            traceback.print_exc()

    # 汉化在最后一步做：上游文件保持原样，中文全在 zh/ 的数据里，同步上游时不会打架。
    # FENG_AUSBOSS_NO_ZH=1 时跳过——tools/ausboss_zh_extract.py 要拿英文原文去比对。
    if not os.environ.get("FENG_AUSBOSS_NO_ZH"):
        try:
            from .zh import localize_nodes

            localize_nodes(NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS)
        except Exception:
            traceback.print_exc()

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "PACK_VERSION",
    "failed_modules",
]
