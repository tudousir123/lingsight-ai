# LingSight AI · 开源方案选型记录

状态：2026-10-12，架构参考，**不表示已集成代码或完成运行测试**。

| 部分 | 首期候选 | 理由与边界 |
|---|---|---|
| Vue + FastAPI | 青戈脚手架 | 需先获取用户提供的 ZIP 并核验源码结构、许可、依赖及密钥；当前未入库 |
| Text-to-SQL Agent | [LangGraph](https://github.com/langchain-ai/langgraph) SQL Agent 教程 | 复用 Agent 状态、SQL 生成/执行/错误反馈模式；不用直接挂生产数据库 |
| 领域语义层 | [WrenAI](https://github.com/Canner/WrenAI) | 借鉴 MDL 的关系、业务指标、查询语义；第一期不部署完整 WrenAI |
| SQL AST | [SQLGlot](https://github.com/tobymao/sqlglot) | AST 解析与方言校验；不代替 DB 只读权限、白名单、超时限制 |
| RAG | [RAGFlow](https://github.com/infiniflow/ragflow) | 作为可选独立文档/检索服务，需实测版本、资源和 API；非 Agent Runtime 替代品 |
| 文档解析 | RAGFlow DeepDoc、[MinerU](https://github.com/opendatalab/MinerU)、[Docling](https://github.com/docling-project/docling) | 用真实科研 PDF 做对照，版本及授权要实际检查 |
| CV / 追踪 | [SLEAP](https://github.com/talmolab/sleap)、[Lightning Pose](https://github.com/paninski-lab/lightning-pose)、[Grounded-SAM-2](https://github.com/IDEA-Research/Grounded-SAM-2) | 设计灵感，不覆盖既有自研模型；实际采用须有测试结果 |

## 审查下一步
1. 核对青戈 ZIP 的 LICENSE、目录、依赖、框架版本、数据库模式及是否包含敏感配置。
2. 对现有 Animal 数据库作只读 Schema 审查，设计实验语义层。
3. 为 SQL 和科研 RAG 各自建立带人工基准答案的 QA 回归集。
4. 将依赖固定到经测试的版本，不以“最新”代替兼容性测试。

原有 SalesPilot 和 Lab Agent 学习方案不再作为本仓库产品路线。