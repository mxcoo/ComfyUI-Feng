# 04 · 前端扩展（JS）

后端节点负责算，前端扩展负责**改界面**：加控件、改外观、加右键菜单、接收后端回传的数据。
后端不写前端也完全能跑，所以这部分可以最后再做。

## 1. 前端文件是怎么被加载的

`__init__.py` 里声明 `WEB_DIRECTORY = "./web"` 之后，ComfyUI 启动时会把这个目录登记到
`EXTENSION_WEB_DIRS`（`nodes.py:2299-2302`），然后：

```
浏览器请求 /extensions                → 后端返回"所有该加载的 JS 列表"
                                       （server.py:420-432）
本地 web/js/feng_example.js           → /extensions/Feng/js/feng_example.js
```

两条关键规则：

1. **目录里的所有 `.js` 都会被递归收集并加载**（`server.py:428` 用的是 `**/*.js`）。
   所以 `web/` 下不要放"只是给别的文件 import 用"的 JS——它同样会被当成扩展入口执行一遍顶层代码。
   真要放，就保证它顶层只有 `export`，没有副作用。
2. 访问前缀里的 `Feng` 是**插件目录名**（不是 `pyproject.toml` 里的 name）。
   如果你在 `pyproject.toml` 里也写了 `[tool.comfy] web`，会多注册一份，见 [01-plugin-structure.md](01-plugin-structure.md#别和-pyproject-的-web-字段同时用)。

## 2. import 路径：数清楚层级

前端文件是 **ES module**，相对路径按**浏览器 URL** 解析，不是按磁盘路径。

| `WEB_DIRECTORY` | 文件位置 | 浏览器 URL | 正确的 import |
| --- | --- | --- | --- |
| `"./web"` | `web/foo.js` | `/extensions/Feng/foo.js` | `"../../scripts/app.js"` |
| `"./web"` | `web/js/foo.js` | `/extensions/Feng/js/foo.js` | `"../../../scripts/app.js"` |
| `"./web/js"` | `web/js/foo.js` | `/extensions/Feng/foo.js` | `"../../scripts/app.js"` |

规律：`/extensions/<插件名>/` 这一段算两级，**每多一层子目录就多一个 `../`**。

本骨架是 `WEB_DIRECTORY = "./web"` + `web/js/feng_example.js`，所以用三个 `../`：

```javascript
import { app } from "../../../scripts/app.js";
```

也可以写绝对路径 `"/scripts/app.js"`（本机插件里有 198 处这么写），两种都能用。
可用的模块（都在前端包里 `static/scripts/` 下）：

```text
/scripts/app.js        app 对象、registerExtension 的入口
/scripts/api.js        api.fetchApi / api.addEventListener
/scripts/widgets.js    ComfyWidgets，复用内置控件
/scripts/ui.js         弹窗、对话框
/scripts/domWidget.js  DOM 控件基类
/scripts/utils.js
```

## 3. 最小扩展

本骨架的 `web/js/feng_example.js` 就是这个，可以直接改：

```javascript
import { app } from "../../../scripts/app.js";

const VERBOSE_SETTING = "Feng.verboseLog";

app.registerExtension({
  name: "Feng.Example",          // 全局唯一，建议带插件前缀

  settings: [                    // 会被自动注册到设置面板
    { id: VERBOSE_SETTING, name: "Feng：输出调试日志", type: "boolean", defaultValue: false },
  ],

  async setup() {
    console.log("[Feng] 前端扩展已加载");
  },

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!nodeData?.name?.startsWith("Feng")) return;
    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = onNodeCreated?.apply(this, arguments);
      // this 是节点实例
      return result;
    };
  },
});
```

验证：`F5` 刷新后按 `F12` 看控制台有没有 `[Feng] 前端扩展已加载`。
没有的话先看 Network 面板 `/extensions` 的返回里有没有你的 JS。

## 4. `registerExtension` 能写什么

`1.55.18` 的构建产物里确认存在这些钩子（在 `static/assets/*.js` 里都能搜到）：

| 键 | 时机 | 典型用途 |
| --- | --- | --- |
| `name` | — | **必填**，全局唯一 |
| `settings` | 注册时 | 声明设置项数组 |
| `init()` | 最早，脚本加载即调用 | 抢在节点注册前做准备 |
| `setup()` | 界面初始化完成后一次 | 加全局快捷键、监听事件 |
| `beforeRegisterNodeDef(nodeType, nodeData, app)` | **每种节点类型**注册时一次 | 改 `nodeType.prototype`，对所有实例生效 |
| `nodeCreated(node)` | **每个节点实例**创建后 | 改单个实例：加控件、改尺寸 |
| `loadedGraphNode(node)` | 从工作流 JSON 恢复节点时 | 修复旧工作流的兼容问题 |
| `getCustomWidgets(app)` | 注册控件工厂时 | 提供自定义 widget 类型 |

### 三个最容易混的钩子

```
beforeRegisterNodeDef   改"类"      nodeType.prototype.xxx = ...
nodeCreated             改"个体"    node.addWidget(...) / this.size = [300, 200]
loadedGraphNode         改"载入后"  工作流打开后补数据
```

**想给所有同类节点加东西就改 prototype（beforeRegisterNodeDef）；只想改当前这一个就改实例（nodeCreated）。**
在 `nodeCreated` 里加控件，节点删掉再重建不会重复加；但如果你在 `beforeRegisterNodeDef` 里
对原型重复 `push` 数组，就会越加越多。

## 5. 常用改造

### 5.1 接收后端 `ui` 数据

后端 `return io.NodeOutput(image, ui=ui.PreviewText("hello"))`，前端这样收：

```javascript
async beforeRegisterNodeDef(nodeType, nodeData) {
  if (nodeData.name !== "MyNode") return;
  const onExecuted = nodeType.prototype.onExecuted;
  nodeType.prototype.onExecuted = function (message) {
    onExecuted?.apply(this, arguments);
    console.log(message.text);        // 后端 ui 里的内容
  };
}
```

### 5.2 复用内置控件显示只读文本

来自本机 `ComfyUI_essentials/js/DisplayAny.js:1-33` 的真实写法：

```javascript
import { app } from "../../scripts/app.js";
import { ComfyWidgets } from "../../scripts/widgets.js";

async beforeRegisterNodeDef(nodeType, nodeData) {
  if (nodeData.name !== "DisplayAny") return;
  const onExecuted = nodeType.prototype.onExecuted;
  nodeType.prototype.onExecuted = function (message) {
    onExecuted?.apply(this, arguments);
    let textWidget = this.widgets?.find((w) => w.name === "displaytext");
    if (!textWidget) {
      textWidget = ComfyWidgets["STRING"](this, "displaytext", ["STRING", { multiline: true }], app).widget;
      textWidget.inputEl.readOnly = true;
      textWidget.inputEl.style.border = "none";
    }
    textWidget.value = message.text.join("");
  };
}
```

### 5.3 加一个自定义 DOM 控件

```javascript
async beforeRegisterNodeDef(nodeType, nodeData) {
  if (nodeData.name !== "FengImageFilter") return;
  const onNodeCreated = nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated = function () {
    onNodeCreated?.apply(this, arguments);
    const box = document.createElement("div");
    box.textContent = "自定义区域";
    box.style.cssText = "padding:4px;font-size:11px;color:#888;";
    // addDOMWidget(名字, 类型, 元素, 选项)
    this.addDOMWidget("feng_panel", "feng_panel", box, { serialize: false });
  };
}
```

`serialize: false` 表示这个控件不写进工作流（重启后不需要恢复状态）。
需要保存状态时，用 `{ serialize: true }` 并配合 `onSerialize` / `onConfigure`。

### 5.4 设置项、提示、请求后端

```javascript
// 读设置（settings 数组注册过的）
const verbose = app.ui.settings.getSettingValue("Feng.verboseLog", false);

// 右下角提示
app.extensionManager.toast.add({ severity: "warn", summary: "Feng", detail: "处理完成", life: 4000 });

// 请求自己加的后端路由，见 05-server-and-models.md
const resp = await api.fetchApi("/feng/hello?name=abc");
const data = await resp.json();
```

`api` 要单独 import：

```javascript
import { api } from "../../../scripts/api.js";
```

## 6. 调试清单

| 现象 | 检查 |
| --- | --- |
| 控制台没有任何日志 | `/extensions` 响应里有没有你的 JS；路径拼错会让整个模块 404 |
| 报 `Failed to fetch dynamically imported module` | import 路径层级错了，按第 2 节的表逐级数 |
| 改了 JS 没变化 | `Ctrl+F5` 强刷；前端有 module 缓存，普通刷新可能仍用旧文件 |
| 扩展加载了两次 | `pyproject.toml` 里也写了 `web`，和 `WEB_DIRECTORY` 重复注册 |
| 节点上控件重复出现 | 在 `beforeRegisterNodeDef` 里对 prototype 累加，或 `nodeCreated` 没判重 |
| 扩展名冲突 | 多个插件的 `name` 字段相同，后注册的会覆盖前面的 |

改完 JS 只要刷新浏览器；**改 `WEB_DIRECTORY` 或 Python 要重启 ComfyUI**。
