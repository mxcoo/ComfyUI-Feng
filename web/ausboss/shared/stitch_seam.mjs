// Stitch Inpaint's Seam choice as its widget card shows it: the data and
// decisions only (tests/stitch_seam.test.mjs); js/widget_cards/index.js
// builds the DOM.
//
// Seam has no row on the card. A gear in the card's top-right corner opens a
// menu that sets it, a "blend in" chip beside the gear shows it at a glance,
// and blend in mutes Fix edge halo, the one row only the classic seam reads:
// it stays in place, dimmed, so the node keeps its height in either mode.
// Tone match works in both seams.

// The backend's choices, in its order; the first is the default.
export const SEAM_CHOICES = ["classic", "blend in"];
export const PASTE_ONTO_CHOICES = ["crop", "original"];

// The gear menu (js/shared/settings_menu.mjs). persist: false - the choice
// belongs to this node and is never a default for new ones.
export const SEAM_MENU = [
  {
    key: "seam",
    label: "Seam",
    type: "choice",
    options: SEAM_CHOICES,
    default: SEAM_CHOICES[0],
    persist: false,
    hint: "新区域怎么接到你的图上。存在这个节点上。",
    optionHints: {
      classic: "老工作流用的羽化粘贴，配合 Tone match。",
      "blend in": "用于扩图和转过的图；Tone match 照样能用。",
    },
  },
  {
    key: "paste_onto",
    label: "贴到",
    type: "choice",
    options: PASTE_ONTO_CHOICES,
    default: PASTE_ONTO_CHOICES[0],
    persist: false,
    hint: "结果落在哪里。存在这个节点上。",
    optionHints: {
      crop: "照旧返回裁好的那张图。",
      original: "你在 Crop + Rotate + Pad 里手动裁剪之后的整张图。",
    },
  },
];

export function isBlendIn(values) {
  return values?.seam === "blend in";
}

// Hover hints on the rows blend in does not read.
export const SEAM_MUTE_TITLES = {
  fix_edge_halo: "Blend in 用不上 Fix edge halo。要用的先把齿轮菜单里的 Seam 切回 classic。",
};

// Room the corner tools take from every row's control, so the controls keep
// one right edge: the gear alone, or the gear with the chip and its note.
export function seamCornerReserve(values) {
  return isBlendIn(values) ? 84 : 30;
}
