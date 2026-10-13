# LingSight AI · 灵视科技

> **Animal Behavior Intelligence Platform** — 面向动物行为科研的视频智能分析与科研 Agent 平台。

**状态：V0.1 设计与工程初始化。** 当前仓库是 LingSight AI 的开发仓库；文档描述目标架构与验收标准，不代表所有能力已经在本仓库完成。原有 `animal_platform_v2` 仓库名称需在 GitHub Settings 中重命名为 `lingsight-ai`（当前集成没有仓库改名操作）。

## 为什么做

让科研人员无需逐视频手动圈选水池、标志物和小鼠，便能从实验视频获得可信的轨迹、姿态、行为指标，再用自然语言查询实验数据、获取相关论文证据。

核心原则：**视觉模型产生观测，确定性代码负责计算，SQL 负责检索结构化数据，RAG 负责提供文献证据，Agent 负责组织任务。**

## 产品范围

- **视觉感知**：自动场景标定（水池边界、可见标志物、可见平台）、小鼠 Mask、头尾关键点、Tracking、首帧/事件识别。不可见隐藏平台必须使用实验元数据或校准信息，不能从像素凭空定位。
- **推理服务**：视频上传、GPU Worker 异步推理、任务状态、模型和数据版本、可回溯的逐帧数据及 Overlay。
- **科研智能体**：自然语言 → Text-to-SQL → 只读 MySQL → Python 统计/绘图；按需检索实验规范和论文，通过 RAG 返回可核实引用，必要时拒答。
- **扩展范式**：优先水迷宫，逐步扩展到 Y 迷宫、旷场和悬尾。

## 第一阶段技术选型（云端 API 优先）

| 层 | 方案 |
|---|---|
| 全栈 | **FastAPI 官方 full-stack-fastapi-template**（MIT；React+TS 前端；默认 PostgreSQL，适配 MySQL 后使用，实验数据仍以本机 MySQL 为权威，见 ADR-0002） |
| LLM | 云端 API，经过可替换的 Model Gateway |
| Agent | Python 单主 Agent + 工具接口；Text-to-SQL 参考 LangGraph SQL Agent |
| SQL | SQLAlchemy + SQLGlot + 只读数据库账户 + 白名单 Schema + 执行限额 |
| 科研语义层 | 训练日、动物、实验组、试次、指标单位与统计粒度定义（借鉴 WrenAI） |
| RAG | RAGFlow 文档/基础检索 + 混合检索与 Reranker；业务 Agent 负责证据检验 |
| 数据 | MySQL（实验/指标/任务权威数据）+ Redis（按需缓存/任务协调） |
| CV | 已有训练的小模型 + Tracking + GPU Worker；模型细节按实际代码确认 |

本阶段**不引入**多 Agent、私有化 LLM、WrenAI/DB-GPT 整套平台、LightRAG、SFT/RL。后续如有 V100 客户需求，依据同一套回归测试决定本地模型选型。

## 端到端工作流

```text
React UI → FastAPI
  ├─ Video Jobs → GPU Worker → 场景分割 / 小鼠 Mask / Pose / Tracking
  │                            → 帧级轨迹与行为指标 → MySQL
  └─ Research Agent
       ├─ Text-to-SQL → Schema Linking / Semantic Layer → SQL AST 校验
       │              → 只读 MySQL → 结果校验 → Python 统计 / 绘图
       └─ Scientific RAG → 文档解析 → 混合召回 / Reranker
                           → Evidence Grader → 引用验证
                        → 带数据来源、模型版本和文献证据的回答
```

## 从 0 到 1 的实施顺序

1. **M0 基础就位**：导入 FastAPI 官方 full-stack-fastapi-template（MIT），完成 PostgreSQL→MySQL 适配；确认 FastAPI、React 前端和本地配置可启动，保存启动/测试记录。
2. **M1 Text-to-SQL 最小闭环**：对现有 MySQL 建立只读账号、允许查询的视图和科研语义字典；实现查询计划、SQL 校验、执行与错误反馈。用 20–30 个真实问题对人工 SQL 标准答案进行对照。
3. **M2 科研 RAG**：导入一批授权论文及实验手册，评估 PDF 解析、Chunk、混合检索、Rerank、证据完整性和引用。
4. **M3 Agent 集成**：自然语言协同调用 SQL、Python 统计与 RAG 工具，输出可回溯图表和回答。
5. **M4 视觉链路接入与综合验收**：联通模型推理产物、实验数据和科研 Agent；验证视频→指标→查询→报告全过程。

每个里程碑以**真实运行记录和测试通过**为完成标准，不以 README 或代码生成作为完成证据。

## M1 当前状态（2026-10-13，以运行记录为准）

Text-to-SQL 最小闭环已端到端跑通并留档（除人机协作的事件定义票 #6 挂起外全部收口）：

- **语义层**（[ADR-0004]）：`backend/app/text_to_sql/semantic_layer.yaml` 唯一事实来源，同源渲染 LLM 提示词与 SQLGlot 白名单；三大口径陷阱（animal_code/session_label/trial_no）测试锁定。
- **指标表**（[ADR-0003]）：`trial_metrics` 由确定性 Python 预计算（算法版本化、重跑幂等）；组×日黄金矩阵 60/60 验证，库刷新后可重算再生。
- **查询管线**：`POST /api/v1/research/query`——生成→校验（白名单/单 SELECT/强制 LIMIT）→ `lingsight_ro` 限时执行 → 有界修复（≤2 次，权限零放宽、空结果零篡改）→ 口径声明回答。真实 LLM（本地代理 gemini-3.8-flash）演示：『一共有多少只动物』→ **6**（非陷阱值 26）。
- **安全**：备份表/写操作/跨库实测拒绝；mask 族列按用户决策开放（[ADR-0007]），帧级唯一入口为 `v_query_frame_predictions` 视图；凭据全环境变量。
- **评测**（[docs/09]）：25 问黄金评测集双层套件，正式基线 **25/25（A 9/9、B 5/5、C 6/6、D 5/5）**，证据 `docs/evidence/m1-t6/`；端到端演示链路 `docs/evidence/m1-t9/demo/`。

[ADR-0003]: docs/adr/0003-metrics-deterministic-python.md
[ADR-0004]: docs/adr/0004-yaml-semantic-layer.md
[ADR-0007]: docs/adr/0007-open-mask-columns-to-query-surface.md
[docs/09]: docs/09-golden-qa-draft.md

## 安全和科研可信度

- 禁止让 LLM 直接执行任意 SQL；SQLGlot AST 是防护之一，**数据库只读权限、表列白名单、超时和行数限制**必须在服务侧实现。
- 对动物/试次/视频/天/实验组规定不同统计粒度；SQL 执行成功不等于科研统计正确。
- 每条分析结果保留实验 ID、模型版本、数据版本、计算参数；论文解释必须能追溯到文献来源。
- 禁止提交客户数据、实验原视频、API Key、数据库凭据、模型大权重及无授权的第三方脚手架代码。

## 项目文档

- [产品与架构](docs/01-product-spec.md)
- [分阶段开发计划](docs/03-learning-roadmap.md)
- [工程进度与证据](docs/progress.md)
- [AI 协作与评审协议](docs/07-design-guided-learning.md)

## 参考项目（灵感来源，不代表已作为依赖）

[LangGraph](https://github.com/langchain-ai/langgraph) · [WrenAI](https://github.com/Canner/WrenAI) · [RAGFlow](https://github.com/infiniflow/ragflow) · [Lightning Pose](https://github.com/paninski-lab/lightning-pose) · [SLEAP](https://github.com/talmolab/sleap) · [Grounded-SAM-2](https://github.com/IDEA-Research/Grounded-SAM-2)

## License

应用代码基于 [FastAPI 官方 full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template)（MIT）；其余引用的开源项目按各自许可证使用。仓库内禁止上传无再分发授权的第三方代码、私人科研数据与密钥。
