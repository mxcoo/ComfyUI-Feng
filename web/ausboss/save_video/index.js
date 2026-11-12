import { panelSwitch } from "../shared/panel_controls.mjs";
import { api } from "../../../../scripts/api.js";
import { app } from "../../../../scripts/app.js";
import { isForeignRun, outputKey } from "../shared/prompt_scope.mjs";
import { chainCallback, keepDomWidgetWidthAuto, notifyAusbossChange } from "../shared/index.mjs";
import { installNameTokens } from "../shared/name_tokens.mjs";
import { fillNodeHeight } from "../shared/panel_layout.mjs";
import { addStepConsumer, mountStepOverlay, showsStepsOn, stepRun, stopStepRun, watchSteps } from "../shared/step_preview.mjs";
import {
  findVideoMetadata,
  isStillImage,
  mediaInfo,
  mediaViewQuery,
  responsivePreviewHeight,
} from "../shared/video_preview.mjs";
import {
  VIDEO_MIN_WIDTH,
  ensureVideoCss,
  makeToolButton,
  suppressCoreVideoPreview,
} from "../shared/video_ui.mjs";

const NODE_NAME = "AUSBOSS_NODES_SaveVideo";
const PREVIEW_WIDGET = "ausboss_save_video_viewer";
const PREVIEW_CHROME = 38;
// Height the node opens at. It used to fall out of the panel's computeSize;
// with the panel free to follow the node, the default has to be stated. Same
// 16:9-ish stage the width-derived formula produced, plus the widget rows.
const DEFAULT_NODE_SIZE = [
  380,
  responsivePreviewHeight(380, 132, 520) + PREVIEW_CHROME + 150,
];

function getLoopEnabled(node) {
  node.properties ??= {};
  if (node.properties.ausboss_save_video_loop === undefined) {
    node.properties.ausboss_save_video_loop = true;
  }
  return !!node.properties.ausboss_save_video_loop;
}

// The Preview steps switch: the hidden `step_preview` widget (the card hides it).
// On, the player shows each step of the clip's first frame while it is
// being made, and a STOP button joins the tools for the run.
function stepsOn(state) {
  return state.stepsWidget?.value === true;
}

function syncSteps(state, run = stepRun()) {
  const on = stepsOn(state);
  state.stepsButton?.setAttribute("aria-checked", String(on));
  state.stopButton?.classList.toggle("live", on && run.status === "running");
  const overlay = state.stepOverlay;
  if (!on) {
    overlay.hide();
    return;
  }
  const thisRun = (id) => id !== null && id !== undefined && String(id) === String(run.promptId);
  if (run.status === "running") {
    if (thisRun(state.stepsSaved)) return;
    if (run.url && showsStepsOn(state.node, run)) {
      state.stepsShown = run;
      overlay.show(run, { saves: true });
    } else if (!thisRun(state.stepsShown?.promptId)) {
      overlay.hide();
    }
    return;
  }
  if (run.status === "stopped" && thisRun(state.stepsShown?.promptId) && !thisRun(state.stepsSaved)) {
    overlay.show({ ...state.stepsShown, status: "stopped" }, { saves: true });
    return;
  }
  overlay.hide();
}

function setEmpty(state, text) {
  state.stage.classList.add("is-empty");
  state.status.textContent = text;
}

function setReady(state, text) {
  state.stage.classList.remove("is-empty");
  state.status.textContent = text;
}

function loadMetadata(state, meta) {
  if (!meta?.filename) {
    setEmpty(state, "没有返回已保存的视频");
    return;
  }
  state.meta = { ...meta };
  setEmpty(state, `正在加载 ${meta.filename}…`);
  const url = api.apiURL(`/view?${mediaViewQuery(meta, "output")}`);
  const still = isStillImage(meta.filename);
  state.stage.classList.toggle("is-still", still);
  state.video.pause();
  if (still) {
    state.video.removeAttribute("src");
    state.image.src = url;
    return;
  }
  state.image.removeAttribute("src");
  state.video.src = url;
  state.video.load();
}

function buildPreview(node) {
  if (node.__ausbossSaveVideo) return node.__ausbossSaveVideo;
  ensureVideoCss();
  suppressCoreVideoPreview(node);

  const root = document.createElement("div");
  root.className = "ausboss-video-root";
  const stage = document.createElement("div");
  stage.className = "ausboss-video-stage is-empty";
  const video = document.createElement("video");
  video.controls = true;
  video.preload = "metadata";
  video.playsInline = true;
  const image = document.createElement("img");
  image.className = "ausboss-video-still";
  const status = document.createElement("div");
  status.className = "ausboss-video-status";
  status.textContent = "运行后可预览保存的视频";
  const tools = document.createElement("div");
  tools.className = "ausboss-video-tools";
  // No reload button: the preview is already the last saved file, so the
  // button only ever re-fetched what was on screen, and after a page reload
  // there is no saved file in memory for it to fetch at all.
  const loopButton = makeToolButton("LOOP", "切换这段已保存预览的循环播放");
  loopButton.classList.add("ausboss-steps-loop");
  const stopButton = makeToolButton("STOP", "立即停止本次运行。队列里的下一次运行仍会开始。");
  stopButton.classList.add("ausboss-steps-stop");
  const stepsButton = panelSwitch("预览步骤", "生成过程中在这里显示片段的第一帧，一步一步更新，并带一个停止按钮。默认关闭。");
  tools.classList.add("ausboss-steps-tools");
  tools.append(stopButton, loopButton);
  stage.append(video, image, status, tools);
  root.append(stepsButton, stage);

  const widget = node.addDOMWidget(PREVIEW_WIDGET, "ausboss_video", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 132,
  });
  keepDomWidgetWidthAuto(widget);
  // Not saved with the workflow either: options.serialize only keeps it out
  // of the prompt, and saved values come back by position.
  widget.serialize = false;
  fillNodeHeight(widget, {
    minWidth: VIDEO_MIN_WIDTH,
    minHeight: 158,
    minNodeSize: [VIDEO_MIN_WIDTH, 270],
    exactMinWidth: true,
  });

  const abort = new AbortController();
  const state = node.__ausbossSaveVideo = {
    node, root, stage, video, image, status, tools, loopButton,
    widget, abort, meta: null,
    stepsWidget: node.widgets?.find((item) => item?.name === "step_preview") ?? null,
    stepsButton, stopButton,
    stepOverlay: mountStepOverlay(stage),
  };
  // Under the tools, so they stay on top of the picture.
  stage.insertBefore(state.stepOverlay.root, tools);
  if (!state.stepsWidget) stepsButton.style.display = "none";
  for (const button of [stopButton, stepsButton]) {
    button.addEventListener("pointerdown", (event) => event.stopPropagation(), { signal: abort.signal });
  }
  stepsButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!state.stepsWidget) return;
    const next = !stepsOn(state);
    state.stepsWidget.value = next;
    state.stepsWidget.callback?.(next);
    syncSteps(state);
    node.setDirtyCanvas?.(true, true);
    notifyAusbossChange();
  }, { signal: abort.signal });
  stopButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    Promise.resolve(stopStepRun()).catch(() => {});
  }, { signal: abort.signal });
  state.forgetSteps = [
    addStepConsumer(node, () => stepsOn(state)),
    watchSteps((run) => syncSteps(state, run)),
  ];
  const updateLoopButton = () => {
    const enabled = getLoopEnabled(node);
    video.loop = enabled;
    loopButton.classList.toggle("active", enabled);
  };
  updateLoopButton();

  loopButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    node.properties.ausboss_save_video_loop = !getLoopEnabled(node);
    updateLoopButton();
    node.setDirtyCanvas?.(true, true);
    notifyAusbossChange();
  });
  video.addEventListener("loadedmetadata", () => {
    setReady(state, mediaInfo(state.meta, video) || state.meta?.filename || "预览就绪");
    node.setDirtyCanvas?.(true, true);
  }, { signal: abort.signal });
  video.addEventListener("error", () => {
    // Only a genuine video failure: clearing src for a gif fires error too.
    if (video.getAttribute("src")) setEmpty(state, "保存的视频预览没能加载");
  }, { signal: abort.signal });
  image.addEventListener("load", () => {
    setReady(state, state.meta?.filename || "预览就绪");
    node.setDirtyCanvas?.(true, true);
  }, { signal: abort.signal });
  image.addEventListener("error", () => {
    if (image.getAttribute("src")) setEmpty(state, "保存的动画预览没能加载");
  }, { signal: abort.signal });

  return state;
}

// Going back to a workflow tab puts its results back in ComfyUI's store,
// but the player only ever filled from onExecuted, so it said "Run to
// preview" over a clip it had just saved. Show the stored one.
function showStoredResult(node) {
  const state = node.__ausbossSaveVideo;
  if (!state || state.meta) return;
  const meta = findVideoMetadata(app.nodeOutputs?.[outputKey(node, app.rootGraph ?? app.graph)]);
  if (meta) loadMetadata(state, meta);
}

app.registerExtension({
  name: "ausboss.save_video.polished",
  onNodeOutputsUpdated() {
    setTimeout(() => {
      for (const node of app.graph?._nodes ?? []) if (node?.comfyClass === NODE_NAME) showStoredResult(node);
    }, 0);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      buildPreview(this);
      // %date:yyyy-MM-dd% and %Node.setting% in the prefix (js/shared/name_tokens.mjs).
      installNameTokens(this, ["filename_prefix"], app);
      // Only for a genuinely new node: onConfigure restores a saved size after
      // this runs, so a workflow's own dimensions still win.
      this.setSize?.([
        Math.max(DEFAULT_NODE_SIZE[0], this.size?.[0] ?? 0),
        Math.max(DEFAULT_NODE_SIZE[1], this.size?.[1] ?? 0),
      ]);
    });
    chainCallback(nodeType.prototype, "onConfigure", function () {
      queueMicrotask(() => {
        const state = buildPreview(this);
        suppressCoreVideoPreview(this);
        if (state) syncSteps(state);
      });
    });
    chainCallback(nodeType.prototype, "onExecuted", function (message) {
      if (isForeignRun()) return;
      const state = buildPreview(this);
      const meta = findVideoMetadata(message);
      // Saved: the file replaces the steps.
      if (state) { state.stepsSaved = stepRun().promptId; syncSteps(state); }
      if (state && meta) loadMetadata(state, meta);
      else if (state) setEmpty(state, "执行已结束，但没有视频元数据");
      app.canvas?.setDirty?.(true, true);
    });
    chainCallback(nodeType.prototype, "onRemoved", function () {
      const state = this.__ausbossSaveVideo;
      state?.video?.pause();
      state?.abort?.abort();
      for (const forget of state?.forgetSteps ?? []) forget();
      this.__ausbossSaveVideo = null;
    });
  },
});
