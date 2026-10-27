// 「多功能提示词预设」节点的前端面板。
//
// 数据来自后端 /feng_presets/index，缩略图来自 /feng_presets/thumb/<name>。
// 所有选择写进节点自己的隐藏控件 config（JSON），后端执行时按 id 查出提示词片段。
//
// 出厂预设只读；用户新增的预设存在后端 presets/user_presets.json，可在界面里直接增删改。
//
// 文件位于 web/js/，浏览器 URL 是 /extensions/Feng/js/prompt_preset.js，
// 所以相对路径要用三级 ../../../scripts/。

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_NAME = "FengPromptPreset";
const INDEX_URL = "/feng_presets/index";
const PREVIEW_ROUTE_URL = "/feng_presets/preview";
const THUMB_URL = "/feng_presets/thumb/";
const UPLOAD_URL = "/feng_presets/upload";
const CATEGORY_URL = "/feng_presets/category";
const CATEGORY_UPDATE_URL = "/feng_presets/category/update";
const ITEM_URL = "/feng_presets/item";
const STATE_WIDGET = "config";

// 俯视方位示意图：指针初始指向前方，按旋转角顺时针转。
const COMPASS_SVG = `<svg width="88" height="88" viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg">
<circle cx="44" cy="44" r="34" fill="#101010" stroke="#4a4a4a"/>
<circle cx="44" cy="44" r="2" fill="#666"/>
<text x="44" y="13" text-anchor="middle" font-size="9" fill="#8a8a8a">前</text>
<text x="44" y="83" text-anchor="middle" font-size="9" fill="#8a8a8a">后</text>
<text x="9" y="47" text-anchor="middle" font-size="9" fill="#8a8a8a">左</text>
<text x="79" y="47" text-anchor="middle" font-size="9" fill="#8a8a8a">右</text>
<g data-needle transform="rotate(0 44 44)">
<line x1="44" y1="44" x2="44" y2="17" stroke="#4f9bff" stroke-width="3" stroke-linecap="round"/>
<circle cx="44" cy="17" r="4" fill="#4f9bff"/>
</g>
</svg>`;

let indexPromise = null;

function loadIndex() {
  if (!indexPromise) {
    indexPromise = api
      .fetchApi(INDEX_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .catch((error) => {
        indexPromise = null;
        throw error;
      });
  }
  return indexPromise;
}

function reloadIndex() {
  indexPromise = null;
  return loadIndex();
}

async function apiJson(url, options) {
  const response = await api.fetchApi(url, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  if (!response.ok) {
    throw new Error((payload && payload.error) || "HTTP " + response.status);
  }
  return payload;
}

function findTab(index, tabId) {
  return (index.tabs || []).find((tab) => tab.id === tabId) || null;
}

function defaultFields(tab) {
  const values = {};
  for (const field of tab.fields || []) {
    values[field.id] = field.default;
  }
  return values;
}

function parseState(raw, index) {
  const state = { active: [], selected: {}, fields: {} };
  let data = null;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    data = null;
  }
  if (!data || typeof data !== "object") {
    data = {};
  }

  if (Array.isArray(data.active)) {
    for (const tabId of data.active) {
      if (typeof tabId === "string" && findTab(index, tabId) && !state.active.includes(tabId)) {
        state.active.push(tabId);
      }
    }
  }
  if (data.selected && typeof data.selected === "object") {
    for (const [tabId, ids] of Object.entries(data.selected)) {
      if (Array.isArray(ids)) {
        state.selected[tabId] = ids.filter((id) => typeof id === "string");
      }
    }
  }
  if (data.fields && typeof data.fields === "object") {
    for (const [tabId, values] of Object.entries(data.fields)) {
      if (values && typeof values === "object") {
        state.fields[tabId] = { ...values };
      }
    }
  }

  for (const tab of index.tabs || []) {
    if (tab.kind === "fields" && !state.fields[tab.id]) {
      state.fields[tab.id] = defaultFields(tab);
    }
  }

  // 兼容旧状态：有选中项却没有任何分组被启用时，自动把有选择的分类启用上，
  // 否则工作流加载后什么都不输出。
  if (!state.active.length) {
    for (const [tabId, ids] of Object.entries(state.selected)) {
      if (Array.isArray(ids) && ids.length && findTab(index, tabId)) {
        state.active.push(tabId);
      }
    }
  }
  return state;
}

function makeButton(label, initialStyle) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText =
    "cursor:pointer;border:1px solid #4a4a4a;border-radius:4px;padding:2px 8px;" +
    "background:#2b2b2b;color:#ddd;font-size:12px;line-height:18px;" +
    (initialStyle || "");
  return button;
}

function isActive(state, tabId) {
  return state.active.includes(tabId);
}

function toggleActive(state, tabId, additive) {
  if (!additive) {
    // 单击 = 只启用这一个分组（不再允许把自己关掉，否则会"点了没反应"）
    state.active = [tabId];
    return;
  }
  if (isActive(state, tabId)) {
    state.active = state.active.filter((id) => id !== tabId);
  } else {
    state.active = [...state.active, tabId];
  }
}

function selectedIds(state, tabId) {
  if (!state.selected[tabId]) {
    state.selected[tabId] = [];
  }
  return state.selected[tabId];
}

function readStateWidget(node) {
  return (node.widgets || []).find((widget) => widget.name === STATE_WIDGET);
}

// 预设编辑弹窗。item 为空表示新增。
function openPresetEditor(tabId, item, onSaved) {
  let thumb = item?.thumb || "";
  let detailsLoaded = !item;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.6);" +
    "display:flex;align-items:center;justify-content:center;";

  const panel = document.createElement("div");
  panel.style.cssText =
    "width:min(440px,90vw);max-height:86vh;overflow:auto;background:#202020;color:#ddd;" +
    "border:1px solid #4a4a4a;border-radius:8px;padding:14px;display:flex;" +
    "flex-direction:column;gap:8px;font-size:12px;box-shadow:0 8px 30px rgba(0,0,0,0.5);";

  const heading = document.createElement("div");
  heading.textContent = item ? "编辑预设" : "新增预设";
  heading.style.cssText = "font-size:14px;font-weight:600;";

  function labelled(text) {
    const label = document.createElement("label");
    label.textContent = text;
    label.style.cssText = "color:#a8a8a8;font-size:11px;";
    return label;
  }

  const fieldStyle =
    "width:100%;box-sizing:border-box;background:#161616;color:#ddd;border:1px solid #4a4a4a;" +
    "border-radius:4px;padding:4px 8px;font-size:12px;font-family:inherit;";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "例如：赛博朋克";
  nameInput.value = item?.label || "";
  nameInput.style.cssText = fieldStyle;

  const promptInput = document.createElement("textarea");
  promptInput.rows = 4;
  promptInput.placeholder = "提示词片段，可用 {prompt} 表示已有正文的位置";
  promptInput.style.cssText = fieldStyle + "resize:vertical;";

  const negativeInput = document.createElement("textarea");
  negativeInput.rows = 2;
  negativeInput.placeholder = "反向提示词片段（可留空）";
  negativeInput.style.cssText = fieldStyle + "resize:vertical;";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.cssText = "font-size:11px;color:#bbb;";

  const preview = document.createElement("img");
  preview.style.cssText = "max-height:72px;border-radius:4px;display:none;";
  if (thumb) {
    preview.src = THUMB_URL + encodeURIComponent(thumb);
    preview.style.display = "block";
  }
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      return;
    }
    preview.src = URL.createObjectURL(file);
    preview.style.display = "block";
  });

  const status = document.createElement("div");
  status.style.cssText = "color:#ff9b9b;font-size:11px;min-height:14px;";

  const buttons = document.createElement("div");
  buttons.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:4px;";

  const cancel = makeButton("取消");
  const save = makeButton("保存");
  save.style.background = "#3a6ea5";
  buttons.append(cancel, save);

  if (item) {
    const remove = makeButton("删除");
    remove.style.background = "#7a2f2f";
    remove.style.marginRight = "auto";
    buttons.append(remove);
    remove.addEventListener("click", async () => {
      if (!confirm(`删除预设「${item.label}」？`)) {
        return;
      }
      try {
        await apiJson(
          `${ITEM_URL}?tab_id=${encodeURIComponent(tabId)}&id=${encodeURIComponent(item.id)}`,
          { method: "DELETE" }
        );
        close();
        await onSaved();
      } catch (error) {
        status.textContent = "删除失败：" + error.message;
      }
    });
  }

  panel.append(
    heading,
    labelled("预设名称"),
    nameInput,
    labelled("提示词"),
    promptInput,
    labelled("反向提示词"),
    negativeInput,
    labelled("缩略图（可选）"),
    fileInput,
    preview,
    status,
    buttons
  );
  overlay.append(panel);
  document.body.append(overlay);

  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }

  function onKey(event) {
    if (event.key === "Escape") {
      close();
    }
  }

  document.addEventListener("keydown", onKey);
  cancel.addEventListener("click", close);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  save.addEventListener("click", async () => {
    const label = nameInput.value.trim();
    if (!label) {
      status.textContent = "预设名称不能为空";
      return;
    }
    if (!detailsLoaded) {
      status.textContent = "正在读取预设内容，请稍候";
      return;
    }
    const prompt = promptInput.value.trim();
    if (!prompt) {
      status.textContent = "提示词不能为空";
      return;
    }
    save.disabled = true;
    status.textContent = "";
    try {
      let thumbName = thumb;
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        const form = new FormData();
        form.append("image", file, file.name || "thumb.png");
        const uploaded = await apiJson(UPLOAD_URL, { method: "POST", body: form });
        thumbName = uploaded.thumb;
      }
      const payload = {
        tab_id: tabId,
        label,
        prompt,
        negative_prompt: negativeInput.value.trim(),
        thumb: thumbName,
      };
      if (item) {
        payload.id = item.id;
      }
      await apiJson(ITEM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      close();
      await onSaved();
    } catch (error) {
      status.textContent = "保存失败：" + error.message;
      save.disabled = false;
    }
  });

  if (item) {
    status.textContent = "正在读取预设内容...";
    fetchItem(tabId, item.id)
      .then((detail) => {
        promptInput.value = detail.prompt || "";
        negativeInput.value = detail.negative_prompt || "";
        detailsLoaded = true;
        status.textContent = "";
      })
      .catch((error) => {
        status.textContent = "读取预设内容失败：" + error.message;
      });
  }

  nameInput.focus();
  return { close };
}

async function fetchItem(tabId, itemId) {
  return apiJson(
    `${ITEM_URL}?tab_id=${encodeURIComponent(tabId)}&id=${encodeURIComponent(itemId)}`,
    { method: "GET" }
  );
}

// 危险操作确认：必须手动把 phrase 原样打进去，确认按钮才可用。
function openTypedConfirm({ title, message, phrase, confirmLabel, onConfirm }) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,0.65);" +
    "display:flex;align-items:center;justify-content:center;";

  const panel = document.createElement("div");
  panel.style.cssText =
    "width:min(420px,90vw);background:#202020;color:#ddd;border:1px solid #5a2a2a;" +
    "border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:9px;" +
    "font-size:12px;box-shadow:0 8px 30px rgba(0,0,0,0.5);";

  const heading = document.createElement("div");
  heading.textContent = title;
  heading.style.cssText = "font-size:14px;font-weight:600;color:#ff9b9b;";

  const body = document.createElement("div");
  body.textContent = message;
  body.style.cssText = "color:#cfcfcf;line-height:17px;";

  const hint = document.createElement("div");
  hint.style.cssText = "color:#a8a8a8;";
  const required = document.createElement("b");
  required.textContent = phrase;
  required.style.cssText = "color:#fff;font-weight:600;";
  hint.append(document.createTextNode("请输入 "), required, document.createTextNode(" 以确认："));

  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = phrase;
  input.style.cssText =
    "width:100%;box-sizing:border-box;background:#161616;color:#ddd;border:1px solid #4a4a4a;" +
    "border-radius:4px;padding:5px 8px;font-size:12px;";

  const buttons = document.createElement("div");
  buttons.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:2px;";

  const cancel = makeButton("取消");
  const confirm = makeButton(confirmLabel || "确认");
  confirm.style.background = "#7a2f2f";
  confirm.style.borderColor = "#8f3a3a";
  confirm.disabled = true;
  confirm.style.opacity = "0.5";

  buttons.append(cancel, confirm);
  panel.append(heading, body, hint, input, buttons);
  overlay.append(panel);
  document.body.append(overlay);

  let busy = false;

  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }

  function sync() {
    const matched = input.value.trim() === phrase;
    confirm.disabled = !matched || busy;
    confirm.style.opacity = matched && !busy ? "1" : "0.5";
  }

  function onKey(event) {
    if (event.key === "Escape") {
      close();
    } else if (event.key === "Enter" && !confirm.disabled) {
      submit();
    }
  }

  async function submit() {
    if (busy || confirm.disabled) {
      return;
    }
    busy = true;
    confirm.textContent = "处理中...";
    try {
      await onConfirm();
      close();
    } catch (error) {
      busy = false;
      confirm.textContent = confirmLabel || "确认";
      body.textContent = "操作失败：" + error.message;
      sync();
    }
  }

  input.addEventListener("input", sync);
  cancel.addEventListener("click", close);
  confirm.addEventListener("click", submit);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  document.addEventListener("keydown", onKey);
  input.focus();
}

function setupPanel(node, initialIndex) {
  let index = initialIndex;
  const state = parseState(readStateWidget(node)?.value, index);
  let currentTabId = (index.tabs[0] || {}).id || null;
  let searchText = "";
  let page = 1;
  let previewTimer = null;
  let previewElement = null;

  const root = document.createElement("div");
  root.style.cssText =
    "display:flex;flex-direction:column;gap:6px;padding:6px;box-sizing:border-box;" +
    "font-size:12px;color:#ddd;overflow:hidden;height:420px;";

  const tabBar = document.createElement("div");
  tabBar.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;";

  const searchRow = document.createElement("div");
  searchRow.style.cssText = "display:flex;gap:6px;align-items:center;";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "搜索风格...";
  searchInput.style.cssText =
    "flex:1;min-width:0;background:#1e1e1e;color:#ddd;border:1px solid #4a4a4a;" +
    "border-radius:4px;padding:3px 8px;font-size:12px;";

  const addItemButton = makeButton("＋ 新增预设");
  const clearButton = makeButton("清空已选");

  const hintRow = document.createElement("div");
  hintRow.style.cssText = "color:#8a8a8a;font-size:11px;line-height:16px;min-height:16px;";

  const content = document.createElement("div");
  content.style.cssText = "flex:1;min-height:0;overflow:auto;";

  const pagerRow = document.createElement("div");
  pagerRow.style.cssText = "display:flex;gap:6px;align-items:center;justify-content:center;";

  searchRow.append(searchInput, addItemButton, clearButton);
  root.append(tabBar, searchRow, hintRow, content, pagerRow);

  node.addDOMWidget("feng_preset_panel", "feng_preset_panel", root, {
    serialize: false,
    hideOnZoom: false,
  });

  function persist() {
    const widget = readStateWidget(node);
    if (widget) {
      widget.value = JSON.stringify(state);
    }
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
  }

  async function refresh() {
    index = await reloadIndex();
    if (!findTab(index, currentTabId)) {
      currentTabId = (index.tabs[0] || {}).id || null;
    }
    renderAll();
  }

  function cardItems(tab) {
    const items = tab.items || [];
    if (!tab.searchable || !searchText) {
      return items;
    }
    const needle = searchText.toLowerCase();
    return items.filter((item) =>
      `${item.label || ""} ${item.name || ""}`.toLowerCase().includes(needle)
    );
  }

  function renderTabs() {
    tabBar.textContent = "";
    for (const tab of index.tabs || []) {
      const button = makeButton(tab.label || tab.id);
      const active = isActive(state, tab.id);
      const current = tab.id === currentTabId;
      button.style.background = active ? "#3a6ea5" : "#2b2b2b";
      button.style.borderColor = current ? "#e0e0e0" : "#4a4a4a";
      button.style.fontWeight = current ? "600" : "400";
      button.title = tab.custom
        ? "点击切换；Shift 多选；双击改名"
        : "点击切换分组；按住 Shift 点击可与其他分组同时启用";
      button.addEventListener("click", (event) => {
        currentTabId = tab.id;
        toggleActive(state, tab.id, event.shiftKey);
        searchText = "";
        searchInput.value = "";
        page = 1;
        persist();
        renderAll();
      });
      if (tab.custom) {
        button.addEventListener("dblclick", async (event) => {
          event.stopPropagation();
          const label = prompt("分类名称", tab.label || "");
          if (!label || !label.trim()) {
            return;
          }
          try {
            await apiJson(CATEGORY_UPDATE_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: tab.id, label: label.trim() }),
            });
            await refresh();
          } catch (error) {
            console.error("[Feng] 分类改名失败", error);
          }
        });
      }
      tabBar.append(button);

      if (tab.custom) {
        const removeCategory = makeButton("✕");
        removeCategory.title = "删除该分类（需要输入分类名确认）";
        removeCategory.style.cssText += "padding:2px 6px;background:#3a2020;border-color:#5a2a2a;";
        removeCategory.addEventListener("click", (event) => {
          event.stopPropagation();
          const count = (tab.items || []).length;
          const message = count
            ? `分类「${tab.label}」下有 ${count} 条预设，删除后会一起消失，且无法恢复。`
            : `分类「${tab.label}」会被删除，且无法恢复。`;
          openTypedConfirm({
            title: "删除分类",
            message,
            phrase: tab.label || tab.id,
            confirmLabel: "删除",
            onConfirm: async () => {
              try {
                await apiJson(`${CATEGORY_URL}/${encodeURIComponent(tab.id)}`, { method: "DELETE" });
                if (currentTabId === tab.id) {
                  currentTabId = (index.tabs[0] || {}).id || null;
                }
                state.active = state.active.filter((id) => id !== tab.id);
                persist();
                await refresh();
              } catch (error) {
                console.error("[Feng] 删除分类失败", error);
                throw error;
              }
            },
          });
        });
        tabBar.append(removeCategory);
      }
    }

    const addCategory = makeButton("＋");
    addCategory.title = "新建分类";
    addCategory.style.padding = "2px 7px";
    addCategory.addEventListener("click", async () => {
      const label = prompt("新分类名称，例如：我的风格库", "");
      if (!label || !label.trim()) {
        return;
      }
      try {
        const category = await apiJson(CATEGORY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: label.trim() }),
        });
        await refresh();
        currentTabId = category.id;
        page = 1;
        renderAll();
      } catch (error) {
        console.error("[Feng] 新建分类失败", error);
      }
    });
    tabBar.append(addCategory);
  }

  function renderHint(tab) {
    if (!tab) {
      hintRow.textContent = "";
      return;
    }
    if (!isActive(state, tab.id)) {
      hintRow.textContent = `当前「${tab.label}」分组未启用，点击上方按钮可启用；按住 Shift 可与其他分组多选。`;
      return;
    }
    if (tab.kind === "fields") {
      hintRow.textContent = "参数修改后立即生效。";
      return;
    }
    const count = selectedIds(state, tab.id).length;
    hintRow.textContent = count
      ? `已选 ${count} 项，将在生成时合并进提示词。点击可单选，按住 Shift 点击可多选。`
      : "点击卡片选择（默认单选，Shift 多选）；卡片左上角 ✎/✕ 可编辑或删除自己加的预设。";
  }

  function renderCards(tab) {
    const items = cardItems(tab);
    const pageSize = Math.max(1, index.page_size || 12);
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    page = Math.min(page, totalPages);
    const start = (page - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);
    const chosen = selectedIds(state, tab.id);

    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;";

    for (const item of pageItems) {
      const card = document.createElement("div");
      const picked = chosen.includes(item.id);
      card.style.cssText =
        "position:relative;cursor:pointer;border-radius:4px;overflow:hidden;" +
        "display:flex;flex-direction:column;" +
        "border:2px solid " + (picked ? "#4f9bff" : "#3a3a3a") + ";background:#232323;";
      card.title = item.label || item.id;

      // 本地图优先（/feng_presets/thumb/），没有再退回远程 URL；
      // 两者都失败就把 img 移除，露出占位文字，不影响点选。
      const localSrc = item.thumb ? THUMB_URL + encodeURIComponent(item.thumb) : "";
      const remoteSrc = item.thumbUrl || "";
      const thumbSrc = localSrc || remoteSrc;

      const media = document.createElement("div");
      // 固定 1:1 方形预览区，图片用 cover 裁切填满，网格才不会参差
      media.style.cssText =
        "position:relative;width:100%;aspect-ratio:1/1;flex:none;overflow:hidden;background:#1c1c1c;" +
        "display:flex;align-items:center;justify-content:center;color:#6f6f6f;font-size:11px;";
      media.textContent = thumbSrc ? "" : "无图";
      if (thumbSrc) {
        const image = document.createElement("img");
        let triedRemote = false;
        image.loading = "lazy";
        image.referrerPolicy = "no-referrer";
        image.alt = item.label || item.id;
        image.style.cssText =
          "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;";
        image.addEventListener("error", () => {
          if (!triedRemote && remoteSrc && localSrc && image.src !== remoteSrc) {
            triedRemote = true;
            image.src = remoteSrc;
            return;
          }
          image.remove();
          media.textContent = "无图";
        });
        image.src = thumbSrc;
        media.append(image);
      }
      card.append(media);

      const caption = document.createElement("div");
      caption.textContent = item.label || item.id;
      caption.title = item.label || item.id;
      // 固定两行高度：只有一行的标题也占住第二行，整页卡片高度才一致
      caption.style.cssText =
        "padding:3px 4px;font-size:11px;line-height:14px;height:28px;box-sizing:content-box;" +
        "overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;" +
        "overflow-wrap:anywhere;word-break:break-word;" +
        "color:" + (picked ? "#cfe4ff" : "#cfcfcf") + ";";
      card.append(caption);

      if (picked) {
        const badge = document.createElement("div");
        badge.textContent = "✓";
        badge.style.cssText =
          "position:absolute;top:2px;right:4px;color:#4f9bff;font-weight:700;font-size:13px;";
        card.append(badge);
      }

      if (item.custom) {
        const tools = document.createElement("div");
        tools.style.cssText = "position:absolute;top:2px;left:2px;display:flex;gap:2px;";
        const edit = document.createElement("span");
        edit.textContent = "✎";
        edit.title = "编辑";
        const remove = document.createElement("span");
        remove.textContent = "✕";
        remove.title = "删除";
        for (const element of [edit, remove]) {
          element.style.cssText =
            "cursor:pointer;background:rgba(0,0,0,0.6);border-radius:3px;" +
            "padding:0 3px;color:#ddd;font-size:11px;line-height:14px;";
        }
        edit.addEventListener("click", (event) => {
          event.stopPropagation();
          openPresetEditor(tab.id, item, refresh);
        });
        remove.addEventListener("click", async (event) => {
          event.stopPropagation();
          if (!confirm(`删除预设「${item.label}」？`)) {
            return;
          }
          try {
            await apiJson(
              `${ITEM_URL}?tab_id=${encodeURIComponent(tab.id)}&id=${encodeURIComponent(item.id)}`,
              { method: "DELETE" }
            );
            await refresh();
          } catch (error) {
            console.error("[Feng] 删除预设失败", error);
          }
        });
        tools.append(edit, remove);
        card.append(tools);
      }

      card.addEventListener("click", (event) => {
        const list = selectedIds(state, tab.id);
        const at = list.indexOf(item.id);
        if (event.shiftKey) {
          // Shift = 多选
          if (at >= 0) {
            list.splice(at, 1);
          } else {
            list.push(item.id);
          }
        } else if (at >= 0 && list.length === 1) {
          // 再点一下已选中的唯一项 = 取消
          list.length = 0;
        } else {
          // 默认单选
          list.length = 0;
          list.push(item.id);
        }
        // 选中即自动启用该分组，避免"选了却不出提示词"
        if (list.length && !isActive(state, tab.id)) {
          state.active = [...state.active, tab.id];
        }
        persist();
        renderAll();
      });

      grid.append(card);
    }

    if (!pageItems.length) {
      const empty = document.createElement("div");
      empty.textContent = "这个分类还是空的，点「＋ 新增预设」加一条";
      empty.style.cssText = "color:#8a8a8a;padding:16px 0;text-align:center;grid-column:1/-1;";
      grid.append(empty);
    }

    content.textContent = "";
    content.append(grid);

    pagerRow.textContent = "";
    const prev = makeButton("上一页");
    const next = makeButton("下一页");
    const label = document.createElement("span");
    label.textContent = items.length ? `${page} / ${totalPages}` : "0 / 0";
    label.style.cssText = "color:#cfcfcf;min-width:56px;text-align:center;";
    prev.disabled = page <= 1;
    next.disabled = page >= totalPages;
    prev.addEventListener("click", () => {
      if (page > 1) {
        page -= 1;
        renderAll();
      }
    });
    next.addEventListener("click", () => {
      if (page < totalPages) {
        page += 1;
        renderAll();
      }
    });
    pagerRow.append(prev, label, next);
  }

  function renderFields(tab) {
    const values = state.fields[tab.id] || (state.fields[tab.id] = defaultFields(tab));
    const wrapper = document.createElement("div");
    wrapper.style.cssText = "display:flex;flex-direction:column;gap:6px;";

    for (const field of tab.fields || []) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;align-items:center;";

      const label = document.createElement("div");
      const labelText = field.label || field.id;
      label.textContent = labelText;
      label.title = labelText;
      label.style.cssText =
        "width:108px;flex:none;color:#cfcfcf;font-size:11px;line-height:14px;" +
        "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      row.append(label);

      if (field.type === "int" || field.type === "float") {
        const range = document.createElement("input");
        range.type = "range";
        range.min = String(field.min ?? 0);
        range.max = String(field.max ?? 10);
        range.step = String(field.step ?? (field.type === "int" ? 1 : 0.1));
        range.value = String(values[field.id] ?? field.default ?? 0);
        range.style.cssText = "flex:1;min-width:0;";
        const shown = document.createElement("span");
        shown.textContent = range.value;
        shown.style.cssText = "width:40px;flex:none;text-align:right;color:#cfcfcf;font-size:11px;";
        range.addEventListener("input", () => {
          const number = field.type === "int" ? parseInt(range.value, 10) : parseFloat(range.value);
          values[field.id] = Number.isFinite(number) ? number : field.default;
          shown.textContent = String(values[field.id]);
          persist();
          schedulePreview(tab);
        });
        row.append(range, shown);
      } else {
        const select = document.createElement("select");
        select.style.cssText =
          "flex:1;min-width:0;background:#1e1e1e;color:#ddd;border:1px solid #4a4a4a;" +
          "border-radius:4px;padding:2px 6px;font-size:12px;";
        for (const option of field.options || []) {
          const optionElement = document.createElement("option");
          optionElement.value = option;
          optionElement.textContent = option;
          select.append(optionElement);
        }
        const current = values[field.id] ?? field.default;
        if (current !== undefined && current !== null) {
          select.value = String(current);
          if (select.value !== String(current) && field.options?.length) {
            values[field.id] = field.options[0];
            select.value = field.options[0];
          }
        }
        select.addEventListener("change", () => {
          values[field.id] = select.value;
          persist();
          schedulePreview(tab);
        });
        row.append(select);
      }

      wrapper.append(row);
    }

    // 预览区：多角度页签额外给方位罗盘和中文方位摘要，其它字段页签只有提示词预览。
    const previewCard = document.createElement("div");
    previewCard.style.cssText =
      "margin-top:6px;border:1px solid #4a4a4a;border-radius:6px;padding:8px;background:#191919;" +
      "display:flex;flex-direction:column;gap:6px;";

    const previewTitle = document.createElement("div");
    previewTitle.textContent = tab.builder === "angle" ? "多角度预览" : "提示词预览";
    previewTitle.style.cssText = "font-size:12px;font-weight:600;color:#e6e6e6;";

    const sink = { promptText: null, summaryEls: null, compassNeedle: null };

    if (tab.builder === "angle") {
      const compass = document.createElement("div");
      compass.innerHTML = COMPASS_SVG;
      compass.style.cssText = "flex:none;width:88px;height:88px;";
      sink.compassNeedle = compass.querySelector("[data-needle]");

      const summary = document.createElement("div");
      summary.style.cssText = "flex:1;min-width:0;font-size:11px;line-height:17px;color:#cfcfcf;";
      sink.summaryEls = {
        horizontal: document.createElement("div"),
        vertical: document.createElement("div"),
        distance: document.createElement("div"),
        numbers: document.createElement("div"),
      };
      sink.summaryEls.horizontal.textContent = "水平：—";
      sink.summaryEls.vertical.textContent = "垂直：—";
      sink.summaryEls.distance.textContent = "景别：—";
      sink.summaryEls.numbers.style.cssText = "color:#9a9a9a;margin-top:3px;";
      summary.append(
        sink.summaryEls.horizontal,
        sink.summaryEls.vertical,
        sink.summaryEls.distance,
        sink.summaryEls.numbers
      );

      const body = document.createElement("div");
      body.style.cssText = "display:flex;gap:10px;align-items:center;";
      body.append(compass, summary);
      previewCard.append(previewTitle, body);
    } else {
      previewCard.append(previewTitle);
    }

    if (tab.builder === "angle") {
      const promptLabel = document.createElement("div");
      promptLabel.textContent = "角度提示词预览";
      promptLabel.style.cssText = "font-size:11px;color:#8a8a8a;";
      sink.promptText = document.createElement("div");
      sink.promptText.style.cssText =
        "color:#9fd0ff;font-size:11px;line-height:15px;white-space:pre-wrap;word-break:break-word;";
      previewCard.append(promptLabel, sink.promptText);
    } else {
      sink.promptText = document.createElement("div");
      sink.promptText.style.cssText =
        "color:#9fd0ff;font-size:11px;line-height:15px;white-space:pre-wrap;word-break:break-word;";
      previewCard.append(sink.promptText);
    }
    sink.promptText.textContent = "正在生成预览...";

    wrapper.append(previewCard);

    content.textContent = "";
    content.append(wrapper);
    pagerRow.textContent = "";

    previewElement = sink;
    requestPreview(tab, values, sink, 0);
  }

  function schedulePreview(tab) {
    if (!previewElement) {
      return;
    }
    requestPreview(tab, state.fields[tab.id] || {}, previewElement, 260);
  }

  function requestPreview(tab, values, sink, delay) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      try {
        const result = await apiJson(PREVIEW_ROUTE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tab_id: tab.id, values }),
        });
        const text = (result && result.text) || "";
        sink.promptText.textContent = text || "（当前参数不会产生提示词片段）";

        const angle = result && result.angle;
        if (angle && sink.summaryEls) {
          sink.summaryEls.horizontal.textContent = `水平：${angle.horizontal}`;
          sink.summaryEls.vertical.textContent = `垂直：${angle.vertical}`;
          sink.summaryEls.distance.textContent = `景别：${angle.distance}`;
          sink.summaryEls.numbers.textContent =
            `旋转 ${angle.rotate}° · 俯仰 ${angle.pitch}° · 缩放 ${angle.zoom}`;
          if (sink.compassNeedle) {
            sink.compassNeedle.setAttribute("transform", `rotate(${angle.rotate} 44 44)`);
          }
        }
      } catch (error) {
        sink.promptText.textContent = "预览不可用：" + error.message;
      }
    }, delay || 120);
  }

  function renderAll() {
    try {
      renderTabs();
      const tab = findTab(index, currentTabId);
      const showAdd = Boolean(tab) && tab.kind !== "fields";
      addItemButton.style.display = showAdd ? "" : "none";
      clearButton.style.display = tab ? "" : "none";
      renderHint(tab);
      if (!tab) {
        content.textContent = "";
        pagerRow.textContent = "";
        return;
      }
      if (tab.kind === "fields") {
        renderFields(tab);
      } else {
        renderCards(tab);
      }
    } catch (error) {
      console.error("[Feng] 预设面板渲染失败", error);
    }
  }

  searchInput.addEventListener("input", () => {
    searchText = searchInput.value.trim();
    page = 1;
    renderAll();
  });

  addItemButton.addEventListener("click", () => {
    const tab = findTab(index, currentTabId);
    if (!tab || tab.kind === "fields") {
      return;
    }
    openPresetEditor(tab.id, null, async () => {
      await refresh();
    });
  });

  clearButton.addEventListener("click", () => {
    const tab = findTab(index, currentTabId);
    if (!tab) {
      return;
    }
    if (tab.kind === "fields") {
      state.fields[tab.id] = defaultFields(tab);
    } else {
      state.selected[tab.id] = [];
    }
    persist();
    renderAll();
  });

  const previousOnResize = node.onResize;
  node.onResize = function () {
    previousOnResize?.apply(this, arguments);
    const height = Math.max(260, (this.size?.[1] || 640) - 220);
    root.style.height = height + "px";
    this.setDirtyCanvas?.(true, true);
  };

  const previousOnConfigure = node.onConfigure;
  node.onConfigure = function () {
    previousOnConfigure?.apply(this, arguments);
    const restored = parseState(readStateWidget(node)?.value, index);
    state.active = restored.active;
    state.selected = restored.selected;
    state.fields = restored.fields;
    page = 1;
    searchText = "";
    searchInput.value = "";
    persist(); // 把补齐后的状态写回，保证后端拿到的是启用过的配置
    renderAll();
  };

  renderAll();
  persist();

  const targetWidth = Math.max(node.size?.[0] || 0, 360);
  const targetHeight = Math.max(node.size?.[1] || 0, 660);
  if (node.size?.[0] < targetWidth || node.size?.[1] < targetHeight) {
    node.setSize?.([targetWidth, targetHeight]);
  }
  root.style.height = Math.max(260, targetHeight - 220) + "px";
}

function hideStateWidget(node) {
  const widget = readStateWidget(node);
  if (!widget) {
    return;
  }
  // 值要进 widgets_values / prompt，但完全不能显示、不能挡点击。
  // ComfyUI 1.55 的判断是 hidden ?? options.hidden ?? 类型名（deriveWidgetVisibility），
  // 所以只需 hidden = true；不要改 type，否则可能影响控件值的提交。
  widget.computeSize = () => [0, 0];
  widget.getHeight = () => 0;
  widget.draw = () => {};
  widget.hidden = true;
  widget.y = -10000;
  widget.last_y = -10000;
  widget.serializeValue = () => widget.value;
  for (const element of [widget.inputEl, widget.element].filter(Boolean)) {
    element.style.display = "none";
    element.style.pointerEvents = "none";
  }
}

app.registerExtension({
  name: "Feng.PromptPreset",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) {
      return;
    }

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      const node = this;
      hideStateWidget(node);
      loadIndex()
        .then((index) => {
          try {
            setupPanel(node, index);
          } catch (error) {
            console.error("[Feng] 提示词预设面板初始化失败", error);
            node.title = (node.title || "") + " (面板初始化失败)";
          }
        })
        .catch((error) => {
          console.error("[Feng] 预设数据加载失败", error);
          node.title = (node.title || "") + " (数据加载失败，请重启 ComfyUI)";
        });
      return result;
    };
  },
});
