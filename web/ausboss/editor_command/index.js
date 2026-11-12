import { app } from "../../../../scripts/app.js";
import { showToast } from "../shared/index.mjs";
import { openTransformEditorForNode } from "../shared/transform_editor.mjs";

// Alt+E opens the transform editor of the selected Crop + Rotate + Pad node.
// Registered through ComfyUI's command + keybinding system (never a raw key
// listener) so it appears in Settings -> Keybindings and stays rebindable.

function selectedTransformNode() {
  const selected = Object.values(app.canvas?.selected_nodes ?? {});
  return selected.find((node) => node?.__ausbossTransformState) ?? null;
}

function notify(detail) {
  showToast({ detail, life: 3000 });
}

app.registerExtension({
  name: "ausboss.editor.command",
  commands: [
    {
      id: "AusBoss.OpenEditor",
      label: "AusBoss：打开所选节点的变换编辑器",
      function: () => {
        const node = selectedTransformNode();
        if (!node) {
          notify("先选中一个 AusBoss Crop + Rotate + Pad 节点。");
          return;
        }
        openTransformEditorForNode(node);
      },
    },
  ],
  keybindings: [
    { combo: { key: "e", alt: true }, commandId: "AusBoss.OpenEditor" },
  ],
});
