// Seed 🆎's two looks, picked from the gear on its card: the full card
// (the default), or "compact", one short row with the number, a mode chip
// and a new-seed button. The look is kept in the node's properties, so the
// node's inputs, saved values and the prompt it sends are the same in both,
// and the last look picked is what new Seed nodes start with.
//
// Data and decisions only (tests/seed_look.test.mjs); js/seed/index.js
// draws the card.

export const SEED_LOOK_PROPERTY = "ausboss_seed_look";
export const SEED_LOOKS = ["full", "compact"];
export const SEED_LOOK_SCOPE = "seed_look";

export function seedLook(node) {
  return node?.properties?.[SEED_LOOK_PROPERTY] === "compact" ? "compact" : "full";
}

// The full card leaves no property behind, so a node set back to it is
// saved exactly as one that was never changed.
export function setSeedLook(node, look) {
  if (!node) return "full";
  node.properties ??= {};
  if (look === "compact") node.properties[SEED_LOOK_PROPERTY] = "compact";
  else delete node.properties[SEED_LOOK_PROPERTY];
  return seedLook(node);
}

// The gear menu (js/shared/settings_menu.mjs). The pick is also kept as the
// look new Seed nodes start with.
export const SEED_LOOK_MENU = [
  {
    key: "look",
    label: "Look",
    type: "choice",
    options: SEED_LOOKS,
    default: "full",
    hint: "这个 Seed 节点长什么样。新建的 Seed 节点也用这个样子。",
    optionHints: {
      full: "整张卡片：模式按钮、新种子、沿用上次，以及跑过的种子。",
      compact: "一行短条：数字、点一下就能换的模式小块，以及摇新种子的骰子。",
    },
  },
];

// The compact row's chip: tap to go Random -> Fixed -> Step +1 -> Step -1
// -> Random. Values are the frontend's control_after_generate choices.
const CYCLE = ["randomize", "fixed", "increment", "decrement"];

export function nextControl(control) {
  const index = CYCLE.indexOf(control);
  return CYCLE[(index + 1) % CYCLE.length] ?? "fixed";
}

export function controlChip(control) {
  switch (control) {
    case "randomize": return { text: "Random", title: "每次运行后换一个新种子。点一下切到固定。" };
    case "increment": return { text: "+1", title: "每次运行后加 1。点一下切到 -1。" };
    case "decrement": return { text: "−1", title: "每次运行后减 1。点一下切到随机。" };
    default: return { text: "Fixed", title: "每次运行都沿用这个种子。点一下切到 +1。" };
  }
}
