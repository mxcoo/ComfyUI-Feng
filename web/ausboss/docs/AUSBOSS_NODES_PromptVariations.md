# 提示词变体 🆎

一个每次运行都会变的提示词框。把选项写在花括号里，节点会从每一组里挑一个：

```text
A woman in a {plain|striped|patterned} {tank top|sweater|button-up shirt}
and {jeans|a pleated skirt|cargo shorts}, {standing|sitting on a stool|leaning on the wall}.
```

某一次运行可能给出 "A woman in a striped sweater and jeans, sitting on a
stool."，下一次给出另一种组合。

用它一次做出许多张不同的图。把种子接进来，把种子节点设为 **randomize**，再把运行按钮旁边的运行次数设为 50。每次运行都拿到新种子，所以每张图都拿到新的选项。

## 控件

- 文本框（`text`）：你的提示词。把每组选项放进花括号，用 `|` 分隔各选项。组数随意，每组里的选项数也随意。
- `seed`（插槽）：采样器使用的种子。新种子会挑出新的选项。同一个种子会挑回同样的选项，所以喜欢的图可以用它的种子再做一张。

## 输出

- **prompt**：你的文本，每组都已挑好一个选项。接到显示文本上就能看到挑了哪个。

## 提示

- 空选项可以让某一部分时有时无：`a {|striped} shirt` 给出 "a shirt" 或 "a striped shirt"。
- 组可以套组：`{a {red|blue} hat|a scarf}`。
- 没有花括号的文字会原样输出。
- 想让某个选项出现得更频繁，就多写几次：`{jeans|jeans|skirt}`。

## 技术细节

只有含有 `|` 的花括号才是选项。不含 `|` 的花括号原样保留，所以像 `{"light": "soft"}` 这样的 JSON 提示词会原封不动地通过。JSON 花括号里的 `|` 仍算作选项。

最内层的组先挑，从左到右，用 Python 的 `random.Random(seed)`。同样的文本和同样的种子在任何机器上都会给出同样的提示词。每个选项前后的空格会被去掉，空选中还会连带去掉它前面的那一个空格。

挑选项发生在提示词运行的时候，在服务器上，不在浏览器里。ComfyUI 自己那些文本框里的 `{a|b}` 选项是排队时由浏览器挑的，没有种子；本节点不使用它们。
