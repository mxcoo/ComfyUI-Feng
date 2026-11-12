// Pure decisions behind js/shared/script_assist.mjs: what the help card says,
// and what to suggest at the caret in H3 Prompt Writer's script box. No DOM,
// so tests run it under node:test.

// The help card: each thing the node reads in the words, in plain words.
export const CHEAT_SHEET = [
  { code: "@1 to @4", text: "你接进来的一张图。@1 就是图片 1。" },
  { code: "3s:", text: "写在行首：这一刻从第 3 秒开始。没写时间的行平分剩下的时间。在时间条上拖块的左边缘会自动写这个。" },
  { code: "空行", text: "切到下一个镜头。不空行就是一个长镜头。" },
  { code: "\"用引号括起来\"", text: "照原话念出来。" },
  { code: "sound:", text: "单独一行：这个片段听起来是什么样。和 Sound 框一样。" },
  { code: "music:", text: "单独一行：音乐。有音乐会把这个片段调得更响。" },
  { code: "camera:", text: "单独一行：镜头怎么动，比如推近或者手持。" },
  { code: "look:", text: "单独一行：风格，比如动漫或者水彩。" },
  { code: "no cuts", text: "写在文字里任何位置：整条都别切镜头。" },
];

const LABELS = [
  { word: "sound", hint: "这个片段听起来是什么样" },
  { word: "music", hint: "音乐，会让它更响" },
  { word: "camera", hint: "镜头怎么动" },
  { word: "look", hint: "整条片段的风格" },
];

const starts = (value, typed) => value.toLowerCase().startsWith(typed.toLowerCase());

// What to offer at the caret, or null.
//   pictures: [{ number, job, plugged }] for @1 to @4
//   cameras, looks: the choices the node knows, for camera: and look: lines
//   seconds: the clip's length, so a time past the end isn't offered
// The answer replaces text[from, to) with an item's insert. `strong` means
// the person typed a trigger (@, camera:, look:), so Enter may take an item;
// a guess from the first letters of a line only takes Tab or a click, so
// Enter still starts a new line.
export function suggestAt(text, caret, { pictures = [], cameras = [], looks = [], seconds = 8 } = {}) {
  const value = String(text ?? "");
  const before = value.slice(0, caret);
  const line = before.slice(before.lastIndexOf("\n") + 1);

  const at = before.match(/(?:^|[^\w@])@(\d?)$/);
  if (at) {
    const typed = at[1];
    const plugged = pictures.filter((picture) => picture.plugged);
    const offer = (plugged.length ? plugged : pictures).filter((picture) => String(picture.number).startsWith(typed));
    if (!offer.length) return null;
    return {
      from: caret - typed.length - 1,
      to: caret,
      strong: true,
      items: offer.map((picture) => ({
        label: `@${picture.number}`,
        insert: `@${picture.number}`,
        hint: picture.plugged ? picture.job || "" : "没接图",
        number: picture.number,
      })),
    };
  }

  const choice = line.match(/^\s*(camera|look)\s*:\s*([\w ]*)$/i);
  if (choice) {
    const typed = choice[2];
    const list = choice[1].toLowerCase() === "camera" ? cameras : looks;
    const offer = list.filter((name) => starts(name, typed) && name.toLowerCase() !== typed.toLowerCase());
    if (!offer.length) return null;
    return { from: caret - typed.length, to: caret, strong: true, items: offer.map((name) => ({ label: name, insert: name, hint: "" })) };
  }

  const time = line.match(/^(\s*)(\d{1,2})$/);
  if (time) {
    const second = Number(time[2]);
    if (second < 1 || second >= seconds) return null;
    return {
      from: caret - time[2].length,
      to: caret,
      strong: false,
      items: [{ label: `${second}s:`, insert: `${second}s: `, hint: `这一刻从第 ${second} 秒开始` }],
    };
  }

  const word = line.match(/^(\s*)([a-z]{2,6})$/i);
  if (word) {
    const offer = LABELS.filter((label) => starts(label.word, word[2]) && label.word !== word[2].toLowerCase());
    if (!offer.length) return null;
    return {
      from: caret - word[2].length,
      to: caret,
      strong: false,
      items: offer.map((label) => ({ label: `${label.word}:`, insert: `${label.word}: `, hint: label.hint })),
    };
  }
  return null;
}
