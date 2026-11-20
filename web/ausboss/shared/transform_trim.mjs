// The video timeline the transform nodes share, on the node face and in the
// editor: one rail with a playhead, and on the clip node the IN/OUT handles
// around it. Frame arithmetic lives in timeline_math.mjs (tested); this
// file is the DOM.
//
// Interaction, in the words of a video editor: press or drag anywhere on
// the rail to scrub the playhead - the stage shows that frame, whatever the
// Length says. Drag an IN or OUT handle to trim; the playhead rides along on
// the handle, so the frame on the stage is the first (IN) or last (OUT)
// frame the run keeps, and stays there on release. The small grip on the
// kept part slides the whole clip (so does IN, while Length is on). IN, OUT
// and the playhead are frames, snapped to the source's own frame grid; the
// seconds the widgets store are derived from them and round-trip exactly.
//
// The clip's length is set one way at a time (clipLengthPlan): by OUT; by a
// Length that keeps OUT a set number of frames after IN; or by a connected
// fixed_frames / frame_load_cap input, which leaves only IN to set. OUT
// always sits on the last frame the run outputs - every nth, the snap rule
// and the Length included - so the handle and the bright bar agree.
import { makeScrubInput } from "./scrub_input.mjs";
import { formatTimecode } from "./timecode.mjs";
import {
  boundaryAtFraction,
  clampFrame,
  lengthFillsClip,
  clipInfo,
  clipLengthPlan,
  formatFps,
  fractionOfFrame,
  frameAtFraction,
  frameTime,
  framesThrough,
  keyboardStep,
  lastFrameFor,
  latestInFor,
  railZone,
  setTrimFrame,
  slideRange,
  snapStep,
  snapToValid,
  windowSeconds,
} from "./timeline_math.mjs";

const CSS_ID = "ausboss-transform-trim-css-v5";
const HANDLE_HIT_PX = 9;
// Connected inputs that set the length themselves, in the backend's order of
// precedence: fixed_frames replaces the window, a cap replaces the Length.
const LENGTH_INPUTS = ["fixed_frames", "frame_load_cap", "max_frames"];
// Connected inputs whose value only the run knows make the count unknowable.
const COUNT_INPUTS = ["start_frame", "end_frame", "start_seconds", "end_seconds", "every_nth", "frame_snap", "force_rate"];

function installCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  style.textContent = `
    .ausboss-transform-trim{flex:none;display:flex;flex-direction:column;gap:8px;min-width:0;padding:9px 10px 8px;border:1px solid #164b49;border-radius:8px;background:#0e1718;color:#cadddb;font:11px system-ui;box-sizing:border-box;overflow:hidden}
    .ausboss-transform-trim-transport{display:flex;align-items:center;gap:6px;min-width:0}
    .ausboss-transform-trim-transport .ausboss-transform-trim-rail{flex:1;min-width:0}
    .ausboss-transform-trim-play{display:grid;place-items:center;flex:none;width:28px;height:24px;padding:0;border:1px solid #325151;border-radius:4px;background:#101819;color:#a6c3c0;cursor:pointer}
    .ausboss-transform-trim-play::before{content:"";width:10px;height:12px;background:currentColor;clip-path:polygon(8% 0,100% 50%,8% 100%)}
    .ausboss-transform-trim-play.is-playing::before{box-sizing:border-box;clip-path:none;background:transparent;border-inline:3px solid currentColor}
    .ausboss-transform-trim-play:focus-visible{outline:1px solid #00b4aa;outline-offset:1px}
    .ausboss-transform-trim-play:hover,.ausboss-transform-trim-play.is-playing{border-color:#00b4aa;color:#e5fffc}
    .ausboss-transform-trim-play:disabled{opacity:.45;cursor:default}
    .ausboss-transform-trim-rail{position:relative;height:28px;margin:0 6px;touch-action:none;cursor:pointer;user-select:none}
    .ausboss-transform-trim-rail.is-disabled{opacity:.45;cursor:default}
    .ausboss-transform-trim-rail:before{content:"";position:absolute;left:0;right:0;top:11px;height:6px;border-radius:4px;background:#293637}
    .ausboss-transform-trim-span{position:absolute;top:11px;height:6px;border-radius:4px;background:rgba(0,180,170,.3);pointer-events:none}
    .ausboss-transform-trim-kept{position:absolute;top:11px;height:6px;border-radius:4px;background:#00b4aa;pointer-events:none}
    .ausboss-transform-trim-handle{position:absolute!important;top:2px;width:12px!important;height:24px;min-width:0;padding:0!important;margin:0!important;transform:translateX(-50%);border:2px solid #00b4aa!important;border-radius:4px!important;background:#e5fffc!important;cursor:ew-resize;touch-action:none;z-index:2}
    .ausboss-transform-trim-handle[hidden]{display:none!important}
    .ausboss-transform-trim-handle:focus-visible{outline:2px solid white;outline-offset:2px}
    .ausboss-transform-trim-grip{position:absolute;top:8px;width:26px;height:12px;margin-left:-13px;box-sizing:border-box;border:1px solid #00b4aa;border-radius:6px;background:#0e1718;cursor:grab;z-index:2;display:flex;align-items:center;justify-content:center;gap:2px;touch-action:none}
    .ausboss-transform-trim-grip[hidden]{display:none}
    .ausboss-transform-trim-grip:hover{background:#163234}
    .ausboss-transform-trim-grip>i{display:block;width:1px;height:6px;background:#9fe3dc;pointer-events:none}
    .ausboss-transform-trim-rail.is-sliding,.ausboss-transform-trim-rail.is-sliding .ausboss-transform-trim-grip{cursor:grabbing}
    .ausboss-transform-trim-playhead{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:#f4fffd;box-shadow:0 0 0 1px rgba(0,0,0,.55);pointer-events:none;z-index:3}
    .ausboss-transform-trim-playhead:before{content:"";position:absolute;top:-1px;left:50%;transform:translateX(-50%);border:5px solid transparent;border-top:6px solid #f4fffd;filter:drop-shadow(0 0 1px rgba(0,0,0,.7))}
    .ausboss-transform-trim-line{display:flex;align-items:center;gap:7px;min-width:0}
    .ausboss-transform-trim-line.wrap{flex-wrap:wrap;row-gap:6px}
    .ausboss-transform-trim-line label{display:flex;align-items:center;gap:5px;white-space:nowrap}
    .ausboss-transform-trim-line .spacer{flex:1 1 0;min-width:0}
    .ausboss-transform-trim-line .ausboss-scrub{width:64px}
    .ausboss-transform-trim-line select{background:#1b2627;color:#e5fffc;border:1px solid #2c4d4b;border-radius:5px;padding:3px 4px;font:11px system-ui;cursor:pointer;flex:none}
    .ausboss-transform-trim-line select:focus-visible{outline:2px solid #00b4aa;outline-offset:1px}
    .ausboss-transform-trim-line .ausboss-scrub-step button{font-size:8px}
    .ausboss-transform-trim-caption{color:#00b4aa;font-weight:650;font-size:10px;letter-spacing:.06em}
    .ausboss-transform-trim-readout{flex:1 1 0;min-width:0;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#8ca8a5;font-variant-numeric:tabular-nums}
    .ausboss-transform-trim-readout b{color:#e5fffc;font-weight:600}
    .ausboss-transform-trim-pill{display:inline-flex;flex:none;height:22px;border:1px solid #2c4d4b;border-radius:5px;overflow:hidden;background:#1b2627}
    .ausboss-transform-trim-pill button{border:0;margin:0;background:transparent;color:#8ca8a5;font:600 10px system-ui;letter-spacing:.04em;padding:0 9px;cursor:pointer}
    .ausboss-transform-trim-pill button:hover{color:#e5fffc}
    .ausboss-transform-trim-pill button.on{background:#00b4aa;color:#04201d}
    .ausboss-transform-trim-pill.is-disabled{opacity:.45}
    .ausboss-transform-trim-pill.is-disabled button{cursor:not-allowed}
    .ausboss-transform-trim-hint{flex:1 1 0;min-width:0;color:#6f8886;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ausboss-transform-trim-hint.note{flex:0 1 auto;max-width:100%;color:#ffc46b}
    .ausboss-transform-trim-summary{flex:1 1 0;min-width:0;color:#8ca8a5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
    .ausboss-transform-trim-reset{flex:none;height:18px;box-sizing:border-box;border:1px solid #2c4d4b;border-radius:4px;background:#1b2627;color:#cadddb;font:600 10px/16px system-ui;cursor:pointer;padding:0 8px;white-space:nowrap}
    .ausboss-transform-trim-reset:hover{border-color:#8fa3a1;color:#fff}
    .ausboss-transform-trim-reset:disabled{opacity:.45;cursor:not-allowed}
    .ausboss-transform-trim-span.is-room{background:repeating-linear-gradient(90deg,rgba(0,180,170,.38) 0 6px,rgba(0,180,170,.1) 6px 12px)}
    .ausboss-transform-trim-line .ausboss-transform-trim-readout{text-align:left}
    .ausboss-transform-trim-inside{color:#45d6cb}
    .ausboss-transform-trim-outside{color:#8ca8a5}
    .ausboss-transform-trim-clip{flex:1 1 0;min-width:0;color:#45d6cb;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
    .ausboss-transform-trim-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;min-width:0}
    .ausboss-transform-trim-field{display:flex;flex-direction:column;gap:3px;min-width:0}
    .ausboss-transform-trim-field .ausboss-scrub{width:100%;box-sizing:border-box}
    .ausboss-transform-trim-field-label{color:#cadddb;display:flex;align-items:center;gap:6px;min-width:0}
    .ausboss-transform-trim-go[hidden]{display:none}
    .ausboss-transform-trim-sub{color:#8ca8a5;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;min-height:12px}
    .ausboss-transform-trim-link{color:#9fe3dc;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ausboss-transform-trim-link[hidden]{display:none}
    .ausboss-transform-trim-go{border:0;background:transparent;padding:0;color:#45d6cb;font:600 10px system-ui;text-decoration:underline;cursor:pointer}
    .ausboss-transform-trim-note{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:#9fe3dc;font-size:11px;line-height:1.35}
    .ausboss-transform-trim-note[hidden]{display:none}
    .ausboss-transform-trim-note>span{flex:1 1 180px;min-width:0}
    .ausboss-transform-trim-note.warn{background:#3a2a10;box-shadow:inset 3px 0 0 #e0a040;border-radius:6px;padding:6px 8px;color:#ffdca8}
    .ausboss-transform-trim-note button[hidden]{display:none}
  `;
  document.head.append(style);
}

function el(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text) item.textContent = text;
  return item;
}

const pct = (fraction) => `${(fraction * 100).toFixed(3)}%`;
// Seconds for people: at most two decimals (1, 1.5, 2.17).
const secondsText = (value) => String(Number((Number(value) || 0).toFixed(2)));

// options:
//   get(name, fallback) / set(name, value)  widget access
//   has(name)                                whether a widget exists
//   driven(name)                             whether an input is linked
//   number(name, fallback)                   a linked literal's value, null
//                                            when only the run knows it
//   outputRate()                             output fps, null when unknown
//   metadata()                               the source's {fps, frame_count, duration}
//   trim                                     IN/OUT handles and the length rows
//                                            (the clip node) or playhead only
//   onSeek(frame, settled)                   the playhead moved; settled on release
//   onCommit()                               a stored value settled (undo point)
//   linkInfo(name)                           {title, go()} of the node feeding
//                                            a linked input, or null
//   publish(timing)                          the clip's {frames, startSeconds,
//                                            endSeconds, roomFrames}, or null
//   units() / setUnits(units)                "s" (seconds) or "f" (frames)
export function mountTransformTrim({ get, set, has = () => true, driven = () => false, number = (name, fallback) => get(name, fallback), outputRate, metadata, trim = true, isPlaying, onTogglePlayback, onSeek, onCommit, linkInfo = () => null, publish, units: getUnits = () => "s", setUnits = () => {}, play: showPlay = true }) {
  installCss();
  const root = el("div", "ausboss-transform-trim");
  const rail = el("div", "ausboss-transform-trim-rail");
  const span = el("div", "ausboss-transform-trim-span");
  const kept = el("div", "ausboss-transform-trim-kept");
  const playhead = el("div", "ausboss-transform-trim-playhead");
  const grip = el("div", "ausboss-transform-trim-grip");
  grip.append(el("i"), el("i"), el("i"));
  grip.hidden = true;
  const handles = {};
  if (trim) rail.append(span, kept, grip);
  rail.append(playhead);

  const transport = el("div", "ausboss-transform-trim-transport");
  const play = el("button", "ausboss-transform-trim-play");
  play.type = "button";
  play.addEventListener("click", onTogglePlayback);
  // A host with its own player (Load Video) leaves out the Play button.
  if (showPlay) transport.append(play);
  transport.append(rail);
  const info = () => clipInfo(metadata());
  const everyNth = () => Math.max(1, Math.trunc(Number(number("every_nth", get("every_nth", 1))) || 1));
  const snapRule = () => String(get("frame_snap", "free"));
  const wiredBy = () => LENGTH_INPUTS.find((name) => driven(name)) ?? null;
  // Seconds the run starts and ends at, a connected frame bound included.
  const boundSeconds = (edge) => {
    const clip = info();
    if (driven(`${edge}_frame`)) {
      const frame = number(`${edge}_frame`, null);
      if (frame != null && clip.fps > 0) return Math.max(0, frame) / clip.fps;
    }
    const name = `${edge}_seconds`;
    return number(name, get(name, 0)) ?? get(name, 0);
  };
  const countAtRunTime = () => COUNT_INPUTS.some((name) => driven(name) && number(name, null) == null);
  const outFps = () => (outputRate ? outputRate() : info().fps / everyNth());
  const planValues = () => {
    const wired = wiredBy();
    return {
      start: boundSeconds("start"),
      end: boundSeconds("end"),
      everyNth: everyNth(),
      frameSnap: snapRule(),
      maxFrames: get("max_frames", 0),
      fixedFrames: driven("fixed_frames") ? 0 : get("fixed_frames", 0),
      wired,
      wiredFrames: wired ? number(wired, null) : null,
      outputFps: outputRate ? outputRate() : info().fps,
      resampled: driven("force_rate"),
    };
  };
  const plan = () => (trim ? clipLengthPlan(info(), planValues()) : null);
  // Output frames that fit between IN and the end of the video: the most a
  // Duration can be from here.
  const roomFrames = () => {
    if (!trim) return null;
    const room = clipLengthPlan(info(), { ...planValues(), maxFrames: 0, fixedFrames: 0, wired: null, wiredFrames: null });
    return room.frames ?? null;
  };
  // Where the clip ends, in source seconds (exclusive), when it is known.
  const endSecondsOf = (current) => {
    const clip = info();
    if (current?.endSeconds != null) return current.endSeconds;
    if (current?.last == null || !clip.fps) return null;
    return (current.last + 1) / clip.fps;
  };
  const endDriven = () => driven("end_frame") || driven("end_seconds");
  // The latest IN that keeps the whole Duration. With a connected rate the
  // count is in output frames, so the source grid would stop IN far too soon
  // (the 2.25 face stopped a 240-frame Length at IN 7 on a 247-frame clip).
  const latestIn = (current) => {
    const clip = info();
    if (driven("force_rate")) {
      if (current.latestStart == null) return clip.count - 1;
      return current.latestStart > 0 ? current.latestStart : clip.count - 1;
    }
    return latestInFor(clip, current.requested ?? get("max_frames", 1), everyNth());
  };
  // A Duration as long as the whole video only caps it: IN moves freely and
  // the clip runs to the end.
  const durationFills = (current) => {
    if (current.mode !== "length" || current.requested == null) return false;
    const whole = roomFromStart();
    return whole != null && current.requested >= whole;
  };
  const roomFromStart = () => {
    if (!trim) return null;
    const room = clipLengthPlan(info(), { ...planValues(), start: 0, maxFrames: 0, fixedFrames: 0, wired: null, wiredFrames: null });
    return room.frames ?? null;
  };
  const currentWindow = () => {
    const clip = info();
    if (!trim) return { first: 0, last: Math.max(0, clip.count - 1) };
    const current = plan();
    return { first: current.first, last: current.last ?? current.windowLast };
  };
  const playheadFrame = () => clampFrame(get("frame_index", 0), info());
  const controls = {};
  // A short line under the fields after a drag stops at the video's end.
  let stopNote = "";
  // IN is locked by a connected bound; OUT by a connected bound in free
  // trim, and always when a connected input sets the length.
  const locked = (edge) => {
    if (edge === "start") return driven("start_frame") || driven("start_seconds");
    const mode = plan()?.mode;
    if (mode === "wired") return true;
    if (mode === "free") return driven("end_frame") || driven("end_seconds");
    return false;
  };
  const lockTip = (edge) => edge === "start"
    ? "起始帧由已连接的输入提供。断开它才能在这里设起点。"
    : wiredBy()
      ? `已连接的 ${wiredBy()}输入定长度，片段在它说的位置结束。断开它才能设 Duration 或 Ends at。`
      : "结束帧由已连接的输入提供。断开它才能在这里设置 Ends at。";
  const disableControl = (control, disabled, tip) => {
    if (!control) return;
    control.root.style.opacity = disabled ? ".45" : "";
    control.root.inert = disabled;
    control.root.parentElement.title = disabled ? tip : "";
  };

  const seek = (frame, settled) => {
    onSeek?.(clampFrame(frame, info()), settled);
    sync();
  };
  const writeStart = (first) => {
    if (!locked("start")) set("start_seconds", windowSeconds(info(), first, first).start_seconds);
  };
  const writeEnd = (first, last) => set("end_seconds", windowSeconds(info(), first, last).end_seconds);
  // An older face's Fixed frames reads as a Length; the first edit makes it
  // one, keeping the window where the fixed count had placed it.
  // The face has no modes: a clip is a Start and a Duration. A window saved
  // as IN -> OUT (Length off) becomes a Duration of the same frames on its
  // first edit, so the run outputs exactly what it did. A connected end
  // keeps the window as it is.
  const adoptLength = (current) => {
    if (current.mode === "free" && !endDriven() && current.frames != null) {
      set("max_frames", Math.max(1, current.frames));
      set("end_seconds", 0);
      return plan();
    }
    if (current.mode !== "fixed") return current;
    set("fixed_frames", 0);
    set("max_frames", Math.max(1, current.requested ?? current.frames ?? 1));
    set("end_seconds", 0);
    writeStart(current.first);
    return plan();
  };
  // A trim edge moved: store it and park the playhead on that edge's frame,
  // so the stage shows the first or last frame the run keeps.
  const moveEdge = (edge, frame, settled) => {
    if (!trim || locked(edge)) return;
    const clip = info();
    const current = adoptLength(plan());
    const nth = everyNth();
    let parked;
    if (edge === "start") {
      if (current.mode === "length") {
        // A Duration drags the whole clip, stopping where its end meets the
        // video's end; a Duration past the video's end only caps it, so IN
        // moves freely.
        const latest = latestIn(current);
        parked = Math.max(0, Math.min(clampFrame(frame, clip), latest));
        stopNote = clampFrame(frame, clip) > latest
          ? `起点最晚停在 ${secondsText(parked / clip.fps)} 秒，好让全部 ${current.requested} 帧都能放下。`
          : "";
        set("end_seconds", 0);
      } else if (current.mode === "wired" && current.latestStart != null && !countAtRunTime()) {
        parked = Math.min(clampFrame(frame, clip), current.latestStart);
      } else {
        parked = setTrimFrame({ first: current.first, last: current.windowLast }, "start", frame, clip).first;
      }
      writeStart(parked);
    } else {
      const target = Math.max(current.first, clampFrame(frame, clip));
      stopNote = "";
      let frames = framesThrough(current.first, target, nth, snapRule());
      if (driven("force_rate") && outFps() > 0) {
        // Output frames at the linked rate from IN to the handle's boundary.
        frames = snapToValid(Math.max(1, Math.round(((target + 1) / clip.fps - boundSeconds("start")) * outFps())), snapRule());
        const room = roomFrames();
        if (room != null) frames = Math.min(frames, Math.max(1, room));
      }
      if (current.mode === "length") {
        set("max_frames", frames);
        set("end_seconds", 0);
        parked = plan()?.last ?? Math.min(clip.count - 1, lastFrameFor(current.first, frames, nth));
      } else {
        parked = driven("force_rate") ? target : lastFrameFor(current.first, frames, nth);
        writeEnd(current.first, parked);
      }
    }
    seek(parked, settled);
    if (settled) onCommit?.();
  };
  // The grip slides the kept part: a Length moves with IN (OUT follows), a
  // free window keeps its span and both edges move.
  const canSlide = () => {
    // With a connected rate, IN itself slides the clip at its Duration.
    if (!trim || locked("start") || driven("force_rate")) return false;
    const current = plan();
    if (!current || !["length", "fixed", "free"].includes(current.mode)) return false;
    if (current.mode === "free" && locked("end")) return false;
    const range = slideRange(info(), current, everyNth());
    return range.max > range.min;
  };
  const slideTo = (target, settled) => {
    const clip = info();
    const current = plan();
    const range = slideRange(clip, current, everyNth());
    const first = Math.max(range.min, Math.min(range.max, Math.round(target)));
    if (current.mode === "free") {
      const spanFrames = current.windowLast - current.first;
      writeStart(first);
      writeEnd(first, Math.min(clip.count - 1, first + spanFrames));
      seek(first, settled);
      if (settled) onCommit?.();
      return;
    }
    moveEdge("start", first, settled);
  };
  const readout = el("span", "ausboss-transform-trim-readout");
  const summary = el("div", "ausboss-transform-trim-summary");

  const sync = () => {
    const clip = info();
    const playing = isPlaying();
    play.setAttribute("aria-label", playing ? "Pause" : "Play");
    play.title = playing ? "停在这一帧" : trim ? "从片段开头播放" : "播放视频挑一帧";
    play.classList.toggle("is-playing", playing);
    play.disabled = !clip.count;
    const head = playheadFrame();
    rail.classList.toggle("is-disabled", !clip.count);
    playhead.style.left = pct(fractionOfFrame(head, clip, "center"));
    playhead.style.visibility = clip.count ? "" : "hidden";
    readout.replaceChildren();
    const current = trim ? plan() : null;
    if (clip.count) {
      readout.append(document.createTextNode("Preview "), el("b", "", `${secondsText(frameTime(head, clip))} s`), document.createTextNode(` · 源帧 ${head}`));
      if (trim) {
        const end = countAtRunTime() ? null : current.last;
        const inside = head >= current.first && (end == null || head <= end);
        readout.append(el("span", inside ? "ausboss-transform-trim-inside" : "ausboss-transform-trim-outside", inside ? " · 在片段内" : " · 片段之外"));
      }
      readout.title = `画面显示第 ${head} of ${clip.count}, ${frameTime(head, clip).toFixed(2)} 秒处。按或拖动条可看别的帧${trim ? "；点「Use as start」就从这里开始剪。" : "；这就是这个节点输出的帧。"}`;
    }
    controls.frame?.set(head);
    if (!trim) return;
    const wired = wiredBy();
    const unknown = countAtRunTime();
    const hasOut = current.last != null && current.mode !== "wired" && !unknown;
    const outFrame = current.last ?? current.windowLast;
    const startFraction = fractionOfFrame(current.first, clip, "start");
    const endSec = endSecondsOf(current);
    const endFraction = endSec != null && !unknown
      ? Math.max(startFraction, Math.min(1, endSec * clip.fps / clip.count))
      : fractionOfFrame(outFrame, clip, "end");
    // Dim: frames the free window holds but the run drops (every nth, snap).
    const tailFraction = current.mode === "free" ? fractionOfFrame(current.windowLast, clip, "end") : endFraction;
    span.style.left = pct(startFraction);
    span.classList.toggle("is-room", unknown || current.last == null);
    // A length only the run knows: the dim part is the room the clip has.
    span.style.width = pct(unknown || current.last == null ? 1 - startFraction : Math.max(0, tailFraction - startFraction));
    kept.style.left = pct(startFraction);
    kept.style.width = current.last == null || unknown ? "0%" : pct(Math.max(0, endFraction - startFraction));
    span.title = unknown || current.last == null ? "片段的位置：长度要等运行工作流时才定。" : "";
    const railWidth = rail.getBoundingClientRect().width || 0;
    const keptWidth = Math.max(0, endFraction - startFraction) * railWidth;
    grip.hidden = !canSlide() || unknown || (railWidth > 0 && keptWidth < 34);
    grip.style.left = pct((startFraction + endFraction) / 2);
    grip.title = "拖动来滑动片段，Duration 不变。";
    for (const edge of ["start", "end"]) {
      const handle = handles[edge];
      const frame = edge === "start" ? current.first : outFrame;
      const isLocked = locked(edge);
      handle.hidden = edge === "end" && !hasOut;
      handle.style.left = pct(edge === "start" ? startFraction : endFraction);
      handle.disabled = !clip.count;
      handle.setAttribute("aria-disabled", String(isLocked || !clip.count));
      handle.style.opacity = isLocked ? ".35" : "";
      handle.style.cursor = isLocked ? "not-allowed" : "";
      handle.title = isLocked ? lockTip(edge)
        : edge === "start"
          ? durationFills(current) ? "往后拖可以更晚开始。时长比视频还长，所以片段会一直跑到视频末尾。"
            : "拖动可移动片段，时长不变。Shift + 方向键一次移一帧。"
          : "拖动改时长，起点不动。";
      handle.setAttribute("aria-valuemin", "0");
      const maxFrame = edge === "start" && current.mode === "wired" && !unknown
        ? current.latestStart ?? current.windowLast : Math.max(0, clip.count - 1);
      handle.setAttribute("aria-valuemax", String(maxFrame));
      handle.setAttribute("aria-valuenow", String(frame));
      handle.setAttribute("aria-valuetext", `frame ${frame}, ${formatTimecode(frameTime(frame, clip))}`);
    }
    if (useStart) {
      useStart.disabled = !clip.count || locked("start");
      useStart.title = locked("start") ? lockTip("start") : "把片段的开头设在舞台上的这一帧。Duration 不变。";
    }
    if (clip.count) syncFields(clip, current, wired, unknown);
    if (controls.reset) {
      const free = current.mode !== "wired";
      controls.reset.textContent = free ? "整段" : "到开头";
      controls.reset.title = free ? `用整段视频：从 0 开始，不限 Duration。保留「每 N 帧」${has("frame_snap") ? " 和「帧用于」" : ""}.` : "把起点移到视频开头；关联的长度不变。";
      controls.reset.disabled = locked("start") && !free;
    }
    controls.every_nth?.set(get("every_nth", 1));
    disableControl(controls.every_nth, driven("every_nth"), "「每 N 帧」由已连接的输入提供。");
    if (controls.frame_snap) {
      controls.frame_snap.value = snapRule();
      const exact = current.mode === "fixed" || (current.mode === "wired" && wired === "fixed_frames");
      controls.frame_snap.disabled = exact || driven("frame_snap");
      controls.frame_snap.title = exact ? "已按精确的 fixed_frames 数量使用，这项不生效。" : "保持视频模型认的帧数：LTX 要 8n+1（49、97、121），Wan 要 4n+1。时长会按这些帧数跳。Any 保留每一帧。";
    }
    syncSummary(clip);
  };

  const syncSummary = (clip) => {
    if (!clip.count) {
      summary.textContent = "选个来源才能定片段";
      summary.title = "";
      return;
    }
    const rate = outputRate?.();
    summary.textContent = `Source ${formatFps(clip.fps)} fps · ${clip.count} 帧 · 结束于 ${secondsText(clip.duration || clip.count / clip.fps)} 秒 · 片段输出 ${rate == null ? "运行时设定的帧率" : `${formatFps(rate)} fps`}`;
    summary.title = "Start 和 Ends at 是源视频里的位置。Duration 数的是片段按输出帧率送出去的帧。";
    if (trim) rail.title = [clipLine?.textContent, summary.textContent, readout.textContent].filter(Boolean).join("\n");
  };

  // --- rail gestures --------------------------------------------------------
  const hit = (event) => {
    const box = rail.getBoundingClientRect();
    const width = Math.max(1, box.width);
    const x = Math.max(0, Math.min(width, event.clientX - box.left));
    const fraction = x / width;
    if (!trim) return { fraction, zone: "playhead" };
    if (event.target === handles.start) return { fraction, zone: "start" };
    if (event.target === handles.end && !handles.end.hidden) return { fraction, zone: "end" };
    const clip = info();
    const window = currentWindow();
    // Screen pixels, so the zone keeps its size whatever the graph zoom.
    const zone = railZone({
      x,
      inX: fractionOfFrame(window.first, clip, "start") * width,
      outX: fractionOfFrame(window.last, clip, "end") * width,
      hasOut: !handles.end.hidden,
      hitPx: HANDLE_HIT_PX,
      onGrip: !grip.hidden && grip.contains(event.target),
    });
    return { fraction, zone };
  };
  const applyPointer = (zone, fraction, settled, gesture = drag) => {
    const clip = info();
    if (zone === "playhead") { seek(frameAtFraction(fraction, clip), settled); return; }
    if (zone === "grip") {
      if (gesture) slideTo(gesture.first + Math.round((fraction - gesture.origin) * clip.count), settled);
      return;
    }
    moveEdge(zone, boundaryAtFraction(fraction, clip) - (zone === "end" ? 1 : 0), settled);
  };
  let drag = null;
  rail.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !info().count) return;
    event.preventDefault(); event.stopPropagation();
    const { fraction, zone } = hit(event);
    if (zone !== "playhead" && zone !== "window" && locked(zone)) return;
    drag = { zone, fraction, origin: fraction, first: currentWindow().first, pointerId: event.pointerId };
    rail.classList.toggle("is-sliding", zone === "grip");
    try { rail.setPointerCapture(event.pointerId); } catch { /* mouse fallback */ }
    applyPointer(zone, fraction, false);
  });
  rail.addEventListener("pointermove", (event) => {
    if (!drag) {
      const { zone } = info().count ? hit(event) : { zone: "playhead" };
      rail.style.cursor = zone === "playhead" ? "pointer" : zone === "grip" ? "grab" : locked(zone) ? "not-allowed" : "ew-resize";
      return;
    }
    event.preventDefault(); event.stopPropagation();
    drag.fraction = hit(event).fraction;
    applyPointer(drag.zone, drag.fraction, false);
  });
  const finish = (event) => {
    if (!drag) return;
    const gesture = drag;
    const { zone, fraction, pointerId } = gesture;
    drag = null;
    rail.classList.remove("is-sliding");
    try { if (rail.hasPointerCapture(pointerId)) rail.releasePointerCapture(pointerId); } catch { /* released already */ }
    if (event?.type === "pointerup") event.stopPropagation();
    applyPointer(zone, fraction, true, gesture);
  };
  rail.addEventListener("pointerup", finish);
  rail.addEventListener("pointercancel", finish);
  rail.addEventListener("lostpointercapture", () => finish(null));

  // --- trim handles ---------------------------------------------------------
  if (trim) {
    for (const edge of ["start", "end"]) {
      const handle = el("button", "ausboss-transform-trim-handle");
      handle.type = "button";
      handle.setAttribute("role", "slider");
      handle.setAttribute("aria-label", edge === "start" ? "片段 IN" : "片段 OUT");
      handle.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const clip = info();
        if (!clip.count || locked(edge)) return;
        const direction = event.key === "ArrowLeft" || event.key === "Home" ? -1 : 1;
        const window = currentWindow();
        if (edge === "start") {
          const target = event.key === "Home" ? 0 : event.key === "End" ? clip.count - 1 : window.first + keyboardStep(clip, event.shiftKey) * direction;
          moveEdge("start", target, true);
          return;
        }
        // OUT steps by output frames, to the next count the snap rule keeps.
        const current = plan();
        const nth = everyNth();
        const frames = current.frames ?? framesThrough(window.first, window.last, nth, snapRule());
        const step = Math.max(1, Math.round(keyboardStep(clip, event.shiftKey) / nth));
        const next = event.key === "Home" ? 1 : event.key === "End" ? framesThrough(window.first, clip.count - 1, nth, snapRule()) : snapToValid(frames + step * direction, snapRule(), direction);
        moveEdge("end", lastFrameFor(window.first, next, nth), true);
      });
      handles[edge] = handle;
      rail.append(handle);
    }
  }

  // --- rows -----------------------------------------------------------------
  // The clip node: Preview (the playhead, and Use as start), the clip in
  // words with a Seconds | Frames switch, then Start, Duration and Ends at.
  // Start and Ends at are positions in the source video; Duration counts the
  // frames the clip sends on, at the output rate. No modes: dragging IN
  // slides the clip, dragging OUT or typing a Duration or an end changes the
  // Duration.
  const previewRow = el("div", "ausboss-transform-trim-line");
  let useStart = null;
  if (trim) {
    useStart = el("button", "ausboss-transform-trim-reset", "用作起点");
    useStart.type = "button";
    useStart.title = "让片段从画布上这一帧开始。时长不变。";
    useStart.addEventListener("click", () => moveEdge("start", playheadFrame(), true));
  } else {
    const label = el("label");
    label.append(el("span", "ausboss-transform-trim-caption", "FRAME"));
    controls.frame = makeScrubInput({
      value: 0, min: 0, max: 10000000, step: 1, decimals: 0,
      title: "这个节点输出的帧（frame_index）。",
      onChange: (frame) => seek(frame, false),
      onSettle: () => seek(playheadFrame(), true),
    });
    label.append(controls.frame.root);
    previewRow.append(label, readout);
  }
  root.append(transport);
  if (!trim) root.append(previewRow);

  const fields = {};
  let clipLine = null;
  let unitPill = null;
  let noteRow = null;
  let noteText = null;
  const noteButtons = [];
  if (trim) {
    const clipRow = el("div", "ausboss-transform-trim-line");
    clipLine = el("span", "ausboss-transform-trim-clip");
    unitPill = el("div", "ausboss-transform-trim-pill");
    for (const [key, words, tip] of [["s", "s", "时间按秒显示。"], ["f", "fr", "时间按帧显示：Start 和 Ends at 用源帧，Duration 用片段帧。"]]) {
      const button = el("button", "", words);
      button.type = "button";
      button.dataset.units = key;
      button.title = tip;
      button.addEventListener("click", () => { setUnits(key); sync(); });
      unitPill.append(button);
    }

    const grid = el("div", "ausboss-transform-trim-fields");
    const toFrames = {
      start: (value) => (getUnits() === "f" ? Math.round(value) : Math.round(value * info().fps)),
    };
    // Output frames for a Duration typed in the current units.
    const durationFrames = (value) => {
      if (getUnits() === "f") return Math.round(value);
      const rate = outFps();
      return rate > 0 ? Math.round(value * rate) : null;
    };
    // Output frames from IN to an end typed in the current units.
    const framesToEnd = (value) => {
      const clip = info();
      const current = plan();
      const end = getUnits() === "f" ? (Math.round(value) + 1) / clip.fps : value;
      if (driven("force_rate")) {
        const rate = outFps();
        return rate > 0 ? Math.round((end - boundSeconds("start")) * rate) : null;
      }
      return framesThrough(current.first, Math.ceil(end * clip.fps - 1e-7) - 1, everyNth(), snapRule());
    };
    const setDuration = (frames) => {
      if (frames == null || !Number.isFinite(frames)) return;
      const current = adoptLength(plan());
      if (current.mode !== "length") return;
      const was = current.requested ?? get("max_frames", 1);
      set("max_frames", snapToValid(Math.max(1, frames), snapRule(), Math.sign(frames - was)));
      set("end_seconds", 0);
      stopNote = "";
    };
    const defs = [
      ["start", "Start", "片段在源视频里的起点。"],
      ["duration", "Duration", "片段有多长。按输出帧率以片段帧计算。"],
      ["end", "结束于", "片段在源视频里结束的位置。改这里会同时改 Duration。"],
    ];
    for (const [key, caption, tip] of defs) {
      const cell = el("div", "ausboss-transform-trim-field");
      const label = el("span", "ausboss-transform-trim-field-label", caption);
      const go = el("button", "ausboss-transform-trim-go", "linked");
      go.type = "button";
      label.append(go);
      const control = makeScrubInput({
        value: 0, min: 0, max: 10000000, step: 1, decimals: 2, minDecimals: 0, unit: "s", unitWidth: 34,
        title: tip,
        onChange: (value) => {
          if (key === "start") {
            if (locked("start")) return;
            // A typed start is kept even when the Duration no longer fits;
            // the note below says what fits and offers both fixes.
            adoptLength(plan());
            const frame = clampFrame(toFrames.start(value), info());
            writeStart(frame);
            stopNote = "";
            seek(frame, false);
            return;
          }
          if (key === "duration") setDuration(durationFrames(value));
          else setDuration(framesToEnd(value));
          sync();
        },
        onSettle: () => { const window = currentWindow(); seek(key === "start" ? window.first : window.last, true); onCommit?.(); },
      });
      cell.append(label, control.root);
      grid.append(cell);
      fields[key] = { control, go, cell, label };
    }

    noteRow = el("div", "ausboss-transform-trim-note");
    noteText = el("span");
    noteRow.append(noteText);
    for (let index = 0; index < 2; index++) {
      const button = el("button", "ausboss-transform-trim-reset");
      button.type = "button";
      noteButtons.push(button);
      noteRow.append(button);
    }
    root.append(grid, noteRow);
  }

  // One field's look: its value in the current units, the line under it,
  // and, when another node sets it, that node's name and a Go to button.
  const showField = (key, { value, unit, decimals, sub, lockedBy, readOnly, placeholder = "" }) => {
    const field = fields[key];
    if (!field) return;
    field.control.setRange({ decimals, minDecimals: 0, step: decimals ? 0.1 : 1, fineStep: decimals ? 0.01 : 1 });
    field.control.set(value);
    if (value == null) field.control.input.value = "";
    field.control.input.placeholder = placeholder;
    const unitSlot = field.control.root.querySelector(".ausboss-scrub-unit");
    if (unitSlot) unitSlot.textContent = unit;
    const tip = lockedBy ? `由 ${lockedBy.title}: ${sub}。点击「linked」跳到该节点。` : sub;
    disableControl(field.control, readOnly, tip);
    field.cell.title = tip;
    field.go.hidden = !lockedBy;
    if (lockedBy) {
      field.go.title = `由 ${lockedBy.title}。点它就到那个节点。`;
      field.go.onclick = () => lockedBy.go?.();
    }
  };
  const showNote = (text, kind = "", actions = []) => {
    if (!noteRow) return;
    noteRow.hidden = !text;
    noteRow.classList.toggle("warn", kind === "warn");
    noteText.textContent = text;
    noteButtons.forEach((button, index) => {
      const action = actions[index];
      button.hidden = !action;
      if (action) { button.textContent = action.label; button.onclick = () => { action.run(); sync(); onCommit?.(); }; }
    });
  };

  const syncFields = (clip, current, wired, unknown) => {
    const seconds = getUnits() !== "f";
    for (const button of unitPill.children) button.classList.toggle("on", button.dataset.units === (seconds ? "s" : "f"));
    const rate = outFps();
    const rateText = rate > 0 ? `${formatFps(rate)} fps` : "输出帧率";
    const first = current.first;
    const endSec = unknown ? null : endSecondsOf(current);
    const frames = unknown ? null : current.frames;
    const startLink = locked("start") ? linkInfo(driven("start_frame") ? "start_frame" : "start_seconds") : null;
    const lengthLink = current.mode === "wired" && wired ? linkInfo(wired) : null;
    const endLink = endDriven() && current.mode === "free" ? linkInfo(driven("end_frame") ? "end_frame" : "end_seconds") : null;
    const room = roomFrames();
    const fills = durationFills(current);

    showField("start", {
      value: seconds ? frameTime(first, clip) : first,
      unit: seconds ? "s" : "fr", decimals: seconds ? 2 : 0,
      sub: seconds ? `源帧 ${first}` : `源帧 · ${secondsText(frameTime(first, clip))} s`,
      lockedBy: startLink, readOnly: locked("start"),
    });

    // Duration: what was asked for (a Duration longer than what is left
    // only caps the clip), in clip frames or seconds at the output rate.
    const asked = current.mode === "wired" ? current.requested ?? current.frames : current.mode === "length" ? current.requested : frames;
    let durationSub;
    if (current.mode === "wired" && current.frames == null && current.requested == null) {
      durationSub = room != null && rate > 0 ? `最多 ${secondsText(room / rate)} s (${room} 帧）从起点起还放得下` : "运行工作流时确定";
    } else if (current.mode === "wired" && wired !== "fixed_frames" && current.truncated) {
      durationSub = `视频先到头： ${frames} frames${rate > 0 ? ` (${secondsText(frames / rate)} s)` : ""}`;
    } else if (current.mode === "wired") {
      durationSub = wired === "fixed_frames" ? `${asked} 个片段帧（必需）` : `最多 ${asked} 个片段帧`;
    } else if (frames == null) {
      durationSub = "帧数到运行时才知道";
    } else if (current.truncated) {
      durationSub = `视频先结束： ${frames} frames${rate > 0 ? ` (${secondsText(frames / rate)} s)` : ""}`;
    } else {
      durationSub = seconds ? `${frames} 个片段帧，帧率 ${rateText}` : rate > 0 ? ` 个片段帧 · ${secondsText(frames / rate)} s at ${rateText}` : "秒数到运行时才知道";
    }
    const durationInSeconds = seconds && rate > 0;
    showField("duration", {
      value: asked == null ? null : durationInSeconds ? asked / rate : asked,
      unit: durationInSeconds ? "s" : "fr", decimals: durationInSeconds ? 2 : 0,
      sub: durationSub, lockedBy: lengthLink,
      readOnly: current.mode === "wired" || Boolean(endLink) || asked == null,
      placeholder: current.mode === "wired" && asked == null ? "运行时" : "",
    });

    const lastSource = endSec == null ? null : Math.min(clip.count - 1, Math.max(first, Math.ceil(endSec * clip.fps - 1e-7) - 1));
    showField("end", {
      value: endSec == null ? null : seconds ? endSec : lastSource,
      unit: seconds ? "s" : "fr", decimals: seconds ? 2 : 0,
      sub: endSec == null ? "运行后才知道" : seconds ? `最后一个源帧 ${lastSource}` : `源视频末帧 · ${secondsText(endSec)} s`,
      lockedBy: endLink, readOnly: current.mode === "wired" || Boolean(endLink) || endSec == null,
      placeholder: endSec == null ? "运行后" : "",
    });

    // The clip in words.
    if (endSec == null) {
      clipLine.textContent = `片段从 ${seconds ? `${secondsText(frameTime(first, clip))} s` : `源帧 ${first}`} · 长度到运行时才定`;
    } else {
      const span = seconds
        ? `Clip ${secondsText(frameTime(first, clip))} → ${secondsText(endSec)} s`
        : `片段源帧 ${first} → ${lastSource}`;
      clipLine.textContent = `${span} · ${frames} 帧输出`;
    }

    // What needs saying: a start that leaves too little video, a linked
    // exact count that does not fit, or a drag that stopped at the end.
    const latest = current.mode === "length" ? latestIn(current) : current.latestStart;
    if (current.mode === "wired" && wired === "fixed_frames" && current.tooLong) {
      showNote(`Needs ${asked} 帧；视频更短。`, "warn");
    } else if (current.mode === "wired" && wired === "fixed_frames" && latest != null && first > latest && !unknown) {
      showNote(`Needs ${asked} 帧；这里只放得下 ${room ?? "fewer"} 帧放得下。这次运行会失败。`, "warn",
        locked("start") ? [] : [{ label: `把起点移到 ${secondsText(latest / clip.fps)} s`, run: () => writeStart(latest) }]);
    } else if (current.mode === "length" && current.truncated && !fills) {
      const actions = [{ label: `缩短到 ${rate > 0 ? `${secondsText(frames / rate)} s` : `${frames} frames`}`, run: () => { set("max_frames", Math.max(1, frames)); set("end_seconds", 0); } }];
      if (!locked("start") && latest != null && latest < first) actions.push({ label: `起点移到 ${secondsText(latest / clip.fps)} s`, run: () => writeStart(latest) });
      showNote(`Only ${frames} of ${current.requested} 帧放得下。`, "warn", actions);
    } else if (current.mode === "wired" && wired !== "fixed_frames" && current.truncated && frames != null) {
      showNote(`视频先结束了：${frames} of ${asked} 帧。`);
    } else if (current.mode === "length" && fills && current.truncated) {
      showNote("一直跑到视频结尾。");
    } else if (stopNote) {
      showNote(stopNote);
    } else {
      showNote("");
    }

    publish?.(endSec == null || frames == null ? null : { frames, startSeconds: frameTime(first, clip), endSeconds: endSec, roomFrames: room });
  };

  if (trim) {
    const sampling = el("div", "ausboss-transform-trim-line wrap");
    const nthLabel = el("label", "", "每 N 帧");
    controls.every_nth = makeScrubInput({ value: get("every_nth", 1), min: 1, max: 512, step: 1, decimals: 0,
      title: "每这么多帧保留一帧。输出帧率会调整以保持实时播放；时长按保留的帧数算。",
      onChange: (next) => { if (!driven("every_nth")) set("every_nth", next); sync(); }, onSettle: onCommit,
    });
    nthLabel.append(controls.every_nth.root);
    sampling.append(nthLabel, el("span", "spacer"));
    if (has("frame_snap")) {
      // Video models keep 8n+1 (LTX) or 4n+1 (Wan) frames and drop the
      // rest; snapping here keeps the clip, its audio, and its stitcher the
      // same length as what comes back from the sampler.
      const label = el("label", "", "帧用于");
      label.style.marginLeft = "auto";
      const select = el("select");
      // The stored values stay free / 8n+1 / 4n+1; only the words change.
      for (const [rule, words] of [["free", "any"], ["8n+1", "LTX (8n+1)"], ["4n+1", "Wan (4n+1)"]]) {
        const option = el("option", "", words); option.value = rule; select.append(option);
      }
      select.addEventListener("change", () => {
        set("frame_snap", select.value);
        // A Length moves to the nearest count the new rule keeps.
        if (plan()?.mode === "length") set("max_frames", snapToValid(get("max_frames", 1), select.value));
        sync(); onCommit?.();
      });
      controls.frame_snap = select;
      label.append(select);
      sampling.append(label);
    }
    const footer = el("div", "ausboss-transform-trim-line");
    const reset = el("button", "ausboss-transform-trim-reset", "整段");
    controls.reset = reset;
    reset.type = "button";
    reset.addEventListener("click", () => {
      const current = plan();
      if (current.mode !== "wired") {
        // The whole video: no start, no end, no Duration limit.
        if (!locked("start")) set("start_seconds", 0);
        if (!endDriven()) set("end_seconds", 0);
        set("max_frames", 0);
        if (!driven("fixed_frames")) set("fixed_frames", 0);
        stopNote = "";
        seek(0, true); onCommit?.();
      } else {
        moveEdge("start", 0, true);
      }
    });
    sampling.append(unitPill);
    footer.append(useStart, el("span", "spacer"), reset);
    root.append(sampling, footer);
  }
  root.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button,input,select")) event.stopPropagation();
  });
  sync();
  return { root, sync, info, window: currentWindow, moveEdge, plan };
}
