// 「批量图片加载」节点的前端面板。
//
// 图片列表存在节点隐藏控件 images 里（JSON 数组，顺序即输出顺序）。
// 上传复用 ComfyUI 自带的 POST /upload/image；缩略图和放大预览走 /feng_images/preview（WEBP 缩放），
// 右下角 ↗ 走 /view 在新窗口打开原图；删除走 /feng_images/delete（移到 delltemp，可找回）。
//
// 文件位于 web/js/，浏览器 URL 是 /extensions/<插件目录名>/js/batch_loader.js，
// 所以相对路径要用三级 ../../../scripts/（与目录名无关，只和层级有关）。

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_NAME = "FengBatchImageLoader";
const STATE_WIDGET = "images";
const UPLOAD_URL = "/upload/image";
const VIEW_URL = "/view";
const PREVIEW_URL = "/feng_images/preview";
const DELETE_URL = "/feng_images/delete";

function withBase(path) {
  return typeof api.apiURL === "function" ? api.apiURL(path) : path;
}

// 上传默认落在 input/Feng/<yyyyMM>/，对应 input/Feng/%date:yyyyMM%/，
// 例如 2026 年 10 月 → Feng/202610（月份补两位，跨月自动换目录）。
function defaultUploadSubfolder(now = new Date()) {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return "Feng/" + year + month;
}

function previewUrl(entry) {
  const params = new URLSearchParams({
    filename: entry.name,
    subfolder: entry.subfolder || "",
    type: entry.type === "output" ? "output" : "input",
  });
  return withBase(`${VIEW_URL}?${params.toString()}`);
}

function readStateWidget(node) {
  return (node.widgets || []).find((widget) => widget.name === STATE_WIDGET);
}

function readList(node) {
  const widget = readStateWidget(node);
  if (!widget) {
    return [];
  }
  try {
    const data = JSON.parse(widget.value || "[]");
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .filter((item) => item && typeof item.name === "string" && item.name)
      .map((item, index) => ({
        name: item.name,
        subfolder: typeof item.subfolder === "string" ? item.subfolder : "",
        type: item.type === "output" ? "output" : "input",
        selected: item.selected !== false,
        // 遮罩只属于第一张；旧存档里其他条目带的 mask 直接丢弃
        mask: index === 0 && typeof item.mask === "string" ? item.mask : "",
      }));
  } catch (error) {
    return [];
  }
}

function writeList(node, list) {
  const widget = readStateWidget(node);
  if (widget) {
    widget.value = JSON.stringify(list);
  }
  node.setDirtyCanvas?.(true, true);
  app.graph?.setDirtyCanvas?.(true, true);
}

function hideStateWidget(node) {
  const widget = readStateWidget(node);
  if (!widget) {
    return;
  }
  // 值要进 widgets_values，但不能显示、不能挡点击（详见 AGENTS.md 前端约定）
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

function makeButton(label, extra) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.cssText =
    "cursor:pointer;border:1px solid #4a4a4a;border-radius:4px;padding:2px 8px;" +
    "background:#2b2b2b;color:#ddd;font-size:12px;line-height:18px;" +
    (extra || "");
  return button;
}

// 从 ComfyUI 的 input / output 目录里挑已有图片（逐层浏览子目录，避免一次列太多导致卡顿）。
// 缩略图和放大预览都走 /feng_images/preview（WEBP，服务端按需缩放）；
// 右上角「删除」打开后每张图出现 ✕，点击把文件移到 ComfyUI 根目录的 delltemp。
function openImagePicker(onPicked, options = {}) {
  const single = options.single === true;
  const onDeleted = typeof options.onDeleted === "function" ? options.onDeleted : null;
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,0.65);" +
    "display:flex;align-items:center;justify-content:center;";

  // 固定大小：目录里没有图片时窗口也不跟着缩
  const panel = document.createElement("div");
  panel.style.cssText =
    "width:min(700px,92vw);height:min(640px,88vh);box-sizing:border-box;background:#202020;" +
    "color:#ddd;border:1px solid #4a4a4a;border-radius:8px;padding:12px;" +
    "display:flex;flex-direction:column;gap:8px;font-size:12px;" +
    "box-shadow:0 8px 30px rgba(0,0,0,0.5);";

  const head = document.createElement("div");
  head.style.cssText = "display:flex;gap:6px;align-items:center;";
  const title = document.createElement("div");
  title.textContent = single ? "选择一张图片替换" : "从目录选择图片";
  title.style.cssText = "font-size:14px;font-weight:600;margin-right:auto;";
  const deleteButton = makeButton("🗑 删除");
  deleteButton.title = "打开删除模式：点图片右上角的 ✕，文件会移到 delltemp（可找回）";
  deleteButton.setAttribute("aria-pressed", "false");
  const inputButton = makeButton("input");
  const outputButton = makeButton("output");
  head.append(title, deleteButton, inputButton, outputButton);

  const pathRow = document.createElement("div");
  pathRow.style.cssText = "display:flex;gap:6px;align-items:center;";
  const upButton = makeButton("⬆ 上级");
  const pathText = document.createElement("span");
  pathText.style.cssText =
    "color:#9fd0ff;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  const countText = document.createElement("span");
  countText.style.cssText = "color:#8a8a8a;font-size:11px;margin-left:auto;white-space:nowrap;";
  pathRow.append(upButton, pathText, countText);

  const folderRow = document.createElement("div");
  folderRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;max-height:96px;overflow:auto;";

  const status = document.createElement("div");
  // 固定单行：长路径不换行、不撑高面板，悬停 title 看全文
  status.style.cssText =
    "color:#8a8a8a;font-size:11px;line-height:14px;height:14px;text-align:center;" +
    "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

  function setPickerStatus(text) {
    status.textContent = text;
    status.title = text;
  }

  const area = document.createElement("div");
  area.style.cssText = "flex:1;min-height:0;overflow:auto;";

  const foot = document.createElement("div");
  foot.style.cssText = "display:flex;gap:8px;justify-content:flex-end;align-items:center;";
  const counter = document.createElement("span");
  counter.style.cssText = "color:#9a9a9a;margin-right:auto;";
  const cancel = makeButton("取消");
  const confirm = makeButton(single ? "替换" : "添加所选");
  confirm.style.background = "#3a6ea5";
  if (single) {
    confirm.disabled = true;
    counter.textContent = "点一张图片即可替换";
  }
  foot.append(counter, cancel, confirm);

  // 放大预览单独挂在 body 上，避免被面板的 overflow 裁掉
  const preview = document.createElement("div");
  preview.style.cssText =
    "position:fixed;z-index:10004;display:none;pointer-events:none;padding:4px;" +
    "background:#141414;border:1px solid #4a4a4a;border-radius:6px;" +
    "box-shadow:0 12px 34px rgba(0,0,0,0.65);";
  const previewHint = document.createElement("div");
  previewHint.style.cssText = "color:#9a9a9a;font-size:12px;padding:30px 40px;white-space:nowrap;";
  previewHint.textContent = "加载中…";
  const previewImage = document.createElement("img");
  previewImage.alt = "预览";
  previewImage.style.cssText =
    "display:none;max-width:min(520px,58vw);max-height:72vh;border-radius:4px;";
  preview.append(previewHint, previewImage);

  panel.append(head, pathRow, folderRow, status, area, foot);
  overlay.append(panel);
  document.body.append(overlay, preview);

  const chosen = new Map();
  let source = "input";
  let subfolder = "";
  let deleteMode = false;
  let fileCount = 0;
  let folderCount = 0;
  let previewAnchor = null;
  let previewTimer = null;
  let loading = false;
  let loadToken = 0;
  const deleteButtons = [];

  function close() {
    hidePreview();
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", hidePreview);
    overlay.remove();
    preview.remove();
  }

  function onKey(event) {
    if (event.key === "Escape") {
      close();
    }
  }

  function syncCounter() {
    if (single) {
      counter.textContent = chosen.size ? "已选：" + Array.from(chosen.values())[0].name : "点一张图片即可替换";
      confirm.disabled = chosen.size === 0;
      return;
    }
    counter.textContent = "已选 " + chosen.size + " 张";
    confirm.disabled = chosen.size === 0;
  }

  function syncPath() {
    pathText.textContent = subfolder ? source + " / " + subfolder : source + " /";
    upButton.disabled = !subfolder;
    upButton.style.opacity = subfolder ? "1" : "0.5";
  }

  function syncCount() {
    countText.textContent = folderCount + " 个子目录 · " + fileCount + " 张图";
  }

  function idleStatus() {
    if (deleteMode) {
      return "删除模式：点图片右上角的 ✕ 移到 delltemp（保留原目录和文件名，可找回）";
    }
    return single ? "点一张图片即可替换" : "点缩略图选中（可多选），选完点「添加所选」";
  }

  // 缩略图用 320px、放大预览用 768px 的 WEBP；v 用 mtime，文件换了浏览器缓存自动失效
  function webpUrl(entry, maxSide) {
    const params = new URLSearchParams({
      source: entry.type === "output" ? "output" : "input",
      subfolder: entry.subfolder || "",
      name: entry.name,
      max: String(maxSide),
    });
    if (entry.mtime) {
      params.set("v", String(entry.mtime));
    }
    return withBase(PREVIEW_URL + "?" + params.toString());
  }

  function placePreview(rect) {
    const gap = 8;
    preview.style.visibility = "hidden";
    preview.style.display = "block";
    const box = preview.getBoundingClientRect();
    let left = rect.right + gap;
    if (left + box.width > window.innerWidth - gap) {
      left = rect.left - box.width - gap;
    }
    left = Math.max(gap, Math.min(left, window.innerWidth - box.width - gap));
    let top = rect.top + (rect.height - box.height) / 2;
    top = Math.max(gap, Math.min(top, window.innerHeight - box.height - gap));
    preview.style.left = Math.round(left) + "px";
    preview.style.top = Math.round(top) + "px";
    preview.style.visibility = "visible";
  }

  function hidePreview() {
    clearTimeout(previewTimer);
    previewTimer = null;
    previewAnchor = null;
    preview.style.display = "none";
    previewImage.removeAttribute("src");
  }

  function showPreview(entry, rect) {
    clearTimeout(previewTimer);
    previewAnchor = rect;
    // 悬停 120ms 再加载，快速扫过缩略图时不会把整屏都请求一遍
    previewTimer = setTimeout(() => {
      const url = webpUrl(entry, 768);
      previewHint.textContent = "加载中…";
      previewHint.style.display = "block";
      previewImage.style.display = "none";
      preview.style.display = "block";
      placePreview(rect);
      if (previewImage.getAttribute("src") === url && previewImage.complete && previewImage.naturalWidth) {
        previewHint.style.display = "none";
        previewImage.style.display = "block";
        placePreview(rect);
        return;
      }
      previewImage.src = url;
    }, 120);
  }

  previewImage.addEventListener("load", () => {
    previewHint.style.display = "none";
    previewImage.style.display = "block";
    if (previewAnchor) {
      placePreview(previewAnchor);
    }
  });
  previewImage.addEventListener("error", () => {
    previewImage.style.display = "none";
    previewHint.style.display = "block";
    previewHint.textContent = "预览失败";
    if (previewAnchor) {
      placePreview(previewAnchor);
    }
  });

  function setDeleteMode(next) {
    deleteMode = next;
    deleteButton.setAttribute("aria-pressed", String(deleteMode));
    deleteButton.textContent = deleteMode ? "☑ 删除中" : "🗑 删除";
    deleteButton.title = deleteMode
      ? "关闭删除模式；已删文件在 delltemp，可手动找回"
      : "打开删除模式：点图片右上角的 ✕，文件会移到 delltemp（可找回）";
    deleteButton.style.background = deleteMode ? "#7a2b2b" : "#2b2b2b";
    deleteButton.style.borderColor = deleteMode ? "#c05050" : "#4a4a4a";
    for (const button of deleteButtons) {
      button.style.display = deleteMode ? "block" : "none";
    }
    hidePreview();
    if (!loading && fileCount > 0) {
      setPickerStatus(idleStatus());
    }
  }

  async function deleteEntry(entry, tile, button) {
    if (button.dataset.busy === "1") {
      return;
    }
    button.dataset.busy = "1";
    button.textContent = "…";
    hidePreview();
    try {
      const response = await api.fetchApi(DELETE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: entry.name,
          subfolder: entry.subfolder || "",
          type: entry.type,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "HTTP " + response.status);
      }
      const key = entry.type + ":" + (entry.subfolder || "") + "/" + entry.name;
      chosen.delete(key);
      tile.remove();
      const position = deleteButtons.indexOf(button);
      if (position >= 0) {
        deleteButtons.splice(position, 1);
      }
      fileCount = Math.max(0, fileCount - 1);
      syncCount();
      syncCounter();
      setPickerStatus("已删除：" + entry.name + " → " + (data.moved_to || "delltemp"));
      if (onDeleted) {
        onDeleted(entry);
      }
    } catch (error) {
      button.dataset.busy = "";
      button.textContent = "✕";
      setPickerStatus("删除失败：" + error.message);
    }
  }

  async function load(nextSource, nextSubfolder) {
    const token = ++loadToken;
    source = nextSource;
    subfolder = nextSubfolder || "";
    inputButton.style.background = source === "input" ? "#3a6ea5" : "#2b2b2b";
    outputButton.style.background = source === "output" ? "#3a6ea5" : "#2b2b2b";
    syncPath();
    hidePreview();
    deleteButtons.length = 0;
    loading = true;
    setPickerStatus("读取中...");
    countText.textContent = "";
    area.textContent = "";
    folderRow.textContent = "";

    try {
      const query = new URLSearchParams({ source, subfolder });
      const response = await api.fetchApi("/feng_images/list?" + query.toString());
      const data = await response.json();
      // 快速连点目录时，旧请求回来不要再覆盖新目录
      if (token !== loadToken) {
        return;
      }
      if (!response.ok) {
        throw new Error(data.error || "HTTP " + response.status);
      }

      const folders = data.folders || [];
      const files = data.files || [];
      folderCount = folders.length;
      fileCount = files.length;
      syncCount();

      for (const folder of folders) {
        const chip = makeButton("📁 " + folder);
        chip.style.cssText += "font-size:11px;padding:1px 6px;";
        chip.title = "进入 " + folder;
        chip.addEventListener("click", () =>
          load(source, subfolder ? subfolder + "/" + folder : folder)
        );
        folderRow.append(chip);
      }

      setPickerStatus(
        files.length
          ? idleStatus()
          : folders.length
            ? "这个目录里没有图片，点上面的子目录进去看看"
            : "这个目录里没有图片"
      );
      loading = false;

      const grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;";
      for (const file of files) {
        const entry = {
          name: file.name,
          subfolder: file.subfolder || "",
          type: file.type || source,
          mtime: file.mtime_ns || file.mtime || 0,
        };
        const key = entry.type + ":" + entry.subfolder + "/" + entry.name;
        const tile = document.createElement("div");
        tile.style.cssText =
          "position:relative;border:2px solid " + (chosen.has(key) ? "#4f9bff" : "#3a3a3a") +
          ";border-radius:4px;overflow:hidden;background:#232323;cursor:pointer;";
        tile.title = key;

        const media = document.createElement("div");
        media.style.cssText =
          "position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;background:#1c1c1c;";

        const image = document.createElement("img");
        image.loading = "lazy";
        image.src = webpUrl(entry, 320);
        image.alt = entry.name;
        image.style.cssText =
          "display:block;width:100%;height:100%;object-fit:cover;background:#1c1c1c;";
        image.addEventListener("error", () => {
          // 个别图片转换 WEBP 失败时退回原图，不影响挑选
          if (image.dataset.fallback !== "1") {
            image.dataset.fallback = "1";
            image.src = previewUrl(entry);
          }
        });

        const zoom = document.createElement("span");
        zoom.textContent = "🔍";
        zoom.title = "放大预览（WEBP）";
        zoom.style.cssText =
          "position:absolute;right:3px;bottom:3px;cursor:zoom-in;border-radius:3px;" +
          "background:rgba(0,0,0,0.7);color:#ddd;font-size:14px;line-height:20px;padding:0 4px;";
        zoom.addEventListener("mouseenter", (event) => {
          event.stopPropagation();
          showPreview(entry, zoom.getBoundingClientRect());
        });
        zoom.addEventListener("mouseleave", hidePreview);
        zoom.addEventListener("click", (event) => event.stopPropagation());

        const remove = document.createElement("span");
        remove.textContent = "✕";
        remove.title = "删除这张图（移到 delltemp，可找回）";
        remove.style.cssText =
          "position:absolute;top:3px;right:3px;cursor:pointer;border-radius:3px;" +
          "background:rgba(196,48,48,0.92);color:#fff;font-size:12px;line-height:16px;" +
          "padding:0 4px;display:" + (deleteMode ? "block" : "none") + ";";
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          deleteEntry(entry, tile, remove);
        });
        deleteButtons.push(remove);

        const openOriginal = document.createElement("a");
        openOriginal.textContent = "↗";
        openOriginal.title = "在新窗口打开原图";
        openOriginal.setAttribute("aria-label", "在新窗口打开原图");
        openOriginal.href = previewUrl(entry);
        openOriginal.target = "_blank";
        openOriginal.rel = "noopener noreferrer";
        openOriginal.style.cssText =
          "position:absolute;right:30px;bottom:3px;cursor:pointer;border-radius:3px;" +
          "background:rgba(0,0,0,0.7);color:#ddd;font-size:14px;line-height:20px;padding:0 4px;" +
          "text-decoration:none;";
        openOriginal.addEventListener("click", (event) => {
          event.stopPropagation();
          hidePreview();
        });

        media.append(image, zoom, openOriginal, remove);

        const caption = document.createElement("div");
        caption.textContent = entry.name;
        caption.style.cssText =
          "padding:2px 4px;font-size:10px;line-height:13px;height:13px;overflow:hidden;" +
          "white-space:nowrap;text-overflow:ellipsis;color:#cfcfcf;";

        tile.append(media, caption);
        tile.addEventListener("click", () => {
          if (deleteMode) {
            return;
          }
          if (single) {
            // 单选模式：点一下就定，直接关窗回调
            chosen.clear();
            chosen.set(key, entry);
            syncCounter();
            const picked = Array.from(chosen.values());
            close();
            onPicked(picked);
            return;
          }
          if (chosen.has(key)) {
            chosen.delete(key);
            tile.style.borderColor = "#3a3a3a";
          } else {
            chosen.set(key, entry);
            tile.style.borderColor = "#4f9bff";
          }
          syncCounter();
        });
        grid.append(tile);
      }
      area.append(grid);
    } catch (error) {
      if (token !== loadToken) {
        return;
      }
      loading = false;
      setPickerStatus("读取失败：" + error.message);
    }
  }

  inputButton.addEventListener("click", () => load("input", ""));
  outputButton.addEventListener("click", () => load("output", ""));
  upButton.addEventListener("click", () => {
    if (!subfolder) {
      return;
    }
    const parts = subfolder.split("/");
    parts.pop();
    load(source, parts.join("/"));
  });
  cancel.addEventListener("click", close);
  deleteButton.addEventListener("click", () => setDeleteMode(!deleteMode));
  confirm.addEventListener("click", () => {
    const picked = Array.from(chosen.values());
    close();
    if (picked.length) {
      onPicked(picked);
    }
  });
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", hidePreview);
  area.addEventListener("scroll", hidePreview, { passive: true });
  syncCounter();
  syncPath();
  load("input", "");
}

// 给第一张图画遮罩：白 = 保留/选中，导出成 png 上传到 input 目录。
function openMaskPainter(imageUrl, onSaved) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:10003;background:rgba(0,0,0,0.7);" +
    "display:flex;align-items:center;justify-content:center;";

  const panel = document.createElement("div");
  panel.style.cssText =
    "background:#202020;color:#ddd;border:1px solid #4a4a4a;border-radius:8px;padding:12px;" +
    "display:flex;flex-direction:column;gap:8px;font-size:12px;box-shadow:0 8px 30px rgba(0,0,0,0.5);";

  const title = document.createElement("div");
  title.textContent = "编辑第一张图的遮罩";
  title.style.cssText = "font-size:14px;font-weight:600;";

  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative;line-height:0;background:#111;";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "display:block;max-width:min(560px,84vw);max-height:60vh;cursor:crosshair;";
  wrap.append(canvas);

  const controls = document.createElement("div");
  controls.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;";
  const brushLabel = document.createElement("span");
  brushLabel.textContent = "笔刷";
  const brush = document.createElement("input");
  brush.type = "range";
  brush.min = "6";
  brush.max = "120";
  brush.value = "36";
  brush.style.cssText = "width:140px;";
  const modeButton = makeButton("画笔");
  const clearButton = makeButton("清除");
  controls.append(brushLabel, brush, modeButton, clearButton);

  const status = document.createElement("div");
  status.style.cssText = "color:#8a8a8a;font-size:11px;min-height:14px;";
  status.textContent = "在图上涂抹要编辑的区域；白 = 遮罩区域。";

  const foot = document.createElement("div");
  foot.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
  const cancel = makeButton("取消");
  const save = makeButton("保存遮罩");
  save.style.background = "#3a6ea5";
  foot.append(cancel, save);

  panel.append(title, wrap, controls, status, foot);
  overlay.append(panel);
  document.body.append(overlay);

  const maskCanvas = document.createElement("canvas");
  const background = new Image();
  let ready = false;
  let painting = false;
  let erasing = false;

  function redraw() {
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#111111";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (background.complete) {
      context.drawImage(background, 0, 0, canvas.width, canvas.height);
    }
    context.globalAlpha = 0.5;
    context.drawImage(maskCanvas, 0, 0);
    context.globalAlpha = 1;
  }

  background.addEventListener("load", () => {
    const maxSide = 560;
    const scale = Math.min(1, maxSide / Math.max(background.naturalWidth, background.naturalHeight));
    canvas.width = Math.round(background.naturalWidth * scale);
    canvas.height = Math.round(background.naturalHeight * scale);
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    ready = true;
    redraw();
  });
  background.addEventListener("error", () => {
    status.textContent = "图片加载失败，无法编辑遮罩";
  });
  background.src = imageUrl;

  function paintAt(event) {
    if (!ready) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (canvas.width / rect.width);
    const y = (event.clientY - rect.top) * (canvas.height / rect.height);
    const context = maskCanvas.getContext("2d");
    context.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(x, y, Number(brush.value) / 2, 0, Math.PI * 2);
    context.fill();
    redraw();
  }

  canvas.addEventListener("pointerdown", (event) => {
    painting = true;
    canvas.setPointerCapture?.(event.pointerId);
    paintAt(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (painting) {
      paintAt(event);
    }
  });
  canvas.addEventListener("pointerup", () => {
    painting = false;
  });
  canvas.addEventListener("pointerleave", () => {
    painting = false;
  });

  modeButton.addEventListener("click", () => {
    erasing = !erasing;
    modeButton.textContent = erasing ? "橡皮" : "画笔";
    modeButton.style.background = erasing ? "#5a3030" : "#2b2b2b";
  });
  clearButton.addEventListener("click", () => {
    const context = maskCanvas.getContext("2d");
    context.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
    redraw();
  });

  function close() {
    overlay.remove();
  }

  cancel.addEventListener("click", close);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  save.addEventListener("click", async () => {
    if (!ready) {
      return;
    }
    save.disabled = true;
    status.textContent = "保存中...";
    try {
      // 导出黑白 png：白 = 遮罩
      const out = document.createElement("canvas");
      out.width = maskCanvas.width;
      out.height = maskCanvas.height;
      const context = out.getContext("2d");
      context.fillStyle = "#000000";
      context.fillRect(0, 0, out.width, out.height);
      context.drawImage(maskCanvas, 0, 0);

      const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
      if (!blob) {
        throw new Error("导出遮罩失败");
      }
      const form = new FormData();
      form.append("image", blob, `feng_mask_${Date.now()}.png`);
      form.append("type", "input");
      const response = await api.fetchApi(UPLOAD_URL, { method: "POST", body: form });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      close();
      onSaved(data.name);
    } catch (error) {
      status.textContent = "保存失败：" + error.message;
      save.disabled = false;
    }
  });
}

function setupPanel(node) {
  let list = readList(node);
  let busy = false;
  let dragIndex = null;

  const root = document.createElement("div");
  root.style.cssText =
    "display:flex;flex-direction:column;gap:6px;padding:6px;box-sizing:border-box;" +
    "font-size:12px;color:#ddd;overflow:hidden;height:420px;border:1px dashed transparent;" +
    "border-radius:6px;";

  const toolbar = document.createElement("div");
  toolbar.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap;";

  const addButton = makeButton("＋ 上传图片");
  const pickerButton = makeButton("📁 选择已有");
  const selectAllButton = makeButton("全选");
  const invertButton = makeButton("反选");
  const clearButton = makeButton("清空");
  const counter = document.createElement("span");
  counter.style.cssText = "color:#9a9a9a;font-size:11px;margin-left:auto;";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.multiple = true;
  fileInput.style.display = "none";

  const status = document.createElement("div");
  status.style.cssText = "color:#8a8a8a;font-size:11px;line-height:16px;min-height:16px;";
  status.textContent = "把图片拖到这里，或点「＋ 添加图片」。所有图片会按下面的顺序输出。";

  const gridArea = document.createElement("div");
  // 内容超高时在网格区域内滚动，节点高度保持不变
  gridArea.style.cssText = "flex:1;min-height:0;overflow:auto;";

  const grid = document.createElement("div");
  grid.style.cssText =
    "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;";
  gridArea.append(grid);

  toolbar.append(addButton, pickerButton, selectAllButton, invertButton, clearButton, counter, fileInput);
  root.append(toolbar, status, gridArea);

  node.addDOMWidget("feng_batch_panel", "feng_batch_panel", root, {
    serialize: false,
    hideOnZoom: false,
  });

  function setStatus(text, isError) {
    status.textContent = text;
    status.style.color = isError ? "#ff9b9b" : "#8a8a8a";
  }

  // 整个面板只有第一张能带遮罩，任何改动落盘前都先把其他条目的 mask 清掉
  function sanitizeMasks() {
    list.forEach((entry, index) => {
      if (index !== 0) {
        entry.mask = "";
      }
    });
  }

  function persist() {
    sanitizeMasks();
    writeList(node, list);
  }

  // 选择窗口里删掉的文件如果已在列表里，同步移除，避免节点还引用不存在的文件
  function entryKey(entry) {
    if (!entry) {
      return "";
    }
    const type = entry.type === "output" ? "output" : "input";
    return type + ":" + (entry.subfolder || "") + "/" + entry.name;
  }

  function forgetDeleted(entry) {
    const key = entryKey(entry);
    if (!key) {
      return;
    }
    const next = list.filter((item) => entryKey(item) !== key);
    if (next.length === list.length) {
      return;
    }
    list = next;
    persist();
    renderAll();
    setStatus("已从列表移除：" + entry.name + "（文件在 delltemp）", false);
  }

  function selectedCount() {
    return list.filter((entry) => entry.selected).length;
  }

  function renderGrid() {
    grid.textContent = "";

    if (!list.length) {
      const empty = document.createElement("div");
      empty.textContent = "还没有图片，点「＋ 添加图片」或直接把文件拖进来";
      empty.style.cssText =
        "grid-column:1/-1;padding:24px 8px;text-align:center;color:#8a8a8a;" +
        "border:1px dashed #4a4a4a;border-radius:6px;line-height:18px;";
      grid.append(empty);
      return;
    }

    list.forEach((entry, index) => {
      const tile = document.createElement("div");
      tile.style.cssText =
        "position:relative;display:flex;flex-direction:column;background:#232323;border-radius:4px;" +
        "overflow:hidden;border:2px solid " + (entry.selected ? "#4f9bff" : "#3a3a3a") + ";" +
        (entry.selected ? "" : "opacity:0.55;");
      tile.title = entry.subfolder ? `${entry.subfolder}/${entry.name}` : entry.name;

      const media = document.createElement("div");
      media.style.cssText =
        "position:relative;width:100%;aspect-ratio:1/1;overflow:hidden;background:#1c1c1c;" +
        "display:flex;align-items:center;justify-content:center;color:#6f6f6f;font-size:11px;";

      // 占位文字单独成节点：图片加载完只移除占位，不能清 textContent（会把 img 一起删掉）
      const placeholder = document.createElement("span");
      placeholder.textContent = "加载中";
      media.append(placeholder);

      // 图片尺寸：贴在缩略图右下角
      const sizeLabel = document.createElement("div");
      sizeLabel.textContent = "…";
      sizeLabel.style.cssText =
        "position:absolute;right:2px;bottom:2px;background:rgba(0,0,0,0.62);color:#ddd;" +
        "font-size:10px;line-height:13px;padding:0 4px;border-radius:3px;pointer-events:none;";

      const image = document.createElement("img");
      image.loading = "lazy";
      image.draggable = false;
      image.src = previewUrl(entry);
      image.alt = entry.name;
      image.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;cursor:pointer;";
      image.addEventListener("load", () => {
        placeholder.remove();
        sizeLabel.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
      });
      image.addEventListener("error", () => {
        image.remove();
        placeholder.textContent = "读取失败";
        sizeLabel.textContent = "尺寸未知";
      });
      media.append(image, sizeLabel);

      const indexBadge = document.createElement("div");
      indexBadge.textContent = String(index + 1);
      indexBadge.style.cssText =
        "position:absolute;top:2px;left:2px;background:rgba(0,0,0,0.65);color:#ddd;" +
        "font-size:11px;line-height:14px;padding:0 4px;border-radius:3px;";

      const tools = document.createElement("div");
      tools.style.cssText = "position:absolute;top:2px;right:2px;display:flex;gap:2px;";

      const makeTool = (text, title) => {
        const span = document.createElement("span");
        span.textContent = text;
        span.title = title;
        span.style.cssText =
          "cursor:pointer;background:rgba(0,0,0,0.65);border-radius:3px;padding:0 3px;" +
          "color:#ddd;font-size:11px;line-height:14px;";
        return span;
      };

      const replaceTool = makeTool("⇄", "替换这张图");
      const moveLeft = makeTool("◀", "前移");
      const moveRight = makeTool("▶", "后移");
      const remove = makeTool("✕", "移除");
      replaceTool.addEventListener("click", (event) => {
        event.stopPropagation();
        const targetEntry = list[index];
        // 快照一份「原图前面的条目」，删除后靠对象身份数出还活着的有几个
        const before = list.slice(0, index);
        openImagePicker((picked) => {
          if (!picked.length) {
            return;
          }
          const entry = picked[0];
          const next = {
            name: entry.name,
            subfolder: entry.subfolder || "",
            type: entry.type === "output" ? "output" : "input",
            selected: true,
            mask: "",
          };
          // 选择窗口里可能删过图：先按对象身份找原位，找不到再插回原来的相对位置
          let target = targetEntry ? list.indexOf(targetEntry) : -1;
          if (target < 0) {
            target = before.filter((item) => list.includes(item)).length;
            list.splice(target, 0, next);
          } else {
            list[target] = next;
          }
          persist();
          renderAll();
          setStatus(`已替换第 ${target + 1} 张：${entry.name}`, false);
        }, { single: true, onDeleted: forgetDeleted });
      });
      tools.append(replaceTool, moveLeft, moveRight, remove);

      // 拖拽排序：拖到另一格上就插到那里
      tile.draggable = true;
      tile.addEventListener("dragstart", (event) => {
        dragIndex = index;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(index));
        tile.style.opacity = "0.45";
      });
      tile.addEventListener("dragover", (event) => {
        if (dragIndex === null || dragIndex === index) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        tile.style.outline = "2px solid #ff88cc";
      });
      tile.addEventListener("dragleave", () => {
        tile.style.outline = "none";
      });
      tile.addEventListener("drop", (event) => {
        if (dragIndex === null) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        tile.style.outline = "none";
        const from = dragIndex;
        dragIndex = null;
        if (from === index) {
          return;
        }
        const [moved] = list.splice(from, 1);
        list.splice(index, 0, moved);
        persist();
        renderAll();
      });
      tile.addEventListener("dragend", () => {
        dragIndex = null;
        tile.style.opacity = "";
        tile.style.outline = "none";
      });

      // 只有第一张能编辑遮罩（后端也只消费第一张的遮罩）
      if (index === 0) {
        const maskTool = makeTool("◐", "编辑遮罩（只作用于第一张）");
        maskTool.title = "编辑遮罩（只作用于第一张）";
        maskTool.addEventListener("click", (event) => {
          event.stopPropagation();
          openMaskPainter(previewUrl(entry), (maskName) => {
            entry.mask = maskName;
            persist();
            renderAll();
            setStatus("遮罩已保存，会作用于第一张（重新排队生效）", false);
          });
        });
        tools.append(maskTool);
      }

      const name = document.createElement("div");
      name.textContent = (entry.type === "output" ? "[out] " : "") + entry.name;
      name.title = name.textContent;
      // 文件名固定单行，超出用省略号
      name.style.cssText =
        "padding:3px 4px;font-size:11px;line-height:14px;height:14px;box-sizing:content-box;" +
        "overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#cfcfcf;";

      if (index === 0 && entry.mask) {
        const maskBadge = document.createElement("div");
        maskBadge.textContent = "遮罩";
        maskBadge.style.cssText =
          "position:absolute;bottom:2px;left:2px;background:rgba(255,80,80,0.75);color:#fff;" +
          "font-size:10px;line-height:13px;padding:0 3px;border-radius:3px;";
        media.append(maskBadge);
      }

      moveLeft.addEventListener("click", (event) => {
        event.stopPropagation();
        if (index === 0) {
          return;
        }
        [list[index - 1], list[index]] = [list[index], list[index - 1]];
        persist();
        renderAll();
      });
      moveRight.addEventListener("click", (event) => {
        event.stopPropagation();
        if (index === list.length - 1) {
          return;
        }
        [list[index], list[index + 1]] = [list[index + 1], list[index]];
        persist();
        renderAll();
      });
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        list.splice(index, 1);
        persist();
        renderAll();
      });

      media.addEventListener("click", (event) => {
        if (event.shiftKey) {
          entry.selected = !entry.selected;
        } else if (entry.selected && selectedCount() === 1) {
          entry.selected = false;
        } else {
          list.forEach((item, itemIndex) => {
            item.selected = itemIndex === index;
          });
        }
        persist();
        renderAll();
      });

      media.append(indexBadge, tools);
      tile.append(media, name);
      grid.append(tile);
    });
  }

  function renderAll() {
    try {
      renderGrid();
      counter.textContent = `已选 ${selectedCount()} / 共 ${list.length}`;
      clearButton.disabled = !list.length;
      selectAllButton.disabled = !list.length;
      invertButton.disabled = !list.length;
    } catch (error) {
      console.error("[Feng] 批量图片面板渲染失败", error);
    }
  }

  async function uploadFiles(files) {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      setStatus("没有可上传的图片文件", true);
      return;
    }
    if (busy) {
      return;
    }
    busy = true;
    addButton.disabled = true;
    const targetSubfolder = defaultUploadSubfolder();
    let done = 0;
    try {
      for (const file of images) {
        setStatus(`正在上传 ${done + 1}/${images.length}：${file.name}`, false);
        const form = new FormData();
        form.append("image", file, file.name);
        form.append("type", "input");
        form.append("subfolder", targetSubfolder);
        const response = await api.fetchApi(UPLOAD_URL, { method: "POST", body: form });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        list.push({
          name: data.name,
          subfolder: data.subfolder || "",
          selected: true,
        });
        done += 1;
        // 每成功一张就落盘，后面失败也不会全丢
        persist();
        renderAll();
      }
      setStatus(`已添加 ${done} 张，顺序即输出顺序`, false);
    } catch (error) {
      console.error("[Feng] 图片上传失败", error);
      setStatus(`上传失败：${error.message}（已成功 ${done} 张）`, true);
    } finally {
      busy = false;
      addButton.disabled = false;
      fileInput.value = "";
    }
  }

  addButton.addEventListener("click", () => fileInput.click());
  pickerButton.addEventListener("click", () => {
    openImagePicker((picked) => {
      list = list.concat(
        picked.map((entry) => ({
          name: entry.name,
          subfolder: entry.subfolder || "",
          type: entry.type === "output" ? "output" : "input",
          selected: true,
          mask: "",
        }))
      );
      persist();
      renderAll();
      setStatus(`已添加 ${picked.length} 张（来自 ${picked[0]?.type || "input"}）`, false);
    }, { onDeleted: forgetDeleted });
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files.length) {
      uploadFiles(fileInput.files);
    }
  });

  selectAllButton.addEventListener("click", () => {
    list.forEach((entry) => {
      entry.selected = true;
    });
    persist();
    renderAll();
  });

  invertButton.addEventListener("click", () => {
    list.forEach((entry) => {
      entry.selected = !entry.selected;
    });
    persist();
    renderAll();
  });

  clearButton.addEventListener("click", () => {
    list = [];
    persist();
    renderAll();
    setStatus("已清空。注意：文件仍留在 ComfyUI 的 input 目录里，没有被删除。", false);
  });

  // 拖拽上传：拦住事件，避免 ComfyUI 画布把它当工作流文件处理
  let dragDepth = 0;
  root.addEventListener("dragenter", (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepth += 1;
    root.style.borderColor = "#4f9bff";
    setStatus("松开鼠标即可上传", false);
  });
  root.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types?.includes("Files")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  });
  root.addEventListener("dragleave", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      root.style.borderColor = "transparent";
      setStatus("把图片拖到这里，或点「＋ 添加图片」。", false);
    }
  });
  root.addEventListener("drop", (event) => {
    if (!event.dataTransfer?.files?.length) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    root.style.borderColor = "transparent";
    uploadFiles(event.dataTransfer.files);
  });

  const previousOnResize = node.onResize;
  node.onResize = function () {
    previousOnResize?.apply(this, arguments);
    const height = Math.max(260, (this.size?.[1] || 640) - 190);
    root.style.height = height + "px";
    this.setDirtyCanvas?.(true, true);
  };

  const previousOnConfigure = node.onConfigure;
  node.onConfigure = function () {
    previousOnConfigure?.apply(this, arguments);
    list = readList(node);
    renderAll();
  };

  renderAll();

  const targetWidth = Math.max(node.size?.[0] || 0, 420);
  const targetHeight = Math.max(node.size?.[1] || 0, 620);
  if (node.size?.[0] < targetWidth || node.size?.[1] < targetHeight) {
    node.setSize?.([targetWidth, targetHeight]);
  }
  root.style.height = Math.max(260, targetHeight - 190) + "px";
}

app.registerExtension({
  name: "Feng.BatchLoader",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) {
      return;
    }

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      const node = this;
      hideStateWidget(node);
      try {
        setupPanel(node);
      } catch (error) {
        console.error("[Feng] 批量图片面板初始化失败", error);
        node.title = (node.title || "") + " (面板初始化失败)";
      }
      return result;
    };
  },
});
