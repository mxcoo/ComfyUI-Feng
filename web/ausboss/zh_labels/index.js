// AusBoss 节点的插槽与控件中文标签。
//
// 输入名本身是 prompt JSON 里的字段，改了就毁掉老工作流与 API 调用，
// 所以后端保持英文名不动，只在界面上把显示标签换成中文。
// 标签表由 tools/_ausboss_zh_build.py 生成，不要在这里手写文案。

import { app } from "../../../../../scripts/app.js";
import { INPUT_LABELS } from "./labels.mjs";

function localize(node) {
  const table = INPUT_LABELS[node?.comfyClass ?? node?.type];
  if (!table) {
    return;
  }
  for (const input of node.inputs ?? []) {
    const zh = table[input.name];
    if (zh && input.label !== zh) {
      input.label = zh;
    }
  }
  for (const widget of node.widgets ?? []) {
    const zh = table[widget.name];
    if (zh && widget.label !== zh) {
      widget.label = zh;
    }
  }
}

function applyLater(node) {
  localize(node);
  // 有的节点在自己的 onNodeCreated 里异步补控件，等它补完再贴一次标签。
  setTimeout(() => localize(node), 0);
}

app.registerExtension({
  name: "Feng.AusBoss.ZhLabels",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!INPUT_LABELS[nodeData.name]) {
      return;
    }
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      applyLater(this);
      return result;
    };
    // 打开已有工作流走的是 configure，onNodeCreated 不会再触发。
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = configure?.apply(this, arguments);
      localize(this);
      return result;
    };
  },
  nodeCreated(node) {
    localize(node);
  },
});
