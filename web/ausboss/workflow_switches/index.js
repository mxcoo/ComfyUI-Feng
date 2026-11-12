// Workflow Switches 🆎 — switch parts of a workflow off and on from one card.
//
// The backend registers the node so a workflow that uses it can find the
// pack; this file makes it virtual, so it never enters a prompt, and gives
// it its whole face: one row per switch, a label and an off | on pill.
//
// A switch is either made from picked nodes and groups (select them, press
// + Switch) or a group listed on its own. A made switch can also change
// settings instead of turning nodes off: it remembers what chosen nodes hold
// for on and for off, and a click writes the values that differ (a faster
// LoRA row and fewer steps, say). Or it can have an off side: nodes that run
// only while the row is off, so one click runs one part and switches another
// off (an edit that takes its size from its picture, say). The card has two
// views. The edit view shows everything: a frame button and a menu on each
// row, the bar that makes a switch from the selection, and the settings. Done
// folds all of that away and leaves the labels and their switches: the small
// view a shared workflow ships with.
//
// A card with One at a time on can show its rows as one control instead
// (Show as: one pill): every row is a choice in a segmented pill, or in a
// list when the names are too many or too long, and one is always picked.
// + Choice gets there in one press: it saves how nodes are set now under a
// name, and the card becomes that pill by itself.
//
// Only what the user made is stored (which nodes each switch holds, by id,
// the values it remembers and the settings, in node.properties). Every row's
// state is read from the nodes' own modes and values, so a reloaded workflow, an undo or a node bypassed by
// hand elsewhere always shows right, and a switch whose nodes are only
// partly on reads mixed. The list follows the graph on the canvas's own
// redraws, which the frontend makes whenever the graph or the selection
// changes: no work while nothing changes, at most one read per RECHECK_MS
// while the canvas is busy, and always one after the last redraw. The
// decisions live in js/shared/workflow_switches.mjs under node:test.

import { app } from "../../../../scripts/app.js";
import { BRAND, chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange, showToast } from "../shared/index.mjs";
import { keepKeyInField } from "../shared/canvas_passthrough.mjs";
import { holdNodeMinWidth, holdVueNodeMinWidth, pinVuePanelHeight } from "../shared/panel_layout.mjs";
import { cardHeight, commitWidgetValue, ensureCardCss } from "../shared/widget_card.mjs";
import {
  DEFAULT_SETTINGS, SETTINGS_PROPERTY, SWITCHES_MAX, TITLE_MAX, addChoice, addMembers, addOffMembers, addSwitch, cardView, choiceNodeIds,
  choiceState, choosePlan, flipTo, frameBounds, freeForChoice, groupBounds, hasChoices, hasOffSide, heldCount, listedRows, modeMatters, moveSwitch,
  normalizeSettings, offFreshCount, offHeldCount, pairValue, placeNodes, readGroups, readSwitches, removeMembers, removeOffMembers,
  removeSwitch, renameSwitch, repointSwitches, rowLabel, rowsSignature, sameChoice, saveValues, settlePlan, snapshotNode, suggestTitle,
  switchAllPlan, switchPlan, valueAllPlan, valuePlan,
} from "../shared/workflow_switches.mjs";
import { onPaste } from "../shared/paste_ids.mjs";

const NODE_CLASS = "AUSBOSS_NODES_WorkflowSwitches";
const CSS_ID = "ausboss-workflow-switches-css";
const WIDGET_NAME = "ausboss_workflow_switches";
// The two disclosures, named like a widget card's groups: the edit view, and
// the settings inside it.
const SHOW_EDIT = "ausboss_show_edit";
const SHOW_SETTINGS = "ausboss_show_settings";
const NODE_WIDTH = 320;
// The narrowest each view still reads at: a label and a pill, or those plus
// the two row buttons.
const SMALL_MIN_WIDTH = 200;
const EDIT_MIN_WIDTH = 300;
// Same wrapper allowance as the widget cards (js/shared/widget_card.mjs).
const WRAPPER_INSET = 16;
const HINT_HEIGHT = 34;
// Where the card starts under the title bar (the node has no slots).
const WIDGETS_TOP = 2;
// LiteGraph leaves room under a node's last widget for the slots a node
// usually has above it. This one has none, so the card sat twice as far from
// the bottom edge as from the title bar. This much is given back.
const BOTTOM_TRIM = 10;
const RECHECK_MS = 150;
// How much of the view the frame button fills with a part.
const FRAME_FILL = 0.8;
// What a group with no color set is drawn with (LGraphGroup.defaultColour).
const NO_COLOR = "#335";
// The type a pill's choices are set in. Their names are measured with it, so
// the card can be as wide as its pill needs.
const CHOICE_FONT = `600 10.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;

const live = new Set();
let hookedCanvas = null;
const groupKeys = new WeakMap();
let nextGroupKey = 1;
let openMenu = null;

function ensureCss() {
  ensureCardCss();
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
.ausboss-ws{box-sizing:border-box;width:100%;height:100%;overflow:hidden;pointer-events:none}
.ausboss-ws .ausboss-ws-list{display:contents}
.ausboss-ws .ausboss-ws-row{grid-template-columns:10px minmax(0,1fr) auto 84px;gap:7px}
.ausboss-ws.edit .ausboss-ws-row{grid-template-columns:10px minmax(0,1fr) auto 84px 26px 26px}
.ausboss-ws-chip{width:10px;height:10px;border-radius:3px;background:var(--chip);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16)}
.ausboss-ws .ausboss-ws-row.choice{grid-template-columns:10px minmax(0,1fr) auto}
.ausboss-ws.edit .ausboss-ws-row.choice{grid-template-columns:10px minmax(0,1fr) auto 26px 26px}
.ausboss-ws-row.choice .ausboss-ws-pill{display:none}
.ausboss-ws-row.off .ausboss-ws-chip{background:transparent;box-shadow:inset 0 0 0 2px var(--chip),0 0 0 1px rgba(255,255,255,.1)}
.ausboss-ws-row.mixed .ausboss-ws-chip{background:linear-gradient(90deg,var(--chip) 50%,transparent 50%);box-shadow:inset 0 0 0 2px var(--chip),0 0 0 1px rgba(255,255,255,.1)}
.ausboss-ws-row.empty .ausboss-ws-chip{opacity:.4}
.ausboss-ws-title{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#d8ecea;user-select:none}
.ausboss-ws-row.off .ausboss-ws-title,.ausboss-ws-row.empty .ausboss-ws-title{color:#6f8886}
.ausboss-ws-title[hidden],.ausboss-ws-name[hidden]{display:none}
.ausboss-ws-count{color:#78908e;font-size:10px;font-variant-numeric:tabular-nums;user-select:none}
.ausboss-ws-pill.mixed{background:repeating-linear-gradient(135deg,rgba(0,180,170,.2) 0 3px,transparent 3px 7px),#0f1516}
.ausboss-ws-pill.mixed button{color:#bfe6e2}
.ausboss-ws-row.empty .ausboss-ws-pill{opacity:.35;pointer-events:none}
.ausboss-ws-tool{display:none;place-items:center;width:26px;height:26px;padding:0;border:1px solid #2a3437;border-radius:6px;background:#0f1516;color:#8ba3a1;font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
.ausboss-ws.edit .ausboss-ws-tool{display:grid}
.ausboss-ws.edit .ausboss-ws-tool.none{visibility:hidden}
.ausboss-ws-tool:hover,.ausboss-ws-tool.open{border-color:${BRAND};color:#fff}
.ausboss-ws-tool svg{display:block}
.ausboss-ws-sides{display:none;place-items:center;width:14px;height:14px;color:#78908e;cursor:help}
.ausboss-ws-sides:hover{color:#d8ecea}
.ausboss-ws-sides svg{display:block;width:12px;height:12px}
.ausboss-ws.edit .ausboss-ws-row.sided{grid-template-columns:10px minmax(0,1fr) auto auto 84px 26px 26px}
.ausboss-ws.edit .ausboss-ws-row.sided .ausboss-ws-sides{display:grid}
.ausboss-ws .ausboss-ws-pick{grid-template-columns:minmax(0,1fr)}
.ausboss-ws-pick [hidden]{display:none}
.ausboss-ws-choices button{padding:0 6px;font:${CHOICE_FONT}}
.ausboss-ws-choices button.mixed{background:repeating-linear-gradient(135deg,rgba(0,180,170,.2) 0 3px,transparent 3px 7px);color:#bfe6e2}
.ausboss-ws-choices button.empty{opacity:.35;pointer-events:none}
.ausboss-ws-choices.settled button.on{cursor:default}
.ausboss-ws-choices.unsettled,.ausboss-ws-choice-list.unsettled{border-color:rgba(255,196,107,.6)}
.ausboss-ws.pick .ausboss-ws-pill{display:none}
.ausboss-ws.pick:not(.edit) .ausboss-ws-row{display:none}
.ausboss-ws.pick.edit .ausboss-ws-row{grid-template-columns:10px minmax(0,1fr) auto 26px 26px}
.ausboss-ws.pick.edit .ausboss-ws-row.sided{grid-template-columns:10px minmax(0,1fr) auto auto 26px 26px}
.ausboss-ws-hint{height:${HINT_HEIGHT}px;flex:none;display:flex;align-items:center;padding:0;border:none;background:transparent;color:#78908e;font:inherit;font-size:11px;line-height:1.35;text-align:left;user-select:none;pointer-events:auto}
.ausboss-ws-hint.link{cursor:pointer}
.ausboss-ws-hint.link:hover{color:#d8ecea}
.ausboss-ws-hint.hidden,.ausboss-ws-bar.hidden{display:none}
.ausboss-ws .ausboss-ws-bar{grid-template-columns:minmax(0,1fr) auto;gap:7px}
.ausboss-ws .ausboss-ws-bar.both{grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto}
.ausboss-ws-add.hidden{display:none}
.ausboss-ws-add{min-width:0;height:100%;padding:0 10px;border:1px dashed #33514f;border-radius:6px;background:transparent;color:#78908e;font:600 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;cursor:pointer}
.ausboss-ws-add.ready{border-style:solid;border-color:rgba(0,180,170,.55);background:rgba(0,180,170,.14);color:#d8ecea}
.ausboss-ws-add:hover{border-color:${BRAND};color:#fff}
.ausboss-ws-done{height:100%;padding:0 14px;border:1px solid ${BRAND};border-radius:6px;background:${BRAND};color:#04201d;font:700 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
.ausboss-ws-done:hover{background:#19c9bf;border-color:#19c9bf}
.ausboss-ws-menu{position:fixed;z-index:10000;min-width:200px;padding:4px;border:1px solid #2a3437;border-radius:8px;background:#11181a;box-shadow:0 8px 28px rgba(0,0,0,.5);font:12px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#d8ecea}
.ausboss-ws-menu-head{padding:5px 8px 6px;border-bottom:1px solid #223033;margin-bottom:3px;color:#78908e;font-size:10px;line-height:1;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
.ausboss-ws-menu-head.sub{border-bottom:none;margin-bottom:0;padding-bottom:3px}
.ausboss-ws-menu-item{display:block;width:100%;padding:6px 8px;border:none;border-radius:5px;background:transparent;color:inherit;font:inherit;text-align:left;white-space:nowrap;cursor:pointer}
.ausboss-ws-menu-item:hover{background:#1d2a2c;color:#fff}
.ausboss-ws-menu-item:disabled{color:#566b69;cursor:default;background:transparent}
.ausboss-ws-menu-item.danger:hover{background:#3a1f22;color:#ffb4b4}
.ausboss-ws-menu-rule{height:1px;margin:3px 4px;background:#223033}
`;
  document.head.append(style);
}

// ---------- DOM helpers ----------

function el(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, title) {
  const node = el("button", className, text);
  node.type = "button";
  if (title) node.title = title;
  return node;
}

function svgIcon(build) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("aria-hidden", "true");
  build((tag, attributes) => {
    const shape = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
    svg.append(shape);
  });
  return svg;
}

// Four corners around a dot: bring this part into view.
function frameIcon() {
  return svgIcon((add) => {
    add("path", {
      d: "M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4", fill: "none", stroke: "currentColor",
      "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round",
    });
    add("circle", { cx: "8", cy: "8", r: "1.7", fill: "currentColor" });
  });
}

// Three dots: what else this switch can do.
function moreIcon() {
  return svgIcon((add) => {
    for (const cx of ["3", "8", "13"]) add("circle", { cx, cy: "8", r: "1.5", fill: "currentColor" });
  });
}

// Two arrows, one each way: this switch has an off side.
function sidesIcon() {
  return svgIcon((add) => {
    add("path", {
      d: "M2 5h11M10 2l3 3-3 3M14 11H3M6 8l-3 3 3 3", fill: "none", stroke: "currentColor",
      "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round",
    });
  });
}

// "a", "a and b", "a, b and c": a click's effects as one short sentence.
function andList(parts) {
  const list = parts.filter(Boolean);
  return list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

// ---------- reading ----------

function isSwitches(node) {
  return node?.comfyClass === NODE_CLASS || node?.type === NODE_CLASS;
}

function groupKey(group) {
  let key = groupKeys.get(group);
  if (!key) {
    key = nextGroupKey++;
    groupKeys.set(group, key);
  }
  return key;
}

function rowKey(row) {
  return row.kind === "switch" ? `s${row.entry.id}` : `g${groupKey(row.group)}`;
}

function settingsOf(node) {
  return normalizeSettings(node.properties?.[SETTINGS_PROPERTY]);
}

function editOpen(node) {
  return Boolean(node.properties?.[SHOW_EDIT]);
}

function settingsOpen(node) {
  return Boolean(node.properties?.[SHOW_SETTINGS]);
}

// The narrowest the node goes: what its view needs, and what its pill needs
// to show every name in full.
function minWidth(node) {
  const view = editOpen(node) ? EDIT_MIN_WIDTH : SMALL_MIN_WIDTH;
  return Math.max(view, node.__ausbossWorkflowSwitches?.pillWidth ?? 0);
}

// A name's width in a pill, measured in the type the pill sets it in.
let measuring = null;
function nameWidth(text) {
  measuring ??= document.createElement("canvas").getContext("2d");
  if (!measuring) return String(text).length * 7;
  measuring.font = CHOICE_FONT;
  return measuring.measureText(String(text)).width;
}

// How the card shows its rows: "rows", "pill" or "list".
function viewOf(settings, rows) {
  return cardView(settings, rows, nameWidth);
}

function read(state) {
  const graph = state.node.graph;
  const settings = settingsOf(state.node);
  if (!graph) return { settings, groups: [], rows: [] };
  const lite = globalThis.LiteGraph;
  const placed = placeNodes(graph.nodes ?? graph._nodes ?? [], {
    skip: isSwitches,
    measure: { titleHeight: lite?.NODE_TITLE_HEIGHT ?? 30, collapsedWidth: lite?.NODE_COLLAPSED_WIDTH ?? 80 },
  });
  const groups = readGroups(graph.groups ?? graph._groups ?? [], placed, { counts: modeMatters });
  const made = readSwitches(settings.switches, placed, groups, { counts: modeMatters });
  return { settings, groups, rows: listedRows(made, groups, settings) };
}

function nodeTitle(node) {
  const title = node?.title || node?.constructor?.title || node?.type || "Node";
  return String(title).replace(/\s*🆎\s*$/u, "");
}

function isGroupItem(item) {
  const Group = globalThis.LiteGraph?.LGraphGroup;
  return Boolean(Group && item instanceof Group);
}

function isNodeItem(item) {
  const Node = globalThis.LiteGraph?.LGraphNode;
  return Boolean(Node && item instanceof Node);
}

// What is selected on this node's graph right now, apart from Workflow
// Switches nodes: the nodes and groups a new switch would hold.
function picked(state) {
  const canvas = app.canvas;
  const items = canvas?.selectedItems ? [...canvas.selectedItems] : Object.values(canvas?.selected_nodes ?? {});
  const graph = state.node.graph;
  const nodes = [];
  const groups = [];
  for (const item of items) {
    if (!item || (item.graph && graph && item.graph !== graph)) continue;
    if (isGroupItem(item)) {
      // A switch finds a group again by its id.
      if (Number.isInteger(item.id) && item.id >= 0) groups.push(item);
    }
    else if (isNodeItem(item) && !isSwitches(item)) nodes.push(item);
  }
  return { nodes, groups, count: nodes.length + groups.length };
}

function pickedIds(pick) {
  return { nodes: pick.nodes.map((node) => node.id), groups: pick.groups.map((group) => group.id) };
}

// ---------- switching ----------

// Mode changes go straight onto the nodes, the way the frontend's own group
// menu and Ctrl+B make them. A setting is written to its control the way a
// hand edit writes it (value, the control's callback, then the node is
// told), so the node's own card or panel follows in both renderers. Then one
// graph change and one undo step.
function applyPlan(state, plan, values = []) {
  if (!plan.length && !values.length) return;
  for (const [node, mode] of plan) node.mode = mode;
  for (const [pair, side] of values) {
    const control = pair.control;
    const next = pairValue(pair, side, control.value);
    if (next === control.value) continue;
    try {
      commitWidgetValue(pair.live, control, next, app.canvas);
    } catch (_error) {
      // A callback that expects a mouse event must not stop the others: the
      // value itself is what the run reads.
      control.value = next;
    }
    pair.live.setDirtyCanvas?.(true, true);
  }
  const graph = state.node.graph;
  if (typeof graph?.change === "function") graph.change();
  else graph?.setDirtyCanvas?.(true, true);
  notifyAusbossChange();
}

// Each half sets the state it names; clicking the selected half leaves it set.
function switchRow(state, key, side) {
  const { settings, rows } = read(state);
  const target = rows.find((row) => rowKey(row) === key);
  if (!target) return;
  const on = flipTo(target.state, side);
  applyPlan(state, switchPlan(rows, target, on, settings), valuePlan(rows, target, on, settings));
  refresh(state);
}

// A click on a choice of the pill, or a pick from its list: that row goes on
// and every other row off. The choice that is already the only one on changes
// nothing, so one is always picked.
function chooseRow(state, key) {
  const { settings, rows } = read(state);
  const target = rows.find((row) => rowKey(row) === key);
  if (target) {
    const { modes, values } = choosePlan(rows, target, settings);
    applyPlan(state, modes, values);
  }
  // Drawn again even when nothing changed: a list must not keep showing a
  // pick that was not taken.
  state.signature = "";
  refresh(state);
}

// Nodes just given to a choice follow the pick at once: off, when another
// choice is picked.
function repick(state) {
  const row = choiceState(read(state).rows).picked;
  if (row) chooseRow(state, rowKey(row));
}

function switchAll(state, on) {
  const { settings, rows } = read(state);
  applyPlan(state, switchAllPlan(rows, on, settings), valueAllPlan(rows, on));
  refresh(state);
}

// One at a time holds for rows that did not come from a click on a row: a
// new switch (`fresh`, its key) and the setting being turned on.
function settleRows(state, fresh) {
  const { settings, rows } = read(state);
  const { modes, values } = settlePlan(rows, settings, rows.find((row) => rowKey(row) === fresh));
  applyPlan(state, modes, values);
  refresh(state);
}

function frameRow(state, key) {
  const row = read(state).rows.find((candidate) => rowKey(candidate) === key);
  const found = row?.kind === "group" ? groupBounds(row.group) : row?.rect;
  if (!found) return;
  const canvas = app.canvas;
  const view = canvas?.canvas?.getBoundingClientRect?.();
  const rect = frameBounds(found, [view?.width, view?.height], FRAME_FILL);
  if (typeof canvas?.animateToBounds === "function") {
    canvas.animateToBounds(rect, { zoom: FRAME_FILL });
    return;
  }
  if (typeof canvas?.ds?.fitToBounds === "function") {
    canvas.ds.fitToBounds(rect, { zoom: FRAME_FILL });
    canvas.setDirty?.(true, true);
  }
}

// ---------- settings and views ----------

function writeSettings(state, next, { settle = true } = {}) {
  const node = state.node;
  node.properties ??= {};
  node.properties[SETTINGS_PROPERTY] = normalizeSettings(next);
  if (settle) notifyAusbossChange();
  refresh(state);
}

function patchSettings(state, patch, options) {
  writeSettings(state, { ...settingsOf(state.node), ...patch }, options);
}

// Open the edit view, or fold it down to the labels and their switches.
function setEdit(state, open) {
  const node = state.node;
  if (editOpen(node) === open) return;
  closeMenu();
  if (!open) stopRename(state, { keep: true });
  node.properties ??= {};
  node.properties[SHOW_EDIT] = open;
  notifyAusbossChange();
  refresh(state);
}

function settingsRow(label, title) {
  const row = el("div", "ausboss-card-row");
  const caption = el("span", "ausboss-card-label", label);
  caption.title = title;
  const control = el("div", "ausboss-card-control");
  row.append(caption, control);
  return { row, control };
}

// A segmented pill over one setting; `labels` maps values to what the pill
// says. An off | on pill (`flips`) is one switch like the rows above it: a
// click on either half flips it.
function segmentRow(state, key, label, title, values, labels = {}, { flips = false } = {}) {
  const { row, control } = settingsRow(label, title);
  const seg = el("div", "ausboss-card-seg");
  const buttons = new Map();
  for (const value of values) {
    const choice = button("", labels[value] ?? String(value), title);
    choice.addEventListener("click", () => {
      patchSettings(state, { [key]: flips ? !settingsOf(state.node)[key] : value });
      if (key === "exclusive") settleRows(state);
    });
    seg.append(choice);
    buttons.set(value, choice);
  }
  control.append(seg);
  const sync = (settings) => {
    for (const [value, choice] of buttons) choice.classList.toggle("on", settings[key] === value);
  };
  return { row, sync };
}

// A select over one setting, for choices too long to sit side by side.
function selectRow(state, key, label, title, labels) {
  const { row, control } = settingsRow(label, title);
  const select = el("select", "ausboss-card-select");
  select.title = title;
  for (const [value, text] of Object.entries(labels)) {
    const option = el("option", "", text);
    option.value = value;
    select.append(option);
  }
  select.addEventListener("change", () => patchSettings(state, { [key]: select.value }));
  control.append(select);
  const sync = (settings) => {
    if (select.value !== settings[key]) select.value = settings[key];
  };
  return { row, sync };
}

function buildSettings(state) {
  const header = button("ausboss-card-group", undefined, "关闭时的含义、哪些组各占一个开关，以及它们的顺序");
  header.append(el("span", "glyph", "▸"), el("span", "", "Settings"));
  header.addEventListener("click", () => {
    const node = state.node;
    node.properties ??= {};
    node.properties[SHOW_SETTINGS] = !settingsOpen(node);
    refresh(state);
  });

  const off = segmentRow(
    state, "off", "关闭时",
    "被关掉的部分会怎样。旁路：它的节点把输入原样透传，工作流其余部分照常运行。静音：它的节点不运行，需要它输出的节点也不运行。",
    ["bypass", "mute"],
  );
  const groups = selectRow(
    state, "groups", "Groups",
    "哪些组各占一个开关，列在你做的开关下面：不列组、每个组、带编号的组（标题以数字开头，如 1 · Load），或标题匹配文字的组。",
    { none: "不列组", all: "每个组", numbered: "编号组", matching: "标题匹配…" },
  );

  const match = settingsRow("Match", "逗号分隔的文字；组标题含其中任意一项就列出");
  const text = el("input", "ausboss-card-text");
  text.type = "text";
  text.spellcheck = false;
  text.placeholder = "放大, 脸部";
  text.title = "逗号分隔的文字；组标题含其中任意一项就列出";
  text.addEventListener("input", () => patchSettings(state, { match: text.value }, { settle: false }));
  text.addEventListener("change", () => notifyAusbossChange());
  text.addEventListener("keydown", (event) => {
    keepKeyInField(event);
    if (event.key === "Enter" || event.key === "Escape") text.blur();
  });
  match.control.append(text);

  const order = segmentRow(
    state, "order", "组顺序",
    "组行的顺序。画布：按工作流的阅读顺序，从左往右一列列来，列内从上到下。标题：按标题排，数字按数值大小。",
    ["canvas", "title"],
  );
  const exclusive = segmentRow(
    state, "exclusive", "一次一个",
    "打开一行会关掉其它行——适合互为替代的选项，比如两个放大节点。",
    [false, true],
    { false: "off", true: "on" },
    { flips: true },
  );
  exclusive.row.querySelector(".ausboss-card-seg")?.classList.add("ausboss-card-bool");
  const show = segmentRow(
    state, "show", "显示为",
    "行：每个开关占一行，各有自己的 关 | 开。单个胶囊：所有开关变成一颗胶囊里的选项，总有一个被选中。",
    ["rows", "pill"],
    { pill: "单个胶囊" },
  );

  const rows = { off, groups, match: { row: match.row }, order, exclusive, show };
  const sync = (settings, edit, open) => {
    // A card of choices is one pill: none of these mean anything on it.
    const shown = edit && !hasChoices(settings);
    header.classList.toggle("open", open);
    header.style.display = shown ? "" : "none";
    const listing = settings.groups !== "none";
    for (const entry of Object.values(rows)) entry.row.classList.toggle("hidden", !shown || !open);
    match.row.classList.toggle("hidden", !shown || !open || settings.groups !== "matching");
    order.row.classList.toggle("hidden", !shown || !open || !listing);
    show.row.classList.toggle("hidden", !shown || !open || !settings.exclusive);
    for (const entry of [off, groups, order, exclusive, show]) entry.sync(settings);
    if (document.activeElement !== text) text.value = settings.match;
  };
  return { header, rows: Object.values(rows).map((entry) => entry.row), sync };
}

// How many setting rows are showing, for the card's height.
function settingsRowCount(settings) {
  let count = 3; // when off, groups, one at a time
  if (settings.groups !== "none") count += 1; // group order
  if (settings.groups === "matching") count += 1; // match
  if (settings.exclusive) count += 1; // show as
  return count;
}

// ---------- making and changing switches ----------

function newSwitch(state) {
  const pick = picked(state);
  if (!pick.count) {
    showToast({
      summary: "工作流开关",
      detail: "先选中这个开关要开、要关的节点，再按一次。比如一个框和它的 Save 按钮。",
    });
    return;
  }
  const settings = settingsOf(state.node);
  const title = suggestTitle(
    {
      nodes: pick.nodes.map((node) => ({ title: nodeTitle(node), box: node.isSubgraphNode?.() === true })),
      groups: pick.groups.map((group) => ({ title: group.title })),
    },
    settings.switches.map((entry) => entry.title),
  );
  const made = addSwitch(settings, { title, ...pickedIds(pick) });
  if (made.id === null) {
    showToast({ summary: "工作流开关", severity: "warn", detail: `一张卡片最多放 ${SWITCHES_MAX} 个开关。` });
    return;
  }
  writeSettings(state, made.settings);
  settleRows(state, `s${made.id}`);
  startRename(state, `s${made.id}`);
}

// The nodes to read for a choice: what is selected, and on a card that already
// has choices the nodes they hold, so the next one takes no selecting.
function choiceSnapshots(state, nodes) {
  const graph = state.node.graph;
  const held = choiceNodeIds(settingsOf(state.node)).map((id) => graph?.getNodeById?.(id)).filter(Boolean);
  return [...new Set([...nodes, ...held])]
    .map((node) => ({ id: node.id, values: snapshotNode(node) }))
    .filter((item) => Object.keys(item.values).length);
}

// Save how the nodes are set right now as a choice with a name. The new
// choice is what the nodes hold already, so it reads as the picked one and
// nothing on the graph changes.
function newChoice(state) {
  const settings = settingsOf(state.node);
  const first = !hasChoices(settings);
  const snapshots = choiceSnapshots(state, picked(state).nodes);
  if (!snapshots.length) {
    showToast({ summary: "工作流开关", detail: "先选中一个带设置的节点，把它调成这个选项该有的样子，再按 + 选项。" });
    return;
  }
  const same = sameChoice(settings, snapshots);
  if (same) {
    showToast({ summary: "工作流开关", detail: `这就是“${same.title}”的设置。先改一项设置，再按 + 选项。` });
    return;
  }
  const title = suggestTitle({ nodes: [{ title: "Choice" }] }, settings.switches.map((entry) => entry.title));
  const made = addChoice(settings, { title, snapshots });
  if (made.id === null) {
    showToast({ summary: "工作流开关", severity: "warn", detail: `一张卡片最多放 ${SWITCHES_MAX} 个选项。` });
    return;
  }
  writeSettings(state, made.settings);
  startRename(state, `s${made.id}`);
  if (first) showToast({ summary: "工作流开关", detail: "已保存。现在把节点换成另一种设置，再按一次 + 选项。" });
}

// Save a choice again, the way its nodes and any selected ones are set now.
function resaveChoice(state, key, pick) {
  const row = read(state).rows.find((candidate) => rowKey(candidate) === key);
  if (!row) return;
  const snapshots = choiceSnapshots(state, [...pick.nodes, ...row.valueNodes]);
  writeSettings(state, saveValues(settingsOf(state.node), Number(key.slice(1)), "on", snapshots));
  showToast({ summary: "工作流开关", detail: `"${row.title}”现在记下了它的节点当前的设置。` });
}

function startRename(state, key) {
  const entry = state.rows.get(key);
  if (!entry?.name) return;
  stopRename(state, { keep: true });
  state.renaming = key;
  entry.name.value = entry.title.textContent ?? "";
  entry.title.hidden = true;
  entry.name.hidden = false;
  entry.name.focus();
  entry.name.select();
}

// Leave the name box. `keep` writes what was typed; without it the old name
// stays.
function stopRename(state, { keep }) {
  const key = state.renaming;
  if (!key) return;
  state.renaming = null;
  const entry = state.rows.get(key);
  if (!entry?.name) return;
  const typed = entry.name.value;
  entry.name.hidden = true;
  entry.title.hidden = false;
  if (!keep) return;
  const id = Number(key.slice(1));
  const settings = settingsOf(state.node);
  const before = settings.switches.find((item) => item.id === id)?.title;
  const next = renameSwitch(settings, id, typed);
  if (next.switches.find((item) => item.id === id)?.title !== before) writeSettings(state, next);
}

function selectMembers(state, key) {
  const row = read(state).rows.find((candidate) => rowKey(candidate) === key);
  const canvas = app.canvas;
  if (!row || !canvas) return;
  const nodes = [...row.members, ...(row.offMembers ?? []), ...(row.valueNodes ?? [])];
  canvas.deselectAll?.();
  if (typeof canvas.select === "function") for (const node of nodes) canvas.select(node);
  else canvas.selectNodes?.(nodes);
  canvas.setDirty?.(true, true);
}

// Remember what the selected nodes hold right now as this switch's on or
// off, and say what that leaves to do.
function saveSide(state, key, side, pick) {
  const id = Number(key.slice(1));
  const snapshots = pick.nodes.map((node) => ({ id: node.id, values: snapshotNode(node) })).filter((item) => Object.keys(item.values).length);
  if (!snapshots.length) {
    showToast({ summary: "工作流开关", severity: "warn", detail: "选中的节点没有可记住的设置。" });
    return;
  }
  writeSettings(state, saveValues(settingsOf(state.node), id, side, snapshots));
  const row = read(state).rows.find((candidate) => rowKey(candidate) === key);
  if (!row) return;
  const other = side === "on" ? "off" : "on";
  let detail = `"${row.title}”现在会改 ${row.pairs.length} setting${row.pairs.length === 1 ? "" : "s"}.`;
  if (row.half) detail = `已保存为 ${side}。现在把这些节点调成 ${other}该有的样子，选中它们，再把那一侧也保存。`;
  else if (!row.pairs.length) detail = `这些节点在开和关两侧的值相同。先改一下，然后再保存一次 ${other}。`;
  showToast({ summary: "工作流开关", detail });
}

function closeMenu() {
  if (!openMenu) return;
  openMenu.abort.abort();
  openMenu.element.remove();
  openMenu.anchor.classList.remove("open");
  openMenu = null;
}

// The three-dot menu of a made switch.
function showMenu(state, key, anchor) {
  const wasOpen = openMenu?.anchor === anchor;
  closeMenu();
  if (wasOpen) return;
  const id = Number(key.slice(1));
  const settings = settingsOf(state.node);
  const index = settings.switches.findIndex((entry) => entry.id === id);
  const entry = settings.switches[index];
  if (!entry) return;
  const pick = picked(state);
  const ids = entry.choice ? freeForChoice(settings, pickedIds(pick)) : pickedIds(pick);
  const held = heldCount(entry, ids);
  const fresh = ids.nodes.length + ids.groups.length - held;
  const offHeld = offHeldCount(entry, ids);
  const offFresh = offFreshCount(entry, ids);
  const inSwitch = held + offHeld;
  const menu = el("div", "ausboss-ws-menu");
  menu.append(el("div", "ausboss-ws-menu-head", entry.title));
  const item = (label, run, { disabled = false, danger = false, title = "" } = {}) => {
    const choice = button(`ausboss-ws-menu-item${danger ? " danger" : ""}`, label, title);
    choice.disabled = disabled;
    choice.addEventListener("click", () => {
      closeMenu();
      run();
    });
    menu.append(choice);
  };
  const rule = () => menu.append(el("div", "ausboss-ws-menu-rule"));
  item("Rename", () => startRename(state, key));
  item("选中它的节点", () => selectMembers(state, key), { title: "选中这个开关会开、会关的所有节点" });
  rule();
  const takeOut = () => item(
    inSwitch > 0 ? `移出选中的 ${inSwitch} selected` : "移出选中的",
    () => writeSettings(state, removeMembers(settings, id, ids)),
    { disabled: inSwitch < 1, title: "先选中这个开关里的节点，再把它们移出" },
  );
  if (entry.choice) {
    item("保存当前的设置", () => resaveChoice(state, key, pick), {
      title: "把节点调成这个选项该有的样子，再选这一项",
    });
    item(
      fresh > 0 ? `The ${fresh} selected ${fresh === 1 ? "runs" : "run"} 只在这个选项下运行` : "选中的只在选这个选项时运行",
      () => {
        writeSettings(state, addMembers(settings, id, ids));
        repick(state);
      },
      { disabled: fresh < 1, title: "选中只有这个选项才需要的节点。选了别的选项时，它们会被关掉。" },
    );
    takeOut();
  }
  else {
    item(
      fresh > 0 ? `加入选中的 ${fresh} selected` : "加入选中的",
      () => writeSettings(state, addMembers(settings, id, ids)),
      { disabled: fresh < 1, title: "先在画布上选中节点或组，再把它们加进这个开关" },
    );
    takeOut();
    rule();
    // The off side: nodes that run only while this switch is off.
    item(
      offFresh > 0 ? `The ${offFresh} selected ${offFresh === 1 ? "runs" : "run"} 只在关闭时运行` : "选中的只在这个开关关闭时运行",
      () => writeSettings(state, addOffMembers(settings, id, ids)),
      {
        disabled: offFresh < 1,
        title: `先选中节点或组。它们只在这个开关关闭时运行，打开时会被 ${settings.off === "mute" ? "muted" : "bypassed"}。`,
      },
    );
    item(
      offHeld > 0 ? `把选中的 ${offHeld} 个从关闭那一侧移出` : "把选中的从关闭那一侧移出",
      () => writeSettings(state, removeOffMembers(settings, id, ids)),
      { disabled: offHeld < 1, title: "选中只在这个开关关闭时运行的节点，再把它们从关闭那一侧移出。它们保持原样。" },
    );
    rule();
    // A switch that changes settings instead of turning nodes off.
    menu.append(el("div", "ausboss-ws-menu-head sub", "改为调设置"));
    const count = pick.nodes.length;
    const how = "把这个开关变成改设置的开关，而不是关掉节点。把选中的节点调成这一侧该有的样子，然后保存。两侧都要做：开关只改那些不同的值。";
    item(count ? `把选中的 ${count} 个保存为开` : "把选中的保存为开", () => saveSide(state, key, "on", pick), { disabled: !count, title: how });
    item(count ? `把选中的 ${count} 个保存为关` : "把选中的保存为关", () => saveSide(state, key, "off", pick), { disabled: !count, title: how });
  }
  rule();
  item("上移", () => writeSettings(state, moveSwitch(settings, id, -1)), { disabled: index < 1 });
  item("下移", () => writeSettings(state, moveSwitch(settings, id, 1)), { disabled: index >= settings.switches.length - 1 });
  rule();
  item(entry.choice ? "删除这个选项" : "删除这个开关", () => writeSettings(state, removeSwitch(settings, id)), {
    danger: true, title: `会删除这个 ${entry.choice ? "choice" : "switch"}。它的节点保持原样。`,
  });

  document.body.append(menu);
  const at = anchor.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  const left = Math.min(at.right - box.width, window.innerWidth - box.width - 8);
  let top = at.bottom + 4;
  if (top + box.height > window.innerHeight - 8) top = Math.max(8, at.top - box.height - 4);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  const abort = new AbortController();
  document.addEventListener(
    "pointerdown",
    (event) => { if (!menu.contains(event.target) && !anchor.contains(event.target)) closeMenu(); },
    { capture: true, signal: abort.signal },
  );
  window.addEventListener(
    "keydown",
    (event) => { if (event.key === "Escape") { event.stopPropagation(); closeMenu(); } },
    { capture: true, signal: abort.signal },
  );
  anchor.classList.add("open");
  openMenu = { element: menu, abort, anchor };
}

// ---------- rows ----------

function buildRow(state, key, made) {
  const row = el("div", "ausboss-card-row ausboss-ws-row");
  const chip = el("span", "ausboss-ws-chip");
  const title = el("span", "ausboss-ws-title");
  const count = el("span", "ausboss-ws-count");
  // Separate off and on targets, backed by the same saved switch.
  const pill = el("div", "ausboss-card-seg ausboss-card-bool ausboss-ws-pill");
  pill.setAttribute("role", "group");
  const offButton = button("", "off");
  const onButton = button("", "on");
  offButton.addEventListener("click", () => switchRow(state, key, false));
  onButton.addEventListener("click", () => switchRow(state, key, true));
  pill.append(offButton, onButton);
  const go = button("ausboss-ws-tool", undefined, "把这个部分移到视野中");
  go.append(frameIcon());
  go.addEventListener("click", () => frameRow(state, key));
  const more = button(`ausboss-ws-tool${made ? "" : " none"}`, undefined, made ? "重命名、修改或删除这个开关" : "");
  more.append(moreIcon());
  if (made) more.addEventListener("click", () => showMenu(state, key, more));
  else more.tabIndex = -1;

  let name = null;
  let sides = null;
  if (made) {
    name = el("input", "ausboss-card-text ausboss-ws-name");
    name.type = "text";
    name.maxLength = TITLE_MAX;
    name.spellcheck = false;
    name.hidden = true;
    name.title = "给这个开关起个名字，然后按回车";
    name.addEventListener("keydown", (event) => {
      keepKeyInField(event);
      if (event.key === "Enter") name.blur();
      else if (event.key === "Escape") stopRename(state, { keep: false });
    });
    name.addEventListener("blur", () => {
      if (state.renaming === key) stopRename(state, { keep: true });
    });
    // A quiet sign, in the edit view only, that this switch has an off side.
    sides = el("span", "ausboss-ws-sides");
    sides.append(sidesIcon());
    row.append(chip, title, name, sides, count, pill, go, more);
  } else {
    row.append(chip, title, count, pill, go, more);
  }
  // A double-click on a label opens the edit view; there, it renames.
  title.addEventListener("dblclick", () => {
    if (!editOpen(state.node)) setEdit(state, true);
    else if (made) startRename(state, key);
  });

  const sync = (data, settings) => {
    const label = rowLabel(data);
    row.classList.toggle("off", data.state === "off");
    row.classList.toggle("mixed", data.state === "mixed");
    row.classList.toggle("empty", data.state === "empty");
    const choice = Boolean(data.entry?.choice);
    row.classList.toggle("choice", choice);
    chip.style.setProperty("--chip", data.color ?? (made ? BRAND : NO_COLOR));
    title.textContent = label;
    const pairs = data.pairs ?? [];
    const offNodes = data.offMembers ?? [];
    const names = data.members.slice(0, 6).map(nodeTitle).join(", ");
    const tail = data.members.length > 6 ? ` 等 ${data.members.length} 个` : "";
    const offNames = offNodes.slice(0, 6).map(nodeTitle).join(", ");
    const offTail = offNodes.length > 6 ? ` 等 ${offNodes.length} 个` : "";
    const sets = pairs.slice(0, 6).map((pair) => `${nodeTitle(pair.live)} (${pair.row ?? (pair.group !== undefined ? `组 ${pair.group}` : pair.widget)})`).join(", ");
    const parts = [];
    if (data.members.length) parts.push(`开、关： ${names}${tail}`);
    if (offNodes.length) parts.push(`只在关闭时运行： ${offNames}${offTail}`);
    if (pairs.length) parts.push(`会改 ${sets}${pairs.length > 6 ? ` 等 ${pairs.length} 项` : ""}`);
    if (sides) {
      row.classList.toggle("sided", hasOffSide(data.entry));
      sides.title = offNodes.length
        ? `只在这个开关关闭时运行： ${offNames}${offTail}（打开时${settings.off === "mute" ? "静音" : "旁路"}）`
        : "关闭那一侧现在什么都没有：放在那里的节点或组已经没了或为空。";
    }
    title.title = made
      ? parts.length ? `${label}: ${parts.join("; ")}` : data.half ? `${label}: ${choice ? "再加一个选项来选" : "只保存了一侧"}` : `${label}：它的节点没了`
      : `${label}：这个组里的每个节点`;
    const waiting = data.half && !pairs.length && !data.members.length;
    // A setting changed by hand to a third value is neither on nor off.
    const changed = data.state === "mixed" && pairs.some((pair) => pair.now === "other");
    // With an off side, a node on it counts when it is switched off.
    const unit = offNodes.length
      ? pairs.length ? "节点和设置都已设为开" : "节点已设为开"
      : pairs.length ? "节点和设置都开着" : "节点会运行";
    count.textContent = changed ? "已改动" : data.state === "mixed" ? `${data.on}/${data.total}` : waiting ? (choice ? "还差一个" : "只设了一侧") : data.state === "empty" ? "空" : "";
    count.title = changed
      ? "这个开关要改的某项设置被手动改成了别的值。点关或开重新设一次。"
      : data.state === "mixed" ? `${data.on} / 共 ${data.total} ${unit}`
      : waiting ? (choice ? "把节点换成另一种设置，再按 + 选项。" : "只保存了一侧。把它的节点换成另一侧的样子，选中它们，再从它的菜单里保存那一侧。")
        : data.state !== "empty" ? ""
          : made ? "这个开关的节点都不在这个工作流里。用旧版 AusBoss 粘贴并保存过的工作流会一直这样：重新打开原文件，或者在编辑视图里从开关的菜单添加节点。" : "这个组里还没有节点";
    pill.classList.toggle("mixed", data.state === "mixed");
    offButton.classList.toggle("on", data.state === "off");
    onButton.classList.toggle("on", data.state === "on");
    offButton.setAttribute("aria-pressed", String(data.state === "off"));
    onButton.setAttribute("aria-pressed", String(data.state === "on"));
    // Nothing of its own to turn off: it only changes settings, or only has an off side.
    const noOwnNodes = !data.members.length && (pairs.length > 0 || offNodes.length > 0);
    const turnOff = andList([
      noOwnNodes ? `关闭「${label}」` : `${settings.off === "mute" ? "静音" : "旁路"}「${label}」`,
      offNodes.length > 0 && "运行只在关闭时才跑的节点",
    ]);
    const turnOn = andList([
      `${noOwnNodes ? "打开" : "运行"}「${label}」`,
      offNodes.length > 0 && `${settings.off === "mute" ? "mute" : "bypass"} 只在关闭时运行的节点`,
      settings.exclusive && "关掉其它行",
    ]);
    offButton.title = turnOff;
    onButton.title = turnOn;
  };
  return { row, title, name, sync };
}

// ---------- one pill for the whole card ----------

// Where a pick-one card stands when it is not settled on one choice, in a
// few words; nothing when it is.
function standText(stand, rows) {
  if (stand.kind === "none") return "什么都没选";
  if (stand.kind === "several") return `${stand.count} 个同时开着`;
  if (stand.kind !== "partly") return "";
  return `"${rowLabel(rows.find((row) => row.state === "mixed"))}”只有一部分开着`;
}

// The card's rows as one control: a segmented pill with a segment for each
// row, or a list of them when a pill cannot hold them (cardView decides). The
// rows that are on are the filled ones, so a graph with none or several on
// shows as it is, with an amber edge, and the next click leaves one.
function buildPick(state) {
  const row = el("div", "ausboss-card-row ausboss-ws-pick hidden");
  const pill = el("div", "ausboss-card-seg ausboss-ws-choices");
  pill.setAttribute("role", "radiogroup");
  const list = el("select", "ausboss-card-select ausboss-ws-choice-list");
  list.addEventListener("change", () => {
    if (list.value) chooseRow(state, list.value);
  });
  row.append(pill, list);
  const choices = new Map();

  const syncPill = (rows, stand, note) => {
    const settled = stand.kind === "one";
    pill.classList.toggle("settled", settled);
    pill.classList.toggle("unsettled", !settled);
    const seen = new Set();
    let cursor = pill.firstElementChild;
    for (const data of rows) {
      const key = rowKey(data);
      let choice = choices.get(key);
      if (!choice) {
        choice = button("");
        choice.setAttribute("role", "radio");
        choice.addEventListener("click", () => chooseRow(state, key));
        choices.set(key, choice);
      }
      const label = rowLabel(data);
      const empty = data.state === "empty";
      choice.textContent = label;
      choice.classList.toggle("on", data.state === "on");
      choice.classList.toggle("mixed", data.state === "mixed");
      choice.classList.toggle("empty", empty);
      choice.disabled = empty;
      choice.setAttribute("aria-checked", String(data.state === "on"));
      choice.title = empty ? `"${label}”没有节点，没得选。`
        : !settled ? `${note}。点击：只用“${label}".`
          : data === stand.picked ? `"${label}”已被选中。点别的可以换。`
            : `点击：使用“${label}”，并关掉其它选项`;
      if (cursor === choice) cursor = cursor.nextElementSibling;
      else pill.insertBefore(choice, cursor);
      seen.add(key);
    }
    for (const [key, choice] of choices) {
      if (seen.has(key)) continue;
      choice.remove();
      choices.delete(key);
    }
  };

  const syncList = (rows, stand, note) => {
    const settled = stand.kind === "one";
    list.classList.toggle("unsettled", !settled);
    list.title = settled ? "选一个来用，其它的会被关掉。" : `${note}。选一个来用。`;
    const options = [];
    if (!settled) {
      // What the list reads while no single row is on; never one of the
      // picks, and short enough for the narrowest card.
      const short = { none: "选一个", partly: "部分开着：选一个", several: `${stand.count} 个开着：选一个` };
      const waiting = el("option", "", short[stand.kind]);
      waiting.value = "";
      waiting.disabled = true;
      waiting.hidden = true;
      options.push(waiting);
    }
    for (const data of rows) {
      const mark = settled ? "" : data.state === "on" ? " (on)" : data.state === "mixed" ? " (部分开着)" : "";
      const option = el("option", "", `${rowLabel(data)}${mark}`);
      option.value = rowKey(data);
      option.disabled = data.state === "empty";
      options.push(option);
    }
    list.replaceChildren(...options);
    list.value = settled ? rowKey(stand.picked) : "";
  };

  const sync = (view, rows) => {
    row.classList.toggle("hidden", view === "rows");
    pill.hidden = view !== "pill";
    list.hidden = view !== "list";
    const stand = choiceState(rows);
    const note = standText(stand, rows);
    syncPill(view === "pill" ? rows : [], stand, note);
    if (view === "list") syncList(rows, stand, note);
    else list.replaceChildren();
  };
  return { row, sync };
}

// ---------- the panel ----------

function declaredHeight(state) {
  return state.height + WRAPPER_INSET;
}

// With the rows shown as one control (`picking`), that control is one row,
// and the rows under it show in the edit view only.
function measureCard(listed, edit, open, settings, picking) {
  const rows = [];
  if (!listed) rows.push({ widget: "hint", height: HINT_HEIGHT });
  if (picking) rows.push({ widget: "pick" });
  if (!picking || edit) for (let index = 0; index < listed; index += 1) rows.push({ widget: "switch" });
  if (edit) {
    rows.push({ widget: "bar" });
    if (!hasChoices(settings)) {
      rows.push({ group: "settings" });
      if (open) for (let index = 0; index < settingsRowCount(settings); index += 1) rows.push({ widget: "setting" });
    }
  }
  return cardHeight(rows);
}

function hintText(edit, groupCount, settings) {
  if (!edit) return "还没有开关。点这里做一个。";
  if (groupCount && settings.groups !== "none") return "没有组符合「组」设置。选中节点再按 + 开关。";
  return "选中一个部分的节点，比如一个框和它的 Save，再按 + 开关。";
}

function render(state, settings, rows, groupCount, pick) {
  const node = state.node;
  const edit = editOpen(node);
  const open = settingsOpen(node);
  const { view, width: pillWidth } = viewOf(settings, rows);
  const picking = view !== "rows";
  state.root.classList.toggle("edit", edit);
  state.root.classList.toggle("pick", picking);
  state.pick.sync(view, rows);
  state.pillWidth = pillWidth;

  const seen = new Set();
  let cursor = state.list.firstElementChild;
  for (const data of rows) {
    const key = rowKey(data);
    let entry = state.rows.get(key);
    if (!entry) {
      entry = buildRow(state, key, data.kind === "switch");
      state.rows.set(key, entry);
    }
    entry.sync(data, settings);
    // Only a row out of place is moved: moving the row being renamed would
    // take the cursor out of its name box.
    if (cursor === entry.row) cursor = cursor.nextElementSibling;
    else state.list.insertBefore(entry.row, cursor);
    seen.add(key);
  }
  for (const [key, entry] of state.rows) {
    if (seen.has(key)) continue;
    if (state.renaming === key) state.renaming = null;
    entry.row.remove();
    state.rows.delete(key);
  }

  state.hint.classList.toggle("hidden", rows.length > 0);
  state.hint.textContent = hintText(edit, groupCount, settings);
  state.hint.classList.toggle("link", !edit);
  state.bar.classList.toggle("hidden", !edit);
  state.done.title = picking
    ? "只显示胶囊。右键节点选「编辑开关」可以再编辑。"
    : "只显示标签和它们的开关。双击标签，或右键节点，可以再编辑。";
  // A card holds choices or switches: + Choice is offered until a switch is
  // made, and + Switch until a choice is.
  const choosing = hasChoices(settings);
  const both = !settings.switches.length && pick.nodes.length > 0;
  state.bar.classList.toggle("both", both);
  state.add.classList.toggle("hidden", choosing);
  state.choose.classList.toggle("hidden", !choosing && !both);
  state.choose.classList.toggle("ready", choosing || both);
  state.add.classList.toggle("ready", pick.count > 0);
  state.add.textContent = both ? "+ Switch" : pick.count > 0 ? `+ 从选中的 ${pick.count} selected` : "选中节点，再添加开关";
  state.settings.sync(settings, edit, open);

  const height = measureCard(rows.length, edit, open, settings, picking);
  const floor = minWidth(node);
  // Nodes 2.0 holds the floor on the node's element: told here, as the floor
  // follows the names in the pill and the node may not change size with it.
  holdVueNodeMinWidth(state.root, floor);
  if (height !== state.height || (node.size?.[0] ?? 0) < floor) {
    state.height = height;
    const width = Math.max(floor, node.size?.[0] || NODE_WIDTH);
    node.setSize?.([width, node.computeSize?.()[1] || declaredHeight(state)]);
    node.graph?.setDirtyCanvas?.(true, true);
  }
}

function refresh(state) {
  if (state.disposed) return;
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.checkedAt = performance.now();
  const { settings, groups, rows } = read(state);
  const node = state.node;
  const edit = editOpen(node);
  // The selection only shows in the edit view (the + Switch bar).
  const pick = edit ? picked(state) : { nodes: [], groups: [], count: 0 };
  const signature = [
    rowsSignature(rows, settings, rowKey), groups.length, edit, settingsOpen(node), pick.count, pick.nodes.length,
  ].join("|");
  if (signature === state.signature) return;
  state.signature = signature;
  render(state, settings, rows, groups.length, pick);
}

// Called on every canvas redraw: read the graph again at most every
// RECHECK_MS, and always once after the last redraw.
function scheduleCheck(state) {
  if (state.disposed || !state.node.graph || state.timer !== null) return;
  const shown = app.canvas?.getCurrentGraph?.() ?? app.canvas?.graph;
  if (state.node.graph && shown && state.node.graph !== shown) return;
  const wait = Math.max(0, state.checkedAt + RECHECK_MS - performance.now());
  state.timer = setTimeout(() => {
    state.timer = null;
    refresh(state);
  }, wait);
}

function ensureRedrawHook() {
  const canvas = app.canvas;
  if (!canvas || canvas === hookedCanvas) return;
  hookedCanvas = canvas;
  chainCallback(canvas, "onDrawForeground", () => {
    for (const state of live) scheduleCheck(state);
  });
}

// Wraps the node's own computeSize (not the prototype's), like the floors in
// js/shared/panel_layout.mjs.
function trimNodeBottom(node) {
  const inherited = node.computeSize;
  if (typeof inherited !== "function") return;
  node.computeSize = function (out) {
    const size = inherited.call(this, out);
    if (size && size[1] > BOTTOM_TRIM * 4) size[1] -= BOTTOM_TRIM;
    return size;
  };
}

function buildPanel(node) {
  if (node.__ausbossWorkflowSwitches) return node.__ausbossWorkflowSwitches;
  ensureCss();
  const root = el("div", "ausboss-ws");
  const card = el("div", "ausboss-card");
  const list = el("div", "ausboss-ws-list");
  const hint = button("ausboss-ws-hint hidden");
  const bar = el("div", "ausboss-card-row ausboss-ws-bar hidden");
  const add = button("ausboss-ws-add", "+ Switch", "在画布上选中一个部分的节点，再按这个：它们会得到一个开关");
  const choose = button("ausboss-ws-add hidden", "+ Choice", "把节点调成这个选项该有的样子，再按这个并给它起个名字。每个选项都做一遍：卡片会变成一颗胶囊，点哪个就按哪种方式设置节点。");
  const done = button("ausboss-ws-done", "Done");
  bar.append(add, choose, done);
  root.append(card);

  const state = {
    node, root, list, hint, bar, add, choose, done, rows: new Map(), settings: null, pick: null, pillWidth: 0, renaming: null,
    height: 0, signature: "", checkedAt: 0, timer: null, disposed: false,
  };
  node.__ausbossWorkflowSwitches = state;
  state.pick = buildPick(state);
  card.append(state.pick.row, list, hint, bar);
  state.settings = buildSettings(state);
  card.append(state.settings.header, ...state.settings.rows);

  add.addEventListener("click", () => newSwitch(state));
  choose.addEventListener("click", () => newChoice(state));
  done.addEventListener("click", () => setEdit(state, false));
  hint.addEventListener("click", () => setEdit(state, true));

  // Clicks on controls stay out of the graph's drag and leave the selection
  // alone; empty card space falls through, so the node still drags from its
  // body.
  root.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button,input,select")) event.stopPropagation();
  });
  root.addEventListener("dblclick", (event) => event.stopPropagation());

  const widget = node.addDOMWidget(WIDGET_NAME, "ausboss_workflow_switches", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => declaredHeight(state),
  });
  keepDomWidgetWidthAuto(widget);
  // Not saved with the workflow either: options.serialize only keeps it out
  // of the prompt, and saved values come back by position.
  widget.serialize = false;
  // A list sized to its rows, pinned on purpose (tests/panel_guards.test.mjs,
  // fixedByDesign): the rows are the content, there is no viewport to grow.
  widget.computeSize = (width) => [Math.max(minWidth(node), Number(width || node.size?.[0] || NODE_WIDTH)), declaredHeight(state)];
  // Pinned in Nodes 2.0 as well, where a node can be made taller than its list.
  pinVuePanelHeight(widget);
  widget.options.minNodeSize = [SMALL_MIN_WIDTH, 60];
  // The frontend skips a pinned card's width, so its floor is held here.
  holdNodeMinWidth(widget, () => minWidth(node));
  trimNodeBottom(node);
  state.widget = widget;

  ensureRedrawHook();
  return state;
}

// A removed node stops reading the graph; the state stays on the node so
// a node added back (undoing a delete in place) picks up where it was.
function dispose(node) {
  const state = node.__ausbossWorkflowSwitches;
  if (!state) return;
  state.disposed = true;
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = null;
  if (openMenu && state.root.contains(openMenu.anchor)) closeMenu();
  live.delete(state);
}

app.registerExtension({
  name: "AusBoss.WorkflowSwitches",
  setup() {
    ensureRedrawHook();
    // A card copied with its parts follows the copies. Without this a whole
    // workflow pasted into a new tab reads "empty" on every row.
    onPaste(({ nodes, groups, created }) => {
      for (const node of created) {
        if (!isSwitches(node)) continue;
        const moved = repointSwitches(node.properties?.[SETTINGS_PROPERTY], nodes, groups);
        if (!moved) continue;
        node.properties[SETTINGS_PROPERTY] = moved;
        const state = node.__ausbossWorkflowSwitches;
        if (state) refresh(state);
      }
    });
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_CLASS) return;
    // Never part of a prompt: the frontend leaves virtual nodes out.
    nodeType.prototype.isVirtualNode = true;

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      this.isVirtualNode = true;
      // No slots: without a start the frontend reserves an empty slot row
      // above the card and leaves it as dead space under it.
      this.widgets_start_y = WIDGETS_TOP;
      this.properties ??= {};
      this.properties[SETTINGS_PROPERTY] ??= { ...DEFAULT_SETTINGS, switches: [] };
      // A new node opens in the edit view; a loaded one keeps what was saved.
      this.properties[SHOW_EDIT] ??= true;
      buildPanel(this);
      this.setSize?.([Math.max(this.size?.[0] || 0, NODE_WIDTH), this.size?.[1] || 0]);
    });
    chainCallback(nodeType.prototype, "onAdded", function () {
      const state = buildPanel(this);
      state.disposed = false;
      state.signature = "";
      live.add(state);
      queueMicrotask(() => refresh(state));
    });
    // A workflow's groups are configured after its nodes: read once the
    // whole graph is in.
    chainCallback(nodeType.prototype, "onConfigure", function () {
      const state = buildPanel(this);
      state.signature = "";
      queueMicrotask(() => refresh(state));
    });
    chainCallback(nodeType.prototype, "getExtraMenuOptions", function (_canvas, options) {
      const state = this.__ausbossWorkflowSwitches;
      if (!state || !Array.isArray(options)) return;
      const { settings, rows } = read(state);
      const edit = editOpen(this);
      const items = [{
        content: edit ? "只显示开关" : "编辑开关",
        callback: () => setEdit(state, !edit),
      }];
      if (!settings.exclusive) items.push({ content: "全部打开", callback: () => switchAll(state, true) });
      // A card shown as one pill always has one picked: no "everything off".
      if (viewOf(settings, rows).view === "rows") items.push({ content: "全部关闭", callback: () => switchAll(state, false) });
      items.push(null);
      options.unshift(...items);
    });
    // The card is a list sized to its rows: width may grow, but a corner
    // drag that pulls the node taller only opens dead space under it, so the
    // height snaps back on the next frame (LiteGraph writes size directly
    // during a drag).
    chainCallback(nodeType.prototype, "onDrawForeground", function () {
      if (this.flags?.collapsed || !this.__ausbossWorkflowSwitches) return;
      const natural = this.computeSize?.()[1];
      if (natural && this.size[1] !== natural) {
        this.setSize?.([this.size[0], natural]);
        this.setDirtyCanvas?.(true, false);
      }
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      dispose(this);
    });
  },
});
