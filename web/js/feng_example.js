// Feng 前端扩展示例。
//
// 文件位置 web/js/feng_example.js，浏览器里的 URL 是 /extensions/Feng/js/feng_example.js，
// 所以相对路径要多退一级：web/ 根目录下的文件用 ../../scripts/app.js，
// web/js/ 这种子目录用 ../../../scripts/app.js。详见 docs/04-frontend.md。

import { app } from "../../../scripts/app.js";

const VERBOSE_SETTING = "Feng.verboseLog";

app.registerExtension({
  name: "Feng.Example",

  // 这个数组会被前端自动注册成设置项，用户可在设置面板里看到。
  settings: [
    {
      id: VERBOSE_SETTING,
      name: "Feng：输出调试日志",
      type: "boolean",
      defaultValue: false,
    },
  ],

  async setup() {
    console.log("[Feng] 前端扩展已加载");
  },

  // beforeRegisterNodeDef 在节点类型注册时触发一次，用来改节点的原型（所有实例共享）。
  // 只想改某一个实例，就在 onNodeCreated 里改 this。
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!nodeData?.name?.startsWith("Feng")) {
      return;
    }

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      if (app.ui.settings.getSettingValue(VERBOSE_SETTING, false)) {
        console.log(`[Feng] 创建节点 ${nodeData.name}`, this);
      }
      return result;
    };
  },
});
