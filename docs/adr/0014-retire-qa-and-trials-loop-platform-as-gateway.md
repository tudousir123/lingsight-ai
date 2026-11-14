# 平台收敛为工作台前端 + 认证网关，Text-to-SQL 与试次分析闭环退役

status: accepted
date: 2026-11-10

# 决策

用户裁决（2026-11-10）：本周（2026-11-09 起）之前的前端页面全部退役；`app/text_to_sql/` 及其路由、脚本、测试删除。自然语言查库方案由「MySQL + DBHub 只读 + 独立 lingsight-agent 服务」取代（承 ADR-0009/0010，推理服务拆分见 ADR-0013）。

# 目标拓扑（AI-native，三仓库各一件事）

- `lingsight-ai`：React 科研工作台 + 薄 FastAPI 认证网关（`routes/agent.py` → lingsight-agent，`routes/inference.py` → lingsight-inference）。服务凭据只存服务端。
- `lingsight-inference`：视频推理（提案 → 人工确认 → 追踪/v9/叠加）。结果发布进 MySQL 是下一步工作，本期未建。
- `lingsight-agent`：Pi 科研任务/执行/产物，经 DBHub 只读科研库。两个后端之间无直接调用，数据库是唯一集成点。

# 本次删除范围与保留边界

- 删除：前端 /qa、/prepare、/results、/reports、/items 与旧 experiments 试次详情三页；features qa/mwm-demo/Items；试次准备/核对/结果闭环页（含 scene/sync/speed-chart 叶子）；后端 text_to_sql 全包、research/items 路由、Item 模型族、demo/eval/v_query 脚本。
- 保留：trials 目录浏览（`features/trials/directory`，由本周 annotations 页消费）及其后端 catalog/assets/metrics 管线——复核/确认端点暂存为无消费者状态，待推理接入后随「做深」重构；认证体系即网关认证面。
- 数据库迁移历史原样保留（item/trial_review 等表不回滚），证据目录 docs/evidence/ 为历史记录不改写。
