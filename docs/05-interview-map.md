# LingSight AI · 开发即面试验收

每项实现完成后才记录有证据的工程故事：业务问题 → 技术选择 → 模块边界 → 失败处理 → 测试结果 → 本人贡献。

## Text-to-SQL
- 为什么需要领域 Semantic Layer、Schema Linking？
- SQLGlot AST、DB 只读账号、实验 ACL 分别防什么？
- SQL 能执行但动物/试次/训练日粒度算错，如何检测？
- SQL Repair 的重试次数、错误分类与独立评测怎样设计？
- 如何通过标准 SQL 和期望值评测，而非只看执行成功率？

## RAG / Agent
- 论文 PDF 布局、表格与引文怎样保留？
- BM25、Dense、RRF、Reranker 为什么一起使用？
- Agentic Retrieval 怎样触发 Query Rewrite、重检索、拒答？
- 统计事实来自 MySQL，文献解释来自 RAG，如何避免混淆？
- Tools、Context、超时、权限、Trace 如何处理？

## 视觉模型 / GPU / 后端
- 分割 IoU、关键点 PCK、事件帧误差和最终行为指标正确性为何不等价？
- Tracking 出现丢帧和头尾翻转怎样恢复？
- FastAPI 的数据库 Session、异步 I/O、GPU 长任务如何分层？
- Redis 与 MySQL 的职责，Job 幂等和 Worker 故障如何处理？

项目面试资料优先参考 [Notion 双主线面试题库](https://app.notion.com/p/3f6f39fdf94881ce814fdd8233e295a3?pvs=204)。本仓库不复制完整题库，避免双份维护。
