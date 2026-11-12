"""把待翻译的 AusBoss 文案切成给翻译用的批次文件。

产物：tools/_zh_tasks/batch-NN.json（英文原文，给翻译的人/agent 看）
      tools/_zh_tasks/BRIEF.md（翻译要求，每次任务都附上）

翻译结果放 tools/_zh_out/batch-NN.json，再由 tools/_ausboss_zh_build.py 合并成
ausboss/zh/nodes.json。输入名标签与下拉选项不在这里翻——那两份是全局表，见
tools/_ausboss_labels.json 与 tools/_ausboss_options.json。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

TOOLS_DIR = Path(__file__).resolve().parent
EXTRACTED = TOOLS_DIR / "_ausboss_extracted.json"
TASKS_DIR = TOOLS_DIR / "_zh_tasks"
NODE_BUDGET = 7  # 每批节点数


def main() -> int:
    data = json.loads(EXTRACTED.read_text(encoding="utf-8"))
    nodes = data["nodes"]
    TASKS_DIR.mkdir(exist_ok=True)

    ids = list(nodes)
    batches = [ids[i : i + NODE_BUDGET] for i in range(0, len(ids), NODE_BUDGET)]

    for index, batch in enumerate(batches, start=1):
        payload = {"batch": index, "nodes": {}}
        for node_id in batch:
            entry = nodes[node_id]
            payload["nodes"][node_id] = {
                "category": entry["category"],
                "display_name": entry["display_name"],
                "description": entry["description"],
                "return_names": entry["return_names"],
                "inputs": [
                    {
                        "name": name,
                        "kind": record.get("kind"),
                        "type": record.get("type") or "",
                        "options": record.get("options") or [],
                        "tooltip": record.get("tooltip") or "",
                    }
                    for name, record in entry["inputs"].items()
                ],
            }
        path = TASKS_DIR / f"batch-{index:02d}.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{path.name}: {len(batch)} 个节点")

    print(f"共 {len(batches)} 批，{len(ids)} 个节点")
    return 0


if __name__ == "__main__":
    sys.exit(main())
