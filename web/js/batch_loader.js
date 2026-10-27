// 「批量图片加载」节点的前端面板。
//
// 图片列表存在节点隐藏控件 images 里（JSON 数组，顺序即输出顺序）。
// 上传复用 ComfyUI 自带的 POST /upload/image，预览用 GET /view，不额外开后端路由。
//
// 文件位于 web/js/，浏览器 URL 是 /extensions/Feng/js/batch_loader.js，
// 所以相对路径要用三级 ../../../scripts/。

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_NAME = "FengBatchImageLoader";
const STATE_WIDGET = "images";
const UPLOAD_URL = "/upload/image";
const VIEW_URL = "/view";

function withBase(path) {
  return typeof api.apiURL === "function" ? api.apiURL(path) : path;
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
      .map((item) => ({
        name: item.name,
        subfolder: typeof item.subfolder === "string" ? item.subfolder : "",
        type: item.type === "output" ? "output" : "input",
        selected: item.selected !== false,
        mask: typeof item.mask === "string" ? item.mask : "",
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
function openImagePicker(onPicked, options = {}) {
  const single = options.single === true;
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
  const inputButton = makeButton("input");
  const outputButton = makeButton("output");
  head.append(title, inputButton, outputButton);

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
  status.style.cssText = "color:#8a8a8a;font-size:11px;min-height:14px;text-align:center;";

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

  panel.append(head, pathRow, folderRow, status, area, foot);
  overlay.append(panel);
  document.body.append(overlay);

  const chosen = new Map();
  let source = "input";
  let subfolder = "";

  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }

  function onKey(event) {
    if (event.key === "Escape") {
      close();
    }
  }

  function syncCounter() {
    if (single) {
      counter.textContent = chosen.size ? `已选：${Array.from(chosen.values())[0].name}` : "点一张图片即可替换";
      confirm.disabled = chosen.size === 0;
      return;
    }
    counter.textContent = `已选 ${chosen.size} 张`;
    confirm.disabled = chosen.size === 0;
  }

  function syncPath() {
    pathText.textContent = subfolder ? `${source} / ${subfolder}` : `${source} /`;
    upButton.disabled = !subfolder;
    upButton.style.opacity = subfolder ? "1" : "0.5";
  }

  async function load(nextSource, nextSubfolder) {
    source = nextSource;
    subfolder = nextSubfolder || "";
    inputButton.style.background = source === "input" ? "#3a6ea5" : "#2b2b2b";
    outputButton.style.background = source === "output" ? "#3a6ea5" : "#2b2b2b";
    syncPath();
    status.textContent = "读取中...";
    countText.textContent = "";
    area.textContent = "";
    folderRow.textContent = "";

    try {
      const query = new URLSearchParams({ source, subfolder });
      const response = await api.fetchApi(`/feng_images/list?${query.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      const folders = data.folders || [];
      const files = data.files || [];
      countText.textContent = `${folders.length} 个子目录 · ${files.length} 张图`;

      for (const folder of folders) {
        const chip = makeButton(`📁 ${folder}`);
        chip.style.cssText += "font-size:11px;padding:1px 6px;";
        chip.title = `进入 ${folder}`;
        chip.addEventListener("click", () =>
          load(source, subfolder ? `${subfolder}/${folder}` : folder)
        );
        folderRow.append(chip);
      }

      status.textContent = files.length
        ? "点缩略图选中（可多选），选完点「添加所选」"
        : folders.length
          ? "这个目录里没有图片，点上面的子目录进去看看"
          : "这个目录里没有图片";

      const grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;";
      for (const file of files) {
        const entry = {
          name: file.name,
          subfolder: file.subfolder || "",
          type: file.type || source,
        };
        const key = `${entry.type}:${entry.subfolder}/${entry.name}`;
        const tile = document.createElement("div");
        tile.style.cssText =
          "position:relative;border:2px solid " + (chosen.has(key) ? "#4f9bff" : "#3a3a3a") +
          ";border-radius:4px;overflow:hidden;background:#232323;cursor:pointer;";
        tile.title = key;

        const image = document.createElement("img");
        image.loading = "lazy";
        image.src = previewUrl(entry);
        image.style.cssText =
          "display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:#1c1c1c;";

        const caption = document.createElement("div");
        caption.textContent = entry.name;
        caption.style.cssText =
          "padding:2px 4px;font-size:10px;line-height:13px;height:13px;overflow:hidden;" +
          "white-space:nowrap;text-overflow:ellipsis;color:#cfcfcf;";

        tile.append(image, caption);
        tile.addEventListener("click", () => {
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
      status.textContent = "读取失败：" + error.message;
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

  function persist() {
    writeList(node, list);
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
        const target = index;
        openImagePicker((picked) => {
          if (!picked.length) {
            return;
          }
          const entry = picked[0];
          list[target] = {
            name: entry.name,
            subfolder: entry.subfolder || "",
            type: entry.type === "output" ? "output" : "input",
            selected: true,
            mask: "",
          };
          persist();
          renderAll();
          setStatus(`已替换第 ${target + 1} 张：${entry.name}`, false);
        }, { single: true });
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

      if (entry.mask) {
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
    let done = 0;
    try {
      for (const file of images) {
        setStatus(`正在上传 ${done + 1}/${images.length}：${file.name}`, false);
        const form = new FormData();
        form.append("image", file, file.name);
        form.append("type", "input");
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
        picked.map((entry) => ({ ...entry, selected: true, mask: "" }))
      );
      persist();
      renderAll();
      setStatus(`已添加 ${picked.length} 张（来自 ${picked[0]?.type || "input"}）`, false);
    });
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
