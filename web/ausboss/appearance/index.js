import { app } from "../../../../scripts/app.js";
import {
  CUSTOM_SCHEME,
  DEFAULT_SCHEME,
  NODE_COLOR_SCHEMES,
  SCHEME_NAMES,
  collectGraphNodes,
  normalizeHexColor,
  schemeColors,
  shouldRecolor,
  titleInk,
  wearsLegacyScheme,
} from "../shared/appearance.mjs";
import { chainCallback, chainHandler, isAusbossNode } from "../shared/index.mjs";
import {
  BADGE_RADIUS,
  badgeCenter,
  helpSections,
  hitsBadge,
  showBadge,
} from "../shared/help_badge.mjs";
import { openInfoCard } from "../shared/settings_menu.mjs";

const SETTING_ID = "AusBoss.Appearance.NodeColor";
const CUSTOM_SETTING_ID = "AusBoss.Appearance.CustomColor";
const COLOR_OVERRIDE = "ausbossColor";

// Stored bare (no "#") to match the color setting's storage contract.
const DEFAULT_CUSTOM_COLOR = "00b4aa";

// Every scheme title color (already lowercase in the table) — a node wearing
// one of these was colored by us, whether by the setting or the node menu.
const SCHEME_TITLES = new Set(
  NODE_COLOR_SCHEMES.flatMap((scheme) => (scheme.colors ? [scheme.colors.title] : [])),
);

let activeScheme = DEFAULT_SCHEME;
let activeCustomColor = DEFAULT_CUSTOM_COLOR;
// Normalized "#rrggbb" of the custom title (null when unusable), kept in
// step with activeCustomColor so the per-frame title-ink check stays cheap.
let activeCustomTitle = normalizeHexColor(DEFAULT_CUSTOM_COLOR);

function setActiveCustomColor(value) {
  if (!normalizeHexColor(value)) return;
  activeCustomColor = value;
  activeCustomTitle = normalizeHexColor(value);
}

function applyScheme(node, colors) {
  // Assigning undefined (never `delete`) keeps the property reactive under
  // the Vue-based Nodes 2.0 renderer while still restoring theme defaults.
  node.color = colors ? colors.title : undefined;
  node.bgcolor = colors ? colors.body : undefined;
}

// Repaint every AusBoss node still following the setting from one color
// pair to another; pairs (not names) so a CustomColor edit can sweep too.
function repaintAll(next, previous) {
  for (const node of collectGraphNodes(app.graph)) {
    if (!isAusbossNode(node)) continue;
    if (Object.hasOwn(node.properties ?? {}, COLOR_OVERRIDE)) continue;
    if (!shouldRecolor(node, previous)) continue;
    applyScheme(node, next);
  }
  app.graph?.setDirtyCanvas?.(true, true);
}

// Scheme titles are dark pigments, so the frontend's default title ink can
// land unreadably close. Wrapping drawTitleText is the sanctioned exception
// to the chainCallback rule: a draw method must return through the original,
// so we save it once, delegate always, and only swap the default color in.
// Nodes 2.0 renders titles in the DOM, not through drawTitleText — out of scope.
function installTitleInk() {
  const proto = window.LiteGraph?.LGraphNode?.prototype;
  if (typeof proto?.drawTitleText !== "function") {
    console.warn("[AusBoss] 未找到 LGraphNode.drawTitleText；自适应标题配色已停用");
    return;
  }
  if (proto.drawTitleText.ausbossTitleInk) return; // already wrapped
  const original = proto.drawTitleText;
  function drawTitleTextWithInk(ctx, options, ...rest) {
    const color = typeof this?.color === "string" ? this.color.trim().toLowerCase() : "";
    if (
      options &&
      isAusbossNode(this) &&
      (SCHEME_TITLES.has(color) || (activeCustomTitle !== null && color === activeCustomTitle))
    ) {
      options = { ...options, default_title_color: titleInk(color) };
    }
    return original.call(this, ctx, options, ...rest);
  }
  drawTitleTextWithInk.ausbossTitleInk = true;
  proto.drawTitleText = drawTitleTextWithInk;
}

app.registerExtension({
  name: "AusBoss.Appearance",
  settings: [
    {
      id: SETTING_ID,
      name: "AusBoss 节点配色",
      type: "combo",
      defaultValue: DEFAULT_SCHEME,
      options: SCHEME_NAMES,
      tooltip:
        "配色方案，作用于每个 AusBoss 节点的标题栏和主体。" +
        "改动后会立刻给当前打开的工作流重新上色；你手动" +
        "改过颜色的节点仍保持自己的颜色。Custom 使用在" +
        "自定义颜色设置里选的颜色。",
      category: ["🆎 AusBoss", "Appearance", "节点配色"],
      onChange(value) {
        const previous = activeScheme;
        activeScheme = value ?? DEFAULT_SCHEME;
        if (previous === activeScheme) return;
        const colors = schemeColors(activeScheme, activeCustomColor);
        // Custom with an unusable stored color resolves to null, which reads
        // downstream as "Theme default" and would strip the color off every
        // AusBoss node in the graph. The per-node menu already refuses this;
        // the setting has to refuse it too.
        if (activeScheme === CUSTOM_SCHEME && !colors) return;
        repaintAll(colors, schemeColors(previous, activeCustomColor));
      },
    },
    {
      id: CUSTOM_SETTING_ID,
      name: "AusBoss 自定义颜色",
      type: "color",
      defaultValue: DEFAULT_CUSTOM_COLOR,
      tooltip:
        "当 AusBoss 节点配色设为 Custom 时使用的标题栏颜色；" +
        "主体颜色会自动得出：把所选颜色朝" +
        "深色画布调和。在 Custom 生效时改动它，会立刻给" +
        "当前打开的工作流重新上色。",
      category: ["🆎 AusBoss", "Appearance", "自定义颜色"],
      onChange(value) {
        const previous = activeCustomColor;
        setActiveCustomColor(value);
        if (activeScheme !== CUSTOM_SCHEME) return;
        const next = schemeColors(CUSTOM_SCHEME, activeCustomColor);
        const before = schemeColors(CUSTOM_SCHEME, previous);
        if (next && next.title !== before?.title) repaintAll(next, before);
      },
    },
  ],
  async setup() {
    // onChange only fires on later edits, so seed from the stored values here.
    const stored = app.ui?.settings?.getSettingValue?.(SETTING_ID);
    if (SCHEME_NAMES.includes(stored)) activeScheme = stored;
    const storedCustom = app.ui?.settings?.getSettingValue?.(CUSTOM_SETTING_ID);
    if (normalizeHexColor(storedCustom)) setActiveCustomColor(storedCustom);
    installTitleInk();
  },
  getNodeMenuItems(node) {
    if (!isAusbossNode(node)) return [];
    // Vue nodes skip the canvas badge callbacks; title-less nodes have no bar.
    const about = isTitleless(node) || globalThis.LiteGraph?.vueNodesMode === true
      ? [{ content: "关于这个节点", callback: () => openHelpCard(node, null) }]
      : [];
    return [
      ...about,
      {
        content: "AusBoss 配色",
        has_submenu: true,
        submenu: {
          options: SCHEME_NAMES.map((name) => ({
            content: name,
            callback: () => {
              // Keep an explicit choice, including no colors, through saves
              // and setting changes. Custom stores the pair picked today.
              const colors = schemeColors(name, activeCustomColor);
              // Custom with an unusable stored color resolves to null, which
              // would wrongly read as "Theme default" — do nothing instead.
              if (name === CUSTOM_SCHEME && !colors) return;
              node.properties ??= {};
              node.properties[COLOR_OVERRIDE] = colors ? { ...colors } : null;
              applyScheme(node, colors);
              app.graph?.setDirtyCanvas?.(true, true);
            },
          })),
        },
      },
    ];
  },
  nodeCreated(node) {
    if (!isAusbossNode(node)) return;
    installHelpBadge(node);
    restoreAppearance(node);
    // Construction precedes saved fields; reload, paste and undo restore
    // their colors and properties before this callback runs.
    chainCallback(node, "onConfigure", function (saved) {
      restoreAppearance(this, saved);
    });
  },
});

function restoreAppearance(node, saved) {
  if (Object.hasOwn(node.properties ?? {}, COLOR_OVERRIDE)) {
    // A later pick in ComfyUI's own color menu is saved in the native fields.
    if (saved?.color || saved?.bgcolor) return;
    applyScheme(node, node.properties[COLOR_OVERRIDE]);
    return;
  }
  if ((node.color || node.bgcolor) && !wearsLegacyScheme(node)) return;
  applyScheme(node, schemeColors(activeScheme, activeCustomColor));
}

function isTitleless(node) {
  return (node.title_mode ?? node.constructor?.title_mode) === (globalThis.LiteGraph?.NO_TITLE ?? 1);
}

function openHelpCard(node, event) {
  const nodeData = node.constructor?.nodeData;
  const clientX = event?.clientX ?? window.innerWidth / 2;
  const clientY = event?.clientY ?? 80;
  openInfoCard({
    anchor: { left: clientX - 150, top: clientY, bottom: clientY + 6 },
    title: node.title || nodeData?.display_name || "关于这个节点",
    sections: helpSections(nodeData),
  });
}

// Classic nodes get a quiet "?" in the title bar. Vue nodes open the same
// card from their context menu. Its text comes from DESCRIPTION and tooltips.
function installHelpBadge(node) {
  // A title-less node (Run Timer) has no bar to hang the badge on; its
  // card opens from the node's context menu instead.
  chainCallback(node, "onDrawForeground", function (ctx) {
    if (isTitleless(this) || !showBadge(this.size?.[0] ?? 0, this.flags?.collapsed)) return;
    const [x, y] = badgeCenter(this.size[0]);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, BADGE_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(155,162,170,0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(155,162,170,0.8)";
    ctx.font = "bold 9px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", x, y + 0.5);
    ctx.restore();
  });
  chainHandler(node, "onMouseDown", function (event, pos) {
    if (isTitleless(this) || !showBadge(this.size?.[0] ?? 0, this.flags?.collapsed)) return false;
    if (!pos || !hitsBadge(pos, this.size[0])) return false;
    openHelpCard(this, event);
    return true; // consume the click so it does not start a drag
  });
}
