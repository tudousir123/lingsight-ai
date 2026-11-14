---
status: superseded by ADR-0009
---

# Text-to-SQL 采用"借鉴成熟架构、自建轻量管线"，不整体引入 WrenAI/DB-GPT

2026-11-09：目标架构由 [ADR-0009](0009-independent-research-agent-via-dbhub.md) 取代，改为独立科研 Agent 服务并复用现有 DBHub 数据入口。以下保留原始决策背景；现有实现尚未迁移或删除。

产品目标是把 Text-to-SQL 做成科研 Agent 中可解释、可独立讲述的工程模块（工程化面试型），而非交付一个现成问答平台。因此决定：参照 WrenAI 的语义层思想与 LangGraph SQL Agent 的"生成→校验→修复"回路，用 SQLGlot + SQLAlchemy + FastAPI 自建核心链路；完整的 WrenAI/DB-GPT 平台本期不引入。

## Considered Options

- **直接改造 WrenAI/DB-GPT 源码**：起步快，但必须接受其整体架构（容器编排、自带 UI 与管线），核心链路难以独立解释，README 已明确本期排除。
- **从零设计全部模块**：自主性最大，但语义层格式与校验策略会重复造轮子，挤占 M1 交付时间，也缺少与业界方案的对照。
- **Vanna**：仓库已于 2026-03 归档，不作为基座候选，仅参考其应用链路设计。

## Consequences

- 安全边界必须自建且在服务侧生效：只读账户、表列白名单、超时与行数限额；SQLGlot AST 校验只是防护之一，不替代数据库权限。
- 语义层格式、Schema Linking 策略成为本项目自己的设计对象（见后续 ADR）。
- 状态说明：2026-10-12 用户在 grill 会话中确认按推荐方向采纳（工程化面试型目标 + 借鉴架构自建）。
