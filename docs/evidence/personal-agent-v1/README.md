# Personal Agent v1 隔离整体验证入口（#85）

本文件是证据索引，不是第二份规格；唯一产品规格为 [01-product-spec](../../01-product-spec.md)。范围与决策见 [ADR-0011](../../adr/0011-durable-research-task-workspace.md)，实际执行结果见 [progress](../../progress.md)。仅合成副本，不授权现役操作。

## 代码与复现

- 两仓工作分支 `proma/pa-t10-85-20261116`；平台业务源码基线 `4cd64a270cb19091eb5a38ad7b564032cd02c8be`，本票平台只更新文档；Agent 基线 `46347a4f1d4008ebc675b7a78155ddd300c33de4`。最终精确双仓HEAD与远端/clean核验在下述REPORT，不用自引用commit hash。
- Agent 原有 API/Worker/ModelRuntime/Durable，不加生产API或改记忆权威。`scripts/integrated-contract-fixture.ts` 仅是合成故障supervisor；`test/integrated.test.ts` 贯穿真实网页+文件+Python、SIGKILL、同Run恢复及逐artifact ZIP SHA；`test/maintenance-rehearsal.test.ts` 实际备份/旧schema迁移/阻断旧回滚/保留墓碑/未知owner及停队列。
- Agent：`npm run check`；`RUN_DOCKER_TESTS=1 node --test --test-concurrency=1 test/integrated.test.ts test/maintenance-rehearsal.test.ts`；故障交集 `RUN_DOCKER_TESTS=1 node --test --test-concurrency=1 test/durable.test.ts test/operations.test.ts test/recovery.test.ts`；全回归同设置 `test/*.test.ts`。不要把未设 Docker gate 的skip计为pass。
- 平台沿用 [隔离测试命令](../../agents/local-e2e.md)。真实浏览器工具/文件/授权网关分别为 backend `test_agent_browser_http.py`、`test_agent_operations_http.py`、`test_agent_project_http.py`。前端仍用当前构建，不能以API拦截夹具代替真实服务。

## 本机保留证据

父实现根：`/home/x/.proma/agent-workspaces/lingsight-ai/17b26625-a31f-4065-9bdf-f2a4cc06f663/implementation`。本票 `notes/ticket-85/REPORT.md` 原11AC逐项映射，`CONTRACT.md` 给独立merger与双轴review操作入口；共享文件不打包进仓库，避免提交运行数据/合成账号token。

核心文件：`live-ui.mjs`、`test_live_workspace.py`、`run-live-stack.sh`、私有Vite/Playwright配置；`live-ui-result.json`、`analysis-result.json`、`analysis-bundle.zip`/`analysis-bundle-proof.json`、稳定PNG；`fault-matrix-final.log`/`fault-identities-and-effects.json`；`maintenance-result.json`/`.backup.tar`；`quality-source-boundary.json` 与原 `notes/real-quality-82/REPORT.md`、`notes/acceptance-82/REPORT.md`。报告区分当前HTTP替身工程验收、历史真实质量和未做真实科研验收。

所有 supervisor 仅新建临时 Store 与随机端口；FastAPI/JWT/MySQL/Project/实时授权是真实代码，HTTP→ASGI桥与外部生成/抽取/embedding为本地合成协议接线。禁止读取integration/agent/.env、个人凭据或让测试工具变成宿主shell/完整桌面。真实质量十二例样本及evaluator未变，不擅自新增外呼。生产升级须另行授权并先通过停写、资源域、ownership、配对版本、墓碑兼容与一致备份门禁；演练选择阻断不安全旧回滚，不声称拥有通用生产迁移器。
