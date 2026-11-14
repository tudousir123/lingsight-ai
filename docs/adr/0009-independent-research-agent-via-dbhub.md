---
status: accepted
---

# 科研任务由独立 Agent 服务完成，数据库访问复用 DBHub

2026-11-09 用户确认：产品的首个闭环是“指定实验和研究问题 → 读取已有实验数据 → 统计与绘图 → 交付带数据来源、统计口径和分析代码的报告”。Agent 成为能够独立启动、升级并提供 API 的服务，供 LingSight 及其他客户端调用。取消现有专用的 SQL 生成、修复和单轮问答管线作为目标架构，但允许 Agent 通过 DBHub 查询数据；动物、训练日、聚合口径等领域定义继续保留。

这是从 ADR-0001 的“自建 Text-to-SQL 工程模块”转向“以科研任务及交付物为核心的 Agent 服务”。代价是需要明确任务状态、分析执行环境、结果溯源和服务契约；收益是数据连接能够复用现有 DBHub，科研能力不再局限于单次查询。取消专用管线不等于禁止 SQL，也不等于领域知识和统计校验可以取消。

已核实的数据入口为本机 DBHub → MySQL `water_maze_v3`。DBHub 当前暴露通用的 `search_objects` 与只读 `execute_sql`；账号 `wm_ro` 对 `water_maze` 与 `water_maze_v3` 均有库级 SELECT，因此 source 名称不等于仅限 v3 的数据边界。现有 DBHub 配置没有显式的行数/查询时间限制，不能继承原 Text-to-SQL 管线的 200 行/10 秒结论。运行事实见 [本地核查记录](../research/ai-native-platform-local-discovery.md)。

本 ADR 确认架构方向，不代表已经完成服务拆分、端点删除或数据源迁移。现有 LingSight 容器仍直接查询旧 `water_maze`。后续用户确认首期仅供个人使用，允许在独立分析环境运行 Agent 编写的 Python；初期 Agent 引擎选用 Pi SDK，见 [ADR-0010](0010-pi-sdk-as-initial-agent-engine.md)。界面组织、分析环境具体方案、任务生命周期、仓库布局及迁移方式继续访谈确定。
