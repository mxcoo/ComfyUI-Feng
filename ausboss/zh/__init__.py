"""AusBoss 中文数据与汉化入口。

- `nodes.json`：全部中文文案（节点名、分类、描述、提示、下拉选项、输出名）。
- `localize.py`：把这份数据套到已加载的节点类上。

数据与代码分开，是为了让「有没有漏译」能用脚本逐条核对（tools/check_ausboss.py），
也让上游升级时可以只补数据、不动逻辑。
"""

from .localize import localize_nodes

__all__ = ["localize_nodes"]
