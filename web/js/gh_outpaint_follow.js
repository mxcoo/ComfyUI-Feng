// 孤海外补画板（可视化）× Feng 批量图片加载：自动跟随第一张图与遮罩。
//
// 解决的问题：
//   goohaitools 的「外补画板（可视化）」只在「图像」上游是 LoadImage 家族时才会自动出预览；
//   上游换成「Feng · 批量图片加载」后，画板只能点「加载」，而点了「加载」会真的把上游
//   执行一遍（批量解码几十张图），非常慢，而且拉不到遮罩。
//
// 本扩展的行为（全部只在前端完成，不新增节点、不改第三方源码）：
//   1. 画板「图像」上游是 FengBatchImageLoader 时，直接读它的隐藏控件 images，
//      取「第一个勾选的条目」的 /view 地址塞进画板预览 —— 不执行上游，秒开。
//   2. 画板「遮罩」输入为空、且上游有 MASK 输出时，自动连上「遮罩」口
//      （批量加载器的遮罩固定取第一张，和后端 execute 的取值口径一致）。
//   3. 批量加载器面板里换图、勾选、排序、画遮罩，画板预览自动跟着刷新。
//   4. 拦掉「加载」按钮的原逻辑，改走上面的快速路径，避免误触发一次上游执行。
//   5. 画板工具栏多一个「首图跟随」开关，可随时关掉（状态存在节点 properties 里）。
//
// 文件位置 web/js/gh_outpaint_follow.js，浏览器 URL 是
// /extensions/<插件目录名>/js/gh_outpaint_follow.js，所以相对路径退三级。

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const OUTPAINT_NODE = "孤海外补画板可视化";
const BATCH_NODE = "FengBatchImageLoader";
const STATE_KEY = "gh_outpaint_visual";
const LIST_WIDGET = "images";
const FOLLOW_PROPERTY = "gh_outpaint_follow_first";
const MASK_PROPERTY = "gh_outpaint_follow_mask";
const POLL_MS = 1200;

// 画板节点 → 运行上下文
const MANAGED = new WeakMap();

function withBase(path) {
  return typeof api.apiURL === "function" ? api.apiURL(path) : path;
}

function isBatchLoader(node) {
  if (!node) return false;
  return node.type === BATCH_NODE || node.comfyClass === BATCH_NODE;
}

function readEntries(loader) {
  const widget = (loader.widgets || []).find((item) => item.name === LIST_WIDGET);
  if (!widget) return [];
  let data;
  try {
    data = JSON.parse(widget.value || "[]");
  } catch (error) {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const entries = [];
  data.forEach((item, index) => {
    if (!item || typeof item.name !== "string" || !item.name) return;
    entries.push({
      name: item.name,
      subfolder: typeof item.subfolder === "string" ? item.subfolder.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") : "",
      type: item.type === "output" ? "output" : "input",
      selected: item.selected !== false,
      // 与 batch_loader.js / 后端 parse_entries 保持一致：遮罩只属于列表第一张
      mask: index === 0 && typeof item.mask === "string" ? item.mask : "",
    });
  });
  return entries;
}

function firstEntry(loader) {
  return readEntries(loader).find((entry) => entry.selected) || null;
}

function entryUrl(entry, bust) {
  const params = new URLSearchParams({
    filename: entry.name,
    subfolder: entry.subfolder || "",
    type: entry.type === "output" ? "output" : "input",
  });
  if (bust) params.set("rand", String(bust));
  return withBase(`/view?${params.toString()}`);
}

function maskUrl(entry) {
  if (!entry?.mask) return null;
  return withBase(`/view?${new URLSearchParams({ filename: entry.mask, subfolder: "", type: "input" }).toString()}`);
}

function linkedNode(node, names) {
  const inputs = node.inputs || [];
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    if (!input || !names.includes(input.name)) continue;
    const link = input.link;
    if (link == null) continue;
    const linkInfo = app.graph?.getLink?.(link) ?? app.graph?.links?.[link];
    const originId = linkInfo?.origin_id ?? linkInfo?.originId;
    if (originId == null) continue;
    const origin = app.graph?.getNodeById?.(originId);
    if (origin) return origin;
  }
  return null;
}

function outputSlotIndex(loader, pattern) {
  const outputs = loader.outputs || [];
  for (let index = 0; index < outputs.length; index += 1) {
    const output = outputs[index] || {};
    const label = String(output.label ?? output.display_name ?? output.name ?? "");
    if (pattern.test(label)) return index;
  }
  return -1;
}

function setButtonStyle(button, active) {
  button.style.cssText = [
    "cursor:pointer",
    "font:inherit",
    "line-height:normal",
    "box-sizing:border-box",
    "padding:3px 8px",
    "border-radius:3px",
    `border:1px solid ${active ? "#4f9bff" : "#59616d"}`,
    `background:${active ? "#2c4a70" : "#30343c"}`,
    `color:${active ? "#cfe4ff" : "#bbb"}`,
  ].join(";");
}

function updateToggle(context, entry) {
  if (!context.toggle) return;
  const mask = entry?.mask ? `，遮罩 ${entry.mask}` : "，未画遮罩";
  context.toggle.title = entry
    ? `首图跟随：${entry.name}${mask}（不执行上游；点一下关掉）`
    : "首图跟随（未找到可用图片）";
}

function attachToggle(context) {
  const loadButton = context.state.load;
  const bar = loadButton?.parentNode;
  if (!bar) return;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "首图跟随";
  button.title = "自动读取批量图片加载器的第一张图与遮罩（不执行上游）";
  setButtonStyle(button, context.enabled);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    context.enabled = !context.enabled;
    if (typeof context.node.setProperty === "function") {
      context.node.setProperty(FOLLOW_PROPERTY, context.enabled);
    } else {
      context.node.properties = { ...(context.node.properties || {}), [FOLLOW_PROPERTY]: context.enabled };
    }
    setButtonStyle(button, context.enabled);
    if (context.enabled) {
      sync(context, true);
    } else {
      context.key = "";
      context.state.upstreamPreviewUrl = null;
      context.state.refresh?.();
    }
  });
  bar.insertBefore(button, loadButton);
  context.toggle = button;
}

function ensureMaskLink(context) {
  if (context.node.properties?.[MASK_PROPERTY] === false) return;
  const inputs = context.node.inputs || [];
  const slot = inputs.findIndex((input) => input && /遮罩|mask/i.test(String(input.name || "")));
  if (slot < 0) return;
  if (inputs[slot].link != null) {
    context.maskLinkedOnce = true;
    return;
  }
  if (context.maskLinkedOnce) {
    // 已经连过一次又被拆掉 = 用户不想要，别跟他抢
    context.node.properties = { ...(context.node.properties || {}), [MASK_PROPERTY]: false };
    return;
  }
  const output = outputSlotIndex(context.loader, /遮罩|mask/i);
  if (output < 0) return;
  try {
    context.node.connect(slot, context.loader, output);
    context.maskLinkedOnce = true;
  } catch (error) {
    console.warn("[Feng] 外补画板遮罩自动接线失败", error);
  }
}

function applyPreview(context, entry) {
  if (!entry) return;
  // 始终带 rand：同名图片被重新上传/覆盖后，浏览器缓存会拿旧图
  const url = entryUrl(entry, (context.bust += 1));
  context.state.upstreamPreviewUrl = url;
  context.maskUrl = maskUrl(entry);
  updateToggle(context, entry);
  try {
    context.state.refresh?.();
  } catch (error) {
    console.warn("[Feng] 外补画板预览刷新失败", error);
  }
}

function sync(context, force = false) {
  if (context.disposed || !context.enabled) return;
  const loader = linkedNode(context.node, ["图像", "image"]);
  if (!isBatchLoader(loader)) {
    if (context.loader) {
      context.loader = null;
      context.key = "";
      context.state.upstreamPreviewUrl = null;
      context.state.refresh?.();
    }
    return;
  }
  const loaderChanged = context.loader !== loader;
  context.loader = loader;
  ensureMaskLink(context);

  const entry = firstEntry(loader);
  if (!entry) return;
  const key = `${entry.type}|${entry.subfolder}|${entry.name}|${entry.mask}`;
  const lost = !context.state.upstreamPreviewUrl;
  if (!force && !loaderChanged && !lost && key === context.key) return;
  context.key = key;
  applyPreview(context, entry);
}

function schedule(context) {
  if (context.disposed || context.pending) return;
  context.pending = true;
  requestAnimationFrame(() => {
    context.pending = false;
    if (!context.disposed) sync(context);
  });
}

function watchLoader(context) {
  if (!context.loader || context.watchedLoader === context.loader) return;
  context.watchedLoader = context.loader;
  const target = context.loader;
  const original = target.setDirtyCanvas;
  target.setDirtyCanvas = function wrapped(...args) {
    const result = original?.apply(this, args);
    // writeList() 只改 widget.value 再调 setDirtyCanvas，不触发 widget 回调
    schedule(context);
    return result;
  };
}

function install(context) {
  attachToggle(context);

  // 「加载」按钮：goohaitools 的监听是冒泡阶段，这里在捕获阶段拦下来走快速路径
  const intercept = (event) => {
    if (!context.enabled) return;
    const loader = context.loader;
    if (!loader) return;
    const entry = firstEntry(loader);
    if (!entry) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    context.key = `${entry.type}|${entry.subfolder}|${entry.name}|${entry.mask}`;
    applyPreview(context, entry);
  };
  context.state.load?.addEventListener("click", intercept, true);

  const previousConnections = context.node.onConnectionsChange;
  context.node.onConnectionsChange = function patchedConnections(...args) {
    const result = previousConnections?.apply(this, args);
    try {
      watchLoader(context);
      sync(context, true);
    } catch (error) {
      console.warn("[Feng] 外补画板连接变化同步失败", error);
    }
    return result;
  };

  const previousConfigure = context.node.onConfigure;
  context.node.onConfigure = function patchedConfigure(...args) {
    const result = previousConfigure?.apply(this, args);
    sync(context, true);
    watchLoader(context);
    return result;
  };

  const previousRemoved = context.node.onRemoved;
  context.node.onRemoved = function patchedRemoved(...args) {
    teardown(context);
    return previousRemoved?.apply(this, args);
  };

  context.poll = setInterval(() => {
    if (context.disposed) return;
    if (context.toggle && context.toggle.isConnected === false) {
      context.toggle = null;
      attachToggle(context);
    }
    sync(context);
    watchLoader(context);
  }, POLL_MS);

  sync(context, true);
  watchLoader(context);
}

function teardown(context) {
  if (context.disposed) return;
  context.disposed = true;
  if (context.poll) clearInterval(context.poll);
  context.poll = 0;
  context.toggle?.remove();
  MANAGED.delete(context.node);
}

function attach(node) {
  if (!node || MANAGED.has(node)) return true;
  const state = node[STATE_KEY];
  if (!state || !state.root) return false; // 画板 DOM 还没建好，等下一轮
  const context = {
    node,
    state,
    enabled: node.properties?.[FOLLOW_PROPERTY] !== false,
    loader: null,
    watchedLoader: null,
    key: "",
    bust: 0,
    maskUrl: null,
    maskLinkedOnce: false,
    poll: 0,
    pending: false,
    disposed: false,
    toggle: null,
  };
  MANAGED.set(node, context);
  try {
    install(context);
  } catch (error) {
    console.error("[Feng] 外补画板跟随初始化失败", error);
    teardown(context);
  }
  return true;
}

function attachWithRetry(node, attempts = 60) {
  let left = attempts;
  const tick = () => {
    if (!node || MANAGED.has(node)) return;
    if (attach(node)) return;
    left -= 1;
    if (left > 0) setTimeout(tick, 50);
  };
  tick();
}

// 新拖出来的节点
app.registerExtension({
  name: "Feng.GhOutpaintFollow",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== OUTPAINT_NODE) return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function patchedCreated(...args) {
      const result = onNodeCreated?.apply(this, args);
      attachWithRetry(this);
      return result;
    };
  },

  // 打开已有工作流时，节点可能是直接 configure 出来的
  async nodeCreated(node) {
    if (node?.comfyClass !== OUTPAINT_NODE && node?.type !== OUTPAINT_NODE) return;
    attachWithRetry(node);
  },

  async afterConfigureGraph() {
    for (const node of app.graph?._nodes || []) {
      if (node?.comfyClass === OUTPAINT_NODE || node?.type === OUTPAINT_NODE) attachWithRetry(node, 20);
    }
  },
});
