# M1 工单 #1 收口核验（2026-10-14）

- **01-lint.log**：`cd backend && uv run bash scripts/lint.sh` @ dddd52e — mypy strict + ty + ruff + format 全绿（60 文件）。
- **02-pytest.log**：`cd backend && uv run pytest -q` @ dddd52e — **275 passed**（结构层全量 + env_gated 执行层真跑，含真实研究库与 LLM 通道；无 skip）。本机 pytest 会清 compose 栈 app 库用户（docs/agents/local-e2e.md §4），与科研库无关。
- 评测数字核正（收口 review 发现）：评测套件自 T7（723a302）起为 **28 问**；留档报告为 25/25（gemini 代理，m1-t6/eval-report-20261013-110106.json）、Q27/Q28 live 2/2（m1-t7/eval-q27-q28-live.json）、GLM 24/28 ×2 模型（m1-t6/eval-report-20261014-*.json）。此前 progress.md/提交信息中的「29 问 / 29/29 / 24/29」为计数笔误，已核正为 28。
- 双轴 code-review：Standards 抓出收口行证据缺口（275/275 无档 → 本目录补档；遗留疑点被删 → 已补回 docs/09 指针）；Spec 抓出 29/29、24/29 与留档报告矛盾 → 已按档案核正。
