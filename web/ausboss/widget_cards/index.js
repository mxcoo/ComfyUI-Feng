// Widget cards for the nodes whose face was still a stack of classic canvas
// widgets. Each entry names the rows the card shows in place of those
// widgets; the card (js/shared/widget_card.mjs) hides the originals and
// mirrors them, so the backend, saved workflows and widget-to-input links
// are untouched. Rows with `when` appear only while they mean something,
// and a `group` row folds the rarely-touched settings behind one click.
import { PANEL_LABELS } from "../shared/panel_controls.mjs";
import { api } from "../../../../scripts/api.js";
import { app } from "../../../../scripts/app.js";
import { chainCallback, notifyAusbossChange } from "../shared/index.mjs";
import { formatWidgetVisibility } from "../shared/save_video_formats.mjs";
import { hideInputsInDef } from "../shared/widget_visibility.mjs";
import { castChips } from "../shared/h3_cast_chips.mjs";
import { clipSetsDuration } from "../shared/h3_duration.mjs";
import { momentStrip } from "../shared/moment_strip.mjs";
import { mountWidgetCard } from "../shared/widget_card.mjs";
import { FONT_UI, THEME } from "../shared/theme.mjs";
import { SOCKETLESS_CHOICE, SOCKETLESS_TEXT, commitWidgetValue, markSocketless, resetUnknownValues } from "../shared/widget_card_math.mjs";
import { mediaViewQuery } from "../shared/media_list.mjs";
import { gearIconSvg, openSettingsMenu } from "../shared/settings_menu.mjs";
import { SEAM_MENU, SEAM_MUTE_TITLES, isBlendIn, seamCornerReserve } from "../shared/stitch_seam.mjs";
import { NUMBER_LOOK_MENU, TEXT_LOOK_MENU, setTextLook, textLook, textLookCornerReserve } from "../shared/text_look.mjs";
import { fineEdgeLabel } from "../shared/touch_math.mjs";
import { valueToTake, wiredLimits } from "../shared/wired_limits.mjs";

// The Source lists preview the hovered file straight from ComfyUI's /view.
const viewUrl = (value) => api.apiURL(`/view?${mediaViewQuery(value)}`);

const isMode = (name, ...modes) => (values) => modes.includes(values[name]);
// Stitch Inpaint: Seam lives in the card's gear menu (shared/stitch_seam.mjs
// holds the menu and the rules). The gear in the card's corner opens the
// menu; a "blend in" chip beside it shows the mode at a glance and opens the
// same menu.
function seamCorner(node, card) {
  const tools = document.createElement("div");
  tools.style.cssText = "position:relative;display:flex;align-items:center;gap:5px";
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "ausboss-card-chip";
  chip.textContent = "混合";
  chip.title = "接缝方式是「混合」，所以「修复边缘光晕」不生效。可在齿轮菜单里改。";
  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "ausboss-card-gear";
  gear.title = "局部重绘拼接设置";
  gear.innerHTML = gearIconSvg();
  const open = () => openSettingsMenu({
    scope: "stitch_inpaint",
    schema: SEAM_MENU,
    anchor: gear.getBoundingClientRect(),
    title: "局部重绘拼接设置",
    initial: { seam: card.values().seam, paste_onto: card.values().paste_onto },
    onChange: (values, key) => {
      if (key === "seam" || key === "paste_onto") card.setWidget(key, values[key]);
    },
  });
  gear.addEventListener("click", open);
  chip.addEventListener("click", open);
  // Under the chip, beside the muted Fix edge halo row: why it is dim.
  const note = document.createElement("div");
  note.append("未启用", document.createElement("br"), "（因混合模式）");
  note.style.cssText = "position:absolute;top:33px;right:2px;text-align:right;white-space:nowrap;"
    + `color:${THEME.faint};font:9px/11px ${FONT_UI};`
    + "pointer-events:none";
  tools.append(chip, gear, note);
  return {
    element: tools,
    sync: (values) => {
      chip.hidden = !isBlendIn(values);
      note.hidden = chip.hidden;
      return seamCornerReserve(values);
    },
  };
}
// Text, Integer and Float: the gear in the card's corner picks the node's
// look, the usual box or big and centred (shared/text_look.mjs). The look is
// kept on the node, not in a widget, so the node's inputs and saved values
// never change.
const lookCorner = (schema, title) => (node, card) => {
  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "ausboss-card-gear";
  gear.title = title;
  gear.innerHTML = gearIconSvg();
  gear.addEventListener("click", () => openSettingsMenu({
    scope: "text_look",
    schema,
    anchor: gear.getBoundingClientRect(),
    title,
    initial: { look: textLook(node) },
    onChange: (values) => {
      if (values.look === textLook(node)) return;
      setTextLook(node, values.look);
      card.refresh();
      node.graph?.setDirtyCanvas?.(true, true);
      notifyAusbossChange();
    },
  }));
  return { element: gear, sync: () => textLookCornerReserve(textLook(node)) };
};
const textLookCorner = lookCorner(TEXT_LOOK_MENU, "文字设置");
const numberLookCorner = lookCorner(NUMBER_LOOK_MENU, "数字设置");
// Save Video rows that only some formats read (crf, save_metadata).
const formatReads = (name) => (values) => formatWidgetVisibility(String(values.format))[name];

const CARDS = {
  AUSBOSS_NODES_ImageResize: {
    minWidth: 300,
    rows: [
      { widget: "target_mode", label: "Target", kind: "select",
        labels: { "width+height": "宽 × 高", longest_edge: "长边", shortest_edge: "短边", megapixels: "Megapixels", scale_factor: "缩放倍数" } },
      // Sockets for the pair sit among the node's inputs (one socket per
      // row is the rule, and a size is what people wire).
      { pair: ["width", "height"], label: "Size", prefixes: ["W", "H"], sep: "×", top: true, pixels: true, when: isMode("target_mode", "width+height") },
      { widget: "edge_length", label: "Edge", suffix: "px", when: isMode("target_mode", "longest_edge", "shortest_edge") },
      { widget: "megapixels", label: "Budget", suffix: "MP", when: isMode("target_mode", "megapixels") },
      { widget: "scale_factor", label: "Scale", suffix: "×", when: isMode("target_mode", "scale_factor") },
      { widget: "keep_proportion", label: "Fit", kind: "segment", labels: { cover_crop: "cover" } },
      { widget: "fill_color", label: "Fill", kind: "color", when: isMode("keep_proportion", "pad") },
      { widget: "divisible_by", label: "Multiple" },
      { widget: "interpolation", label: "Filter", kind: "select" },
    ],
  },
  AUSBOSS_NODES_EditLock: {
    minWidth: 300,
    rows: [
      { widget: "lock", label: "Lock", kind: "segment",
        titles: { auto: "锁住没动过的部分；整张图都变了就让位", always: "整张图都变了也照样锁住", off: "什么都不做" } },
      { widget: "tolerance", label: "Tolerance", decimals: 2, suffix: "×" },
    ],
  },
  AUSBOSS_NODES_EditLockRestore: { minWidth: 300, rows: [{ widget: "feather", label: "Feather", suffix: "px" }] },
  AUSBOSS_NODES_ColorMatch: {
    minWidth: 300,
    rows: [
      { widget: "strength", label: "Strength" },
      { widget: "method", label: "Method", kind: "segment", labels: { histogram: "hist" }, titles: { histogram: "histogram" } },
      { widget: "reference_mode", label: "Reference", kind: "segment", labels: { reference: "reference", first_frame: "首帧" } },
      { widget: "invert_mask", label: "反转遮罩" },
    ],
  },
  // One number to set: the megapixels of the finished picture, in half
  // steps. The rest has defaults that hold for the models tried and sits
  // behind More.
  AUSBOSS_NODES_TiledUpscale: {
    minWidth: 300,
    rows: [
      { widget: "megapixels", label: "Megapixels", suffix: "MP", step: 0.5, snap: true, decimals: 1, title: "成图尺寸。0 表示保持图片原尺寸。" },
      { group: "advanced", label: "More" },
      { widget: "tile_megapixels", label: "分块大小", suffix: "MP", step: 0.5, snap: true, decimals: 1, group: "advanced" },
      { widget: "overlap", label: "Overlap", suffix: "px", group: "advanced" },
      { widget: "multiple", label: "Multiple", snap: true, step: 8, group: "advanced" },
      { widget: "max_growth", label: "重绘上限", suffix: "×", decimals: 1, group: "advanced" },
    ],
  },
  AUSBOSS_NODES_TiledUpscaleStitch: { minWidth: 260, rows: [{ widget: "keep_colors", label: "保持颜色" }] },
  AUSBOSS_NODES_StitchInpaint: {
    minWidth: 300,
    // A workflow saved before Seam existed holds the card's own empty value
    // in the slot Seam now takes; it loads as classic. One saved with Seam
    // holds it in Paste onto's slot, and loads as crop.
    resetUnknown: { seam: "classic", paste_onto: "crop" },
    // Seam and Paste onto have no row and no socket: the gear menu sets them.
    hide: ["seam", "paste_onto"],
    socketless: ["seam", "paste_onto"],
    corner: seamCorner,
    rows: [
      { widget: "color_match", label: "色调匹配" },
      { widget: "fix_edge_halo", label: "修复边缘光晕", mute: isBlendIn, muteTitle: SEAM_MUTE_TITLES.fix_edge_halo },
    ],
  },
  AUSBOSS_NODES_CropForInpaint: {
    minWidth: 320,
    // A workflow saved before Stay in picture existed holds the card's own
    // empty value in the slot keep_inside now takes; it loads on, the node's
    // default and what an API prompt without keep_inside runs with.
    resetUnknown: { keep_inside: true },
    rows: [
      { widget: "context_factor", label: "Context", suffix: "×" },
      { widget: "keep_inside", label: "不超出画面" },
      { widget: "blend_pixels", label: "Blend", suffix: "px" },
      { widget: "output_multiple", label: "Multiple" },
      { widget: "mask_grow", label: "Grow", suffix: "px" },
      { widget: "mask_blur", label: "Blur" },
      { widget: "invert_mask", label: "反转遮罩" },
      { group: "advanced", label: "目标尺寸（扩展）" },
      { widget: "context_pixels", label: "额外上下文", suffix: "px", group: "advanced" },
      { widget: "target_width", label: "目标宽度", suffix: "px", group: "advanced" },
      { widget: "target_height", label: "目标高度", suffix: "px", group: "advanced" },
      { widget: "target_megapixels", label: "Target", suffix: "MP", group: "advanced" },
      { widget: "rescale_algorithm", label: "Rescale", kind: "segment", group: "advanced" },
      { widget: "extend_left", label: "向左扩展", suffix: "px", group: "advanced" },
      { widget: "extend_right", label: "向右扩展", suffix: "px", group: "advanced" },
      { widget: "extend_up", label: "向上扩展", suffix: "px", group: "advanced" },
      { widget: "extend_down", label: "向下扩展", suffix: "px", group: "advanced" },
    ],
  },
  AUSBOSS_NODES_RefineMask: {
    minWidth: 300, first: true,
    // A workflow saved by a 1.x release holds the preview panel's own empty
    // value where preview now sits; it loads on, the node's default. One
    // saved by 2.x before Max hole size existed holds the card's there; it
    // loads 0, no limit, as the node ran then.
    resetUnknown: { preview: true, max_hole_size: 0 },
    rows: [
      { widget: "expand", label: "Expand", suffix: "px" },
      { widget: "blur", label: "Blur" },
      { group: "advanced", label: "More" },
      { widget: "fill_holes", label: "填充空洞", group: "advanced" },
      { widget: "max_hole_size", label: "最大空洞", suffix: "%", group: "advanced",
        mute: (values) => values.fill_holes !== true, muteTitle: "仅在开启「填充空洞」时生效。" },
      { widget: "smooth", label: "Smooth", suffix: "px", group: "advanced" },
      { widget: "black_point", label: "黑点", group: "advanced" },
      { widget: "white_point", label: "白点", group: "advanced" },
      { widget: "edge_refine", label: "Edge", kind: "segment", labels: { "guided filter": "guided" }, group: "advanced" },
    ],
  },
  // The settings of Image Folder. Its gallery (js/image_folder) sits under
  // the card and owns the hidden `pictures` widget. The ticks on the gallery
  // write it, so it takes no link: a second text link would land there once
  // Folder is wired.
  AUSBOSS_NODES_ImageFolder: {
    minWidth: 320, first: true, hide: ["pictures"], socketless: ["pictures"],
    rows: [
      { widget: "source", label: "From", kind: "segment", labels: PANEL_LABELS.sources },
      { widget: "folder", label: "Folder", placeholder: "文件夹本身",
        button: { text: "Browse", title: "选择 ComfyUI 的 input 或 output 目录里的一个文件夹。",
          onClick: (node, state) => node.__ausbossImageFolder?.browse(state?.root?.querySelector(".ausboss-card-btn")) } },
      { widget: "subfolders", label: "Subfolders" },
      { widget: "sort", label: "Order", kind: "select" },
      { widget: "run", label: "Run", kind: "segment" },
      { widget: "position", label: "Picture", when: (values) => values.run === "one per run" },
      { widget: "after_run", label: "运行之后", kind: "segment", when: (values) => values.run === "one per run" },
      { widget: "at_the_end", label: "最后", kind: "segment", when: (values) => values.run === "one per run" },
    ],
  },
  // The settings of Mask by Touch. Its picture (js/mask_by_touch) sits above
  // the card and owns the hidden `touches` and `ask` widgets. The picture
  // writes both, so neither takes a link: with a socket, a text link dragged
  // over the node lit a drop target at the card's top edge.
  AUSBOSS_NODES_MaskByTouch: {
    minWidth: 400, hide: ["touches", "ask"], socketless: ["touches", "ask"],
    rows: [
      { widget: "grow", label: "Grow", suffix: "px" },
      // Half a pixel a step, a tenth with Shift.
      { widget: "soften", label: "Soften", suffix: "px", step: 0.5, decimals: 1 },
      // Off, or the model file that does it. With one file it reads off | on;
      // with more, each by its own name.
      { widget: "fine_edges", label: "边缘细化", labels: fineEdgeLabel },
      { group: "advanced", label: "More" },
      { widget: "smooth", label: "Smooth", suffix: "px", group: "advanced" },
      { widget: "fill_holes", label: "填补小空洞", group: "advanced" },
      { widget: "invert", label: "Invert", group: "advanced" },
      { widget: "if_nothing", label: "如果什么都没找到", kind: "segment", group: "advanced" },
      // What a different picture coming in does to the picks.
      { widget: "new_picture", label: "新图片", kind: "segment", group: "advanced" },
      { widget: "free_vram", label: "释放显存", group: "advanced" },
    ],
  },
  // The canvas size of Layout Boxes. Its canvas (js/layout_boxes) sits under
  // the card and owns the hidden `layout` widget. A picture on `background`
  // sets the size, so the row dims while one is wired, as width and height
  // are hidden on Create Bounding Boxes then.
  AUSBOSS_NODES_LayoutBoxes: {
    minWidth: 360, first: true, hide: ["layout"],
    rows: [
      { pair: ["width", "height"], label: "Canvas", prefixes: ["W", "H"], sep: "×", top: true, snap: true, linkedBy: ["background"] },
    ],
  },
  AUSBOSS_NODES_MaskByName: {
    minWidth: 300, first: true,
    rows: [
      { widget: "name", label: "Find" },
      { widget: "several", label: "如果有多张", kind: "segment" },
      { widget: "grow", label: "Grow", suffix: "px" },
      { widget: "soften", label: "Soften", suffix: "px" },
      { widget: "if_nothing", label: "如果什么都没找到", kind: "segment" },
      { group: "advanced", label: "More" },
      { widget: "threshold", label: "Sureness", group: "advanced" },
      { widget: "fill_holes", label: "填充空洞", group: "advanced" },
      { widget: "free_vram", label: "释放显存", group: "advanced" },
    ],
  },
  AUSBOSS_NODES_FrameInterpolate: {
    minWidth: 300,
    rows: [
      { pair: ["source_fps", "target_fps"], label: "FPS", sep: "→", top: true },
      { widget: "method", label: "Method", kind: "select", labels: { "optical flow (requires cached RAFT weights)": "光流（RAFT）" } },
      { widget: "scene_cut_threshold", label: "场景切换" },
      { widget: "batch_size", label: "Batch" },
    ],
  },
  AUSBOSS_NODES_FlashVSRUpscale: {
    minWidth: 340,
    rows: [
      { widget: "model", label: "Model", kind: "select" },
      { widget: "scale", label: "Scale", suffix: "×", decimals: 2 },
      { widget: "color_match", label: "保持颜色" },
    ],
  },
  AUSBOSS_NODES_AlignImage: {
    minWidth: 300,
    rows: [
      { widget: "mode", label: "Mode", kind: "segment" },
      { widget: "multiple", label: "Multiple" },
      { widget: "crop_position", label: "Anchor", kind: "select", when: isMode("mode", "crop") },
      { widget: "pad_position", label: "Anchor", kind: "select", when: isMode("mode", "pad") },
      { widget: "pad_fill", label: "扩边填充", kind: "segment", when: isMode("mode", "pad") },
      { widget: "pad_color", label: "扩边颜色", kind: "color", when: (values) => values.mode === "pad" && values.pad_fill === "color" },
    ],
  },
  AUSBOSS_NODES_RealignToSource: {
    minWidth: 300,
    rows: [
      { widget: "fit", label: "Fit", kind: "segment",
        titles: { "zoom + shift": "横向、纵向各自缩放再加平移：Qwen 编辑常见的漂移", affine: "再加一点旋转或错切" } },
      { widget: "empty_fill", label: "空白填充", kind: "segment",
        titles: { edge: "拉伸最近的边缘像素", source: "原图自己的像素", gray: "纯色 #808080，留给一趟局部重绘" } },
      { widget: "max_zoom", label: "最大缩放", suffix: "%" },
    ],
  },
  // a, b and c are socket-only inputs (forceInput), so the card is the
  // expression alone; the values arrive on the node's left edge.
  AUSBOSS_NODES_MathExpression: {
    minWidth: 300,
    rows: [{ widget: "expression", label: "f(a, b, c)", placeholder: "a + b" }],
  },
  AUSBOSS_NODES_SelectEveryNth: { minWidth: 280, rows: [{ widget: "nth", label: "每隔几个" }, { widget: "offset", label: "Offset" }] },
  AUSBOSS_NODES_SplitBatch: { minWidth: 280, rows: [{ widget: "index", label: "切分点" }] },
  AUSBOSS_NODES_MergeBatches: { minWidth: 300, rows: [{ widget: "on_mismatch", label: "Mismatch", kind: "segment", labels: { "resize to a": "match a", "resize to b": "match b" }, titles: { "resize to a": "把 b 缩放到 a 的尺寸", "resize to b": "把 a 缩放到 b 的尺寸", error: "中止本次运行" } }] },
  // Like ComfyUI's own Primitive node, both take over the limits of the
  // input they are wired to: wired to a sampler's denoise, Float stops at 1.
  // A new box also takes the value of the first input it is wired to
  // (`takesWired`), so wiring it up does not change that setting. The gear
  // picks the look; big is one large centred number.
  AUSBOSS_NODES_Integer: {
    minWidth: 260, takesWired: "value", look: textLook, corner: numberLookCorner,
    rows: [{ widget: "value", label: "Value", limits: wiredLimits, looks: { big: { height: 56 } } }],
  },
  AUSBOSS_NODES_Float: {
    minWidth: 260, takesWired: "value", look: textLook, corner: numberLookCorner,
    rows: [{ widget: "value", label: "Value", decimals: 3, trimZeros: true, limits: wiredLimits, looks: { big: { height: 56 } } }],
  },
  // The gear picks the look; big is a compact field of large centred
  // letters, for a word or two over a picture.
  AUSBOSS_NODES_Text: {
    minWidth: 300, look: textLook, corner: textLookCorner,
    rows: [{ widget: "text", kind: "textarea", placeholder: "提示词、说明文字或共用文本", height: 100, grow: true,
      looks: { big: { height: 62, placeholder: "在此输入" } } }],
  },
  // One line for each run. The three settings under the box say where a run
  // ends, whether a leading "1." comes off, and how many lines run at most.
  AUSBOSS_NODES_TextLines: {
    minWidth: 320,
    rows: [
      { widget: "text", kind: "textarea", placeholder: "每次运行一行", height: 100, grow: true },
      { widget: "split", label: "切分位置", kind: "segment" },
      { widget: "remove_numbering", label: "Numbering", onText: "remove", offText: "keep" },
      { widget: "limit", label: "Limit" },
    ],
  },
  // The seed arrives on a socket (forceInput), so the card is the prompt
  // alone, with its {a|b} choice sets.
  AUSBOSS_NODES_PromptVariations: {
    minWidth: 300,
    rows: [{ widget: "text", kind: "textarea", placeholder: "A woman in a {red|blue|green} {sweater|jacket}. One choice is picked from each set.", height: 100, grow: true }],
  },
  // All the words go in the box, and the strip under it shows when each
  // moment plays. The pictures, the video, the voice and the song arrive on
  // sockets, and each picture's job sits under the words.
  AUSBOSS_NODES_H3PromptWriter: {
    minWidth: 420,
    hide: ["job_1", "job_2", "job_3", "job_4", "video_job"],
    socketless: ["job_1", "job_2", "job_3", "job_4", "video_job"],
    resetUnknown: { sound: "", music: "", clip_sound: false },
    rows: [
      { section: "发生什么" },
      {
        widget: "script", kind: "textarea", height: 118, grow: true,
        placeholder: "写清楚发生什么，每件事一行。图片 1 是 @1。空一行表示切到新场景。\n\n换人：留空，或写清谁上。想要新造型可单独写一行：@1 看起来像金发、穿黑色卫衣的女人。",
      },
      { panel: momentStrip, height: 76 },
      { widget: "sound", label: "Sound", placeholder: "雨打在窗户上" },
      { widget: "music", label: "Music", placeholder: "慢速钢琴：音乐让它更响" },
      { section: "图片与设置" },
      { panel: castChips, height: 30 },
      { widget: "seconds", label: "Length", suffix: "s", readOnlyText: (node, values) => clipSetsDuration(node, values) ? "取自片段" : "", readOnlyTitle: "这个视频任务用上了传入的片段，因此「长度」不生效。" },
      { widget: "camera", label: "Camera", kind: "select" },
      { widget: "look", label: "Look", kind: "select" },
      { group: "more", label: "More" },
      { widget: "song_start", label: "歌曲起点", suffix: "s", decimals: 1, trimZeros: true, group: "more" },
      { widget: "cut_on_beat", label: "节拍点切换", group: "more" },
      { widget: "language", label: "Language", group: "more" },
      { widget: "clip_sound", label: "片段自带声音", group: "more" },
    ],
  },
  // Saved by a 1.x release, these two hold that empty value too and open
  // with preview on, like Mask Refine.
  AUSBOSS_NODES_SelectFrame: { minWidth: 280, first: true, resetUnknown: { preview: true }, rows: [{ widget: "frame_number", label: "Frame" }] },
  AUSBOSS_NODES_LaMaInpaint: { minWidth: 280, first: true, resetUnknown: { preview: true }, rows: [{ widget: "model", label: "Model", kind: "select" }] },
  AUSBOSS_NODES_Krea2OutpaintModelPatch: {
    minWidth: 320,
    rows: [
      { widget: "placement", label: "Reference", kind: "segment", labels: { "source rectangle": "源矩形", "whole canvas": "整张画布" } },
      { widget: "kv_cache", label: "KV 缓存", onText: "每次运行一次", offText: "每一步" },
    ],
  },
  AUSBOSS_NODES_Krea2Encode: {
    minWidth: 320,
    rows: [
      { widget: "prompt", kind: "textarea", placeholder: "提示词 —— 描述整张成图", height: 96, grow: true },
      { widget: "negative_prompt", kind: "textarea", placeholder: "反向提示词（CFG 为 1 时忽略）", height: 44 },
      { widget: "vlm_reference", label: "VLM 参考", title: "开启时视觉塔也能看到参考图。AnyPaint 配整张画布参考时打开；Registered Outpaint 配源矩形参考时关闭。以适配器约定的条件方式为准。" },
    ],
  },
  AUSBOSS_NODES_LoadVideo: {
    minWidth: 320, first: true, hide: ["upload"],
    rows: [
      { widget: "video", label: "Source", kind: "select", preview: { kind: "video", url: viewUrl },
        button: { text: PANEL_LABELS.load, title: "把视频上传到 ComfyUI 的 input 目录", onClick: (node) => node.widgets?.find((w) => w.name === "upload")?.callback?.() } },
      { widget: "custom_width", label: "Width", suffix: "px", title: "0 表示保持源宽度；只填一边才能保住比例。" },
      { widget: "custom_height", label: "Height", suffix: "px", title: "0 表示保持源高度；只填一边才能保住比例。" },
      { widget: "every_nth", label: "每隔几个" },
      { widget: "max_frames", label: "Limit" },
    ],
  },
  AUSBOSS_NODES_LoadAudio: {
    // The wave, IN and OUT live in the panel under the card (js/load_audio).
    minWidth: 280, first: true, hide: ["upload"],
    rows: [
      { widget: "audio", label: "Source", kind: "select",
        button: { text: PANEL_LABELS.load, title: "把音频文件上传到 ComfyUI 的 input 目录", onClick: (node) => node.widgets?.find((w) => w.name === "upload")?.callback?.() } },
      { widget: "max_seconds", label: "最长时长", suffix: "s", decimals: 1, trimZeros: true,
        title: "声音可以达到的最长时长。超出的部分会被截掉并标红。0 表示不限。" },
    ],
  },
  AUSBOSS_NODES_LoadImagePad: {
    minWidth: 340, first: true, hide: ["upload"],
    rows: [
      { widget: "image", label: "Source", kind: "select", preview: { kind: "image", url: viewUrl }, linkedBy: ["source_image"],
        button: { text: PANEL_LABELS.load, title: "把图片上传到 ComfyUI 的 input 目录", onClick: (node) => node.widgets?.find((w) => w.name === "upload")?.callback?.() } },
      { widget: "mode", label: "Fill", kind: "select" },
      { widget: "fill_color", label: "Color", kind: "color", when: isMode("mode", "color") },
      { widget: "backdrop_blur", label: "Backdrop", when: isMode("mode", "黑边模糊") },
      { widget: "feather", label: "Feather", suffix: "px" },
      { widget: "canvas_multiple", label: "Multiple", snap: true, step: 8 },
      { widget: "target_megapixels", label: "Budget", suffix: "MP" },
      { group: "padding", label: "精确扩边" },
      { widget: "pad_left", label: "Left", suffix: "px", group: "padding" },
      { widget: "pad_top", label: "Top", suffix: "px", group: "padding" },
      { widget: "pad_right", label: "Right", suffix: "px", group: "padding" },
      { widget: "pad_bottom", label: "Bottom", suffix: "px", group: "padding" },
    ],
  },
  AUSBOSS_NODES_SaveVideo: {
    // step_preview is the Preview steps switch on the player (js/save_video).
    minWidth: 320, first: true, hide: ["step_preview"],
    rows: [
      { widget: "filename_prefix", label: "Prefix", placeholder: "video" },
      { widget: "format", label: "Format", kind: "select" },
      // CRF and Metadata show only for the formats that read them; fps keeps
      // its lifted socket either way.
      { pair: ["fps", "crf"], label: "FPS · CRF", sep: "·", top: true, when: formatReads("crf") },
      { widget: "fps", label: "FPS", top: true, when: (values) => !formatReads("crf")(values) },
      { widget: "pingpong", label: "Ping-pong", onText: "正放、倒放", offText: "off" },
      { widget: "save_metadata", label: PANEL_LABELS.embed, onText: PANEL_LABELS.on, offText: PANEL_LABELS.off, when: formatReads("save_metadata"), title: "开启后会把工作流嵌进视频文件里，把这个文件拖回画布就能还原出产出它的图。" },
    ],
  },
};

function cardWidgetNames(config) {
  return [...config.rows.flatMap((row) => row.pair ?? (row.widget ? [row.widget] : [])), ...(config.hide ?? [])];
}

app.registerExtension({
  name: "ausboss.widget_cards",
  // The widgets of the inputs a card lists as socketless (markSocketless in
  // shared/widget_card_math.mjs): the stock ones, marked socketless so the
  // frontend gives them no input slot - no dot to draw or aim at in either
  // renderer, no row to reserve.
  getCustomWidgets() {
    return {
      // inputData is the input's spec: its options hold the choices.
      [SOCKETLESS_CHOICE](node, inputName, inputData) {
        const spec = inputData?.[1] ?? {};
        const values = Array.isArray(spec.options) ? spec.options : Array.isArray(inputData?.[0]) ? inputData[0] : [];
        const widget = node.addWidget("combo", inputName, spec.default ?? values[0], () => {}, { values });
        widget.options.socketless = true;
        return { widget };
      },
      // A one-line STRING, as the stock text widget is made.
      [SOCKETLESS_TEXT](node, inputName, inputData) {
        const spec = inputData?.[1] ?? {};
        const widget = node.addWidget("text", inputName, spec.default ?? "", () => {}, {});
        if (typeof spec.dynamicPrompts === "boolean") widget.dynamicPrompts = spec.dynamicPrompts;
        widget.options.socketless = true;
        return { widget };
      },
    };
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    const config = CARDS[nodeData?.name];
    if (!config) return;
    hideInputsInDef(nodeData, cardWidgetNames(config));
    if (config.socketless?.length) {
      markSocketless(nodeData, config.socketless);
      // A workflow saved while the widget still had a socket brings the
      // empty slot back with it; an unlinked one goes again.
      chainCallback(nodeType.prototype, "onConfigure", function () {
        for (let index = (this.inputs?.length ?? 0) - 1; index >= 0; index -= 1) {
          const input = this.inputs[index];
          const linked = typeof this.isInputConnected === "function" ? this.isInputConnected(index) : input?.link != null;
          if (config.socketless.includes(input?.widget?.name) && !linked) {
            this.removeInput(index);
          }
        }
      });
    }
    if (config.resetUnknown) {
      // Positional widget values from an older save can land a value that is
      // not one of a choice's options, or not on/off for a switch; put the
      // default back before the card draws it, so the graph queues what the
      // user sees.
      chainCallback(nodeType.prototype, "onConfigure", function () {
        resetUnknownValues(this.widgets, config.resetUnknown);
      });
    }
    if (config.takesWired) {
      // Only a box made by hand is "new": one that came with a workflow or a
      // paste was configured, and keeps the value it was saved with.
      const initial = nodeData?.input?.required?.[config.takesWired]?.[1]?.default ?? 0;
      chainCallback(nodeType.prototype, "onNodeCreated", function () { this.__ausbossNew = true; });
      chainCallback(nodeType.prototype, "onConfigure", function () { this.__ausbossNew = false; });
      chainCallback(nodeType.prototype, "onConnectionsChange", function (type, _slot, connected) {
        if (type !== (globalThis.LiteGraph?.OUTPUT ?? 2) || !connected) return;
        const widget = this.widgets?.find((entry) => entry.name === config.takesWired);
        const take = valueToTake({
          fresh: this.__ausbossNew, value: widget?.value, initial,
          wires: this.outputs?.[0]?.links?.length ?? 0, wired: wiredLimits(this),
        });
        this.__ausbossNew = false;
        if (take !== null && widget) commitWidgetValue(this, widget, take, app.canvas);
      });
    }
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      if (this.__ausbossCard) return;
      mountWidgetCard(this, config);
      const width = Math.max(this.size?.[0] || 0, config.minWidth ?? 300);
      this.setSize?.([width, this.computeSize?.()[1] || this.size?.[1] || 0]);
    });
  },
});
