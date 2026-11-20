// Clear VRAM 🆎 — a right-click entry on the empty canvas that unloads every
// model and frees memory on the ComfyUI server this page is connected to.
//
// It sends the same request as ComfyUI's own "Unload Models and Execution
// Cache" command (top menu, Edit): POST /free with unload_models and
// free_memory. That command is not on the right-click menu, so this entry
// puts it one click away. A setting hides the entry; a ComfyUI that turns
// manual unloading off (Comfy.Memory.AllowManualUnload) hides it too.
import { api } from "../../../../scripts/api.js";
import { app } from "../../../../scripts/app.js";
import { showToast } from "../shared/index.mjs";

const SETTING_ID = "AusBoss.Memory.ClearVramMenu";
const MENU_LABEL = "清除 VRAM 🆎";

function setting(id) {
  return app.ui?.settings?.getSettingValue?.(id);
}

async function clearVram() {
  try {
    const response = await api.fetchApi("/free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
    if (!response.ok) throw new Error(`服务器返回 ${response.status}`);
    showToast({ severity: "success", summary: MENU_LABEL, detail: "模型已卸载，显存已释放。", life: 3000 });
  } catch (error) {
    showToast({ severity: "error", summary: MENU_LABEL, detail: `显存清不掉： ${error?.message ?? error}` });
  }
}

app.registerExtension({
  name: "ausboss.clear.vram",
  settings: [
    {
      id: SETTING_ID,
      name: "在右键菜单里放「清除 VRAM」",
      type: "boolean",
      defaultValue: true,
      category: ["🆎 AusBoss", "Memory", "清空显存菜单"],
      tooltip:
        "右键空白画布可用「清除显存」：卸载所有模型并释放 "
        + "ComfyUI 服务器上的内存。关掉就不显示这一项。",
    },
  ],
  getCanvasMenuItems() {
    if (setting(SETTING_ID) === false) return [];
    if (setting("Comfy.Memory.AllowManualUnload") === false) return [];
    return [{ content: MENU_LABEL, callback: clearVram }];
  },
});
