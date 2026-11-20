# 工作流开关：给 AI agent 的指南

把这一页交给 AI agent，它就能替你在 ComfyUI 工作流里加开关，不必有人去点菜单：agent 直接把卡片写进工作流文件。

**如果你是 agent：** 这张卡片就是工作流文件里的一个节点，不接任何线。它用一个属性列出每个开关控制哪些节点。从下面的配方里挑合适的一个，加入卡片，再把各节点的初始状态设好。

## 动手之前

- **改 ComfyUI 用 Save 保存的那个文件**，就是带 `nodes` 列表的那个。卡片永远不会进入运行，所以在 API 格式里没有它的位置。要出 API 提示词，把不该跑的部分略掉即可。
- **用 `nodes` 里每个节点的 `id`**，以及 `groups` 里每个组的 `id`。
- **只在自己的层级里管**。卡片控制的是它所在图层的节点：从主图可以开关整个子图节点、也可以改子图节点露出来的控件，但够不到子图里面的节点。
- **控件名从哪看**：文件里节点的 `widgets_values_named`，或 ComfyUI 服务端的 `/object_info/<节点类型>`。

## 加入卡片

把下面这段加进 `nodes`。给它一个别人没用的 `id`，`last_node_id` 比它小就一起抬高。挑一个空的 `pos`，别压住东西；`order` 取下一个没用的数。

```json
{
  "id": 50,
  "type": "AUSBOSS_NODES_WorkflowSwitches",
  "pos": [0, 0],
  "size": [320, 100],
  "flags": {},
  "order": 0,
  "mode": 0,
  "inputs": [],
  "outputs": [],
  "title": "Workflow Switches",
  "properties": {
    "cnr_id": "ausboss-nodes",
    "ausboss_show_edit": false,
    "ausboss_workflow_switches": {
      "off": "bypass",
      "groups": "none",
      "exclusive": false,
      "show": "rows",
      "switches": []
    }
  },
  "widgets_values": []
}
```

然后用配方填 `switches`。`"groups": "none"` 要留着：默认值 `"all"` 会给画布上每个组都长出一行。

`show` 取 `"rows"` 时每个开关一行（开 | 关），取 `"pill"` 时是一颗能点的胶囊。一行的 `id` 是从 1 起的整数，只在自己这张卡片里唯一。一个工作流可以有几张卡片。

## 设定初始状态

卡片本身不记「谁开着」，它读的是每个节点自己的 `mode`，所以工作流一打开是什么样，由文件决定。

| `mode` | 节点做什么 |
| --- | --- |
| `0` | 运行 |
| `4` | 旁路：把输入原样传下去，ComfyUI 也不校验它 |
| `2` | 静音：什么都不往下传，ComfyUI 也不校验它 |

想让某部分一打开就是关的，把它的节点（含 Save Image）设成 `"mode": 4`；卡片上若是 `"off": "mute"`，就用 `2`。

要改文件里的某个值，`widgets_values` 和 `widgets_values_named` 两处一起改，两边必须一致。

## 配方

### 一段可选的部分

一行就够：把若干节点一起关掉再打开，比如结尾那道放大。

```json
"switches": [
  { "id": 1, "title": "Upscale", "nodes": [12, 13], "groups": [] }
]
```

要开关一整组节点，把组的 `id` 写进 `groups`。

### 多选一

一颗胶囊：点哪个名字，就开它那几个节点、关掉其它行。打开时让某一行的节点处于 `0`、其余处于 `4`。胶囊里最多放 4 个名字，再多会变成列表。

```json
"exclusive": true,
"show": "pill",
"switches": [
  { "id": 1, "title": "Photo", "nodes": [20, 21], "groups": [] },
  { "id": 2, "title": "Drawing", "nodes": [22], "groups": [] }
]
```

两边都要用的节点，哪一行都别放。

### 一个只改设置的开关

这种行不关节点，而是改数值。`on` 与 `off` 都以节点 id（按文本写）为键，再按控件名取值。每个节点两边都要写全。

```json
"switches": [
  {
    "id": 1,
    "title": "Fast",
    "nodes": [],
    "groups": [],
    "on": { "5": { "steps": 8 } },
    "off": { "5": { "steps": 20 } }
  }
]
```

只有两边不同的值才会被改。值可以是文本、数字或 true/false。

LoRA 加载器 🆎 把各行存在一个文本值 `loras` 里：两边存整段文本，只让那一行的 `enabled` 不同，开关就只动那一行。

### 具名选项

在几套设置之间挑一套、或在两条分支里跑一条，这是最简单的做法。每个选项就是一种节点设置方式，所以只有 `on`、没有 `off`。选项类卡片永远是胶囊形式，所以别的开关请另开一张卡片。

要在两条分支里跑一条，两边都接到 ComfyUI 的 If/Else Switch（类型 `ComfySwitchNode`，控件 `switch`，输入 `on_true` 与 `on_false`）：

```json
"exclusive": true,
"show": "pill",
"switches": [
  { "id": 1, "title": "Soft", "choice": true, "nodes": [3], "groups": [], "on": { "6": { "switch": true } } },
  { "id": 2, "title": "Big", "choice": true, "nodes": [4, 5], "groups": [], "on": { "6": { "switch": false } } }
]
```

这里节点 6 是那个 If/Else，每个选项的 `nodes` 是只有这条分支才需要的节点。打开文件时让 If/Else 指向被选中的那个选项，该选项的节点处于 `0`、其余处于 `4`。

每次都要把一条分支的节点列全。ComfyUI 在跑之前会先检查所有开着的节点，所以没人选的那条分支里若缺模型，只要它的节点没关就会让整次运行失败。

别把这两种节点放进选项的 `nodes`：选项自己设置的那个节点（关了就等于撤销选择），以及两条分支都要用的节点。两条分支的出口类型必须相同，比如都是图片。

### 两个面的行

`nodes_off` 放只在行关闭时才跑的节点。想让「开这个」同时意味着「关那个」时用它。

```json
{ "id": 1, "title": "Edit a picture", "nodes": [7], "groups": [], "nodes_off": [8] }
```

打开时让一面处于 `0`、另一面处于 `4`。

## 检查结果

把工作流在 ComfyUI 里打开，然后看：

- **某行显示「空」：** 它列的 id 在那张卡片所在的层级里找不到节点。
- **某行显示「混合」，或胶囊没有选中项：** 文件里存的 `mode` 或数值对不上任何一行。把初始状态改对。
- **某行点了没反应：** 控件名写错了，或两边存的是同一个值。
- **某个选项显示「还差一个」：** 没有别的选项与它不同。

## 限制

一张卡片最多 40 行。标题最长 60 个字符，一行最多 400 个节点；一行最多能给 40 个节点设值。
