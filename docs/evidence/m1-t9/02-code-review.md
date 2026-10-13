# M1-T9 · /code-review 双轴评审存档（2026-10-13）

范围：`fd1562a...HEAD`（M1 全部 27 笔提交，68 文件，+5015/−13）。
方式：两个并行子代理分别审 Standards 轴与 Spec 轴（工单 #3/#4/#5/#7/#8/#15 + 伞票 #1 为 spec 来源；AGENTS.md/GLOSSARY + smell 基线为 standards 来源）。

## Standards 轴

- **审计日志缺口（偏硬性）**：AGENTS.md §3 要求审计日志服务端强制执行，原实现只有随响应返回的 `trace`，无任何持久化。**已修复**：`pipeline.py` 增加 `logger`（每次失败尝试 + 终局裁决落服务端日志），新增测试 `test_attempts_and_verdict_are_written_to_the_server_audit_log` 锁定。可查询的审计存储（DB 表/文件轮转）留待后续，缺口已在 progress.md 标注。
- 三段近似重复的 `trace.append + ResearchQueryRejection` 块：**已修复**（提取 `_trace_failure` / `_reject`）。
- 判断类发现（记录不阻塞）：validator.py 对 `exp.Table` 的三处 isinstance 分支可收敛；`scripts/metrics/_db.py::metrics_engine` 被 schema 脚本复用、命名与归属错位；`_caliber_note` 按字符串嗅探 SQL 且硬编码语义层键（漂移风险，宜下沉到 SemanticLayer）；`gateway.py` 的 `Message` 宜 TypedDict；`demo_rejection.py` argv 解析易 IndexError。

## Spec 轴

- **docs/09 D24 期望未随 #15 反转（真缺口）**：ADR-0007 与测试均已反转，但 docs/09 第 66 行仍是旧拒绝预期。**已修复**：D24/D25 两行改写为「经视图允许（ADR-0007），基表仍只授视图，行数上限兜底」。
- 黄金矩阵容差：`validate_golden_matrix.py` 用 0.5% 相对容差 + 绝对余量，依据是 2026-10-11 数据刷新（ok+265 帧）导致的基准漂移，docstring 已论证、另有 1e-9 SQL 交叉校验。**记录为已论证偏离**（对漂移后数据满足验收，非原矩阵逐字一致）。
- 执行错误零重试 vs 伞票「按类型有限次重试」：#8 自身文本（「超限明确报错」）支持终局处理，重跑同一条超时 SQL 无意义，测试锁定 `attempts == 1`。**记录为有据收窄**。
- 范围外内容（docs-only，无害）：docs/10 事件定义草稿 + ADR-0006（属 #6 工作流）、agents/meta 文档、06/07 模型自觉演示（超出 D21–D23 的额外实证）。

## 结论

两轴通过：Standards 唯一偏硬性发现（审计日志）与 Spec 唯一真缺口（D24 反转）均已在本次收口修复并测试锁定（全量 120 passed / 覆盖率 90%，`01-full-regression.log`）；其余为已论证偏离或记录在案的后续项。
