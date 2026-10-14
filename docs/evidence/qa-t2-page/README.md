# 科研问答页 T2 证据（工单 #25，2026-10-14）

- **01-playwright-qa-spec.log**：`bash scripts/e2e-local.sh tests/qa-page.spec.ts` — **7/7 通过**（成功含口径声明与 SQL 折叠、空结果成功通道、类型化拒绝含修复循环「第 2 次尝试」徽章、provider 失败一键重试、会话内历史回看不重发、加载态诚实文案与禁用）。
- **02-playwright-full-suite.log**：`bash scripts/e2e-local.sh`（全量）— **79/79 通过**（72 既有 + 7 新增；早前一轮 user-settings 模板用例波动，单独复跑与再次全量均过）。
- **03-manual-a3-distance.png**：浏览器（In-app Browser，真实 GLM 端点 + 真实 water_maze 库）手工验收截图。
- **手工验收记录（2026-10-14 17:0x，compose 栈 http://localhost）**：登录后逐题实际提问，SSE 阶段时间线在浏览器实时可见（「生成 SQL 进行中…」→ 校验 → 执行）：
  1. 「库里一共有多少只动物？」→ **6**（口径声明含动物口径+聚合口径；数据来源 videos · 1 行）；
  2. 「训练期内各组每鼠每日的平均游泳速度是多少？」→ **30 行**（6 鼠 × 5 训练日；c2/0806 = 94.0409…与管线直跑值一致；口径声明含阶段口径；数据来源 trial_metrics、videos）；
  3. 「训练期内 A3 组 2 号鼠每天的平均游泳距离分别是多少？」→ **5 行**（0804=6486.7 px → 0808=3101.3 px，学习曲线形态正确；截图见 03）。
  过程另验证：示例点击即发、进行中防重复提交、历史面板两条目与行数徽标。
- **静态检查**：后端 `uv run bash scripts/lint.sh` 全绿（新增绊网测试 tests/text_to_sql/test_reason_code_labels.py：前端 REASON_LABELS/RETRYABLE_REASONS 与后端 ReasonCode/5xx 家族逐字对齐，2 passed）；前端以仓库锁定 bun 工具链（docker oven/bun:1 + bun.lock 依赖）跑 `biome check` 全绿；`bun run build`（tsc + vite）随 backend 镜像构建通过。
- 双轴 code-review：Standards 无阻塞硬伤（reason-code 镜像的单一来源问题以绊网测试收口；证据补档）；Spec 全 AC 核对通过（评审中发现的手工证据缺口已由本 README 记录补齐）。
