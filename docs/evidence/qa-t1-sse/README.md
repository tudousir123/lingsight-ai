# 科研问答 T1 · SSE 流式端点证据（工单 #24，2026-10-14）

- **01-traefik-stream.log**：经 Traefik（http://localhost）`curl -sN -X POST /api/v1/research/query/stream` 的逐行墙钟时间戳——generation 事件与 validation 事件相隔 5.7 秒分块到达（代理未缓冲），result 载荷与同步 API 同构（rows [[6]] + 口径声明 + data_source）。行尾 `# exit=1` 是 shell 管道中 `while read` 循环在 curl 关流后的返回码，非请求失败（四条 data: 事件齐全）。
- **02-q16-preexisting-flake.log**：全量回归中唯一失败 Q16-C（真模型评测，env_gated）的现场输出。与 2026-10-14 归档基线 `m1-t6/eval-report-20261014-132043.json` 中 Q16 的失败**同型**：期望标量单行、模型给按鼠拆分两行，数值命中锚点（golden_drift 101.74 vs 101.7，rel_diff 0.04%）——progress.md「LLM 通道切换」行已记录的标量形态类模型波动，与本工单改动无关（无回调路径逐字节不变，评测不走 SSE）。
- 全量回归：**277 passed + 1 failed（上述 Q16-C）**；`uv run bash scripts/lint.sh` 全绿（mypy strict + ty + ruff + format）。
- 新增测试 4 项（`tests/text_to_sql/test_query_pipeline.py`）：SSE 修复循环阶段序列（结构层）、SSE 成功载荷（env_gated）、SSE 未登录 401（结构层）、管线级 on_stage 序列含 execution（结构层，桩执行器）。
