# LingSight AI 产品与技术架构（V0.1）

## 核心目标
基于动物实验视频提供自动场景感知、鼠体 Mask/头尾 Pose、Tracking、可回溯行为指标，以及 SQL + 文献双知识源科研 Agent。

## 交付边界
- 第一范式：Morris 水迷宫。
- UI：青戈 Vue + FastAPI 项目（待 ZIP 核验与导入）。
- Agent：一期使用云端 API；单主 Agent 通过 typed Tool 调用 SQL、统计、科研 RAG。
- 隐藏平台不可见时需元数据/校准输入，不能生成猜测坐标。
- 首次出现、首次入水、碰台、有效上台等事件分别定义并评测。

## Text-to-SQL 设计
**输入**：实验 ID、自然语言、用户身份。
**步骤**：权限与意图识别 → 相关 Schema / 指标术语检索 → 查询计划 → LLM SQL → SQLGlot AST 校验 → 只读 MySQL 限时执行 → 数据粒度/空值检查 → 可复现的统计解释。
**领域语义层**：experiment、animal、group、trial、training_day、frame、metric；按真实数据库核实字段后才固定 Schema。必须定义“逐鼠-逐日-逐组”聚合口径。
**安全**：服务端账户只读；可查询视图/列白名单；LIMIT/执行超时/资源限额；脱敏、租户实验权限和审计。
**失败**：错误分型、有限次 SQL Repair，超过限制明确报告错误，不让模型编造结果。
**验收**：20–30 条真实科研 QA，与人工审核 SQL 和数值比对；另测越权、不可执行 SQL、错误统计粒度。

## 科研 RAG 设计
以 RAGFlow 为候选独立服务；测试真实论文 PDF 与实验手册，比较文档解析、标题/表格结构、Chunk、Metadata、BM25+Dense、RRF+Reranker；简单检索直接回复，多跳/证据不足时由 Agent 限定次数重检索并验证文献引用。
数据与文献分开：MySQL 存实验观测，RAG 索引存解释性知识；LLM 不能替代 Python 统计。
**验收**：Recall@K/MRR，文献引用支持率，证据不足拒答准确性，任务耗时和成本。

## CV 与推理
专用分割/关键点模型 + Tracking，输出 frame_id、mask/pose、置信度、轨迹、场景/模型版本。GPU Worker 与 API 解耦；任务支持明确状态与去重。评估 IoU/PCK、事件帧误差、端到端免手工操作比例。

## V1 暂不做
本地 V100 部署、多 Agent、复杂知识图谱、SFT/DPO/GRPO、完全自动论文结论推断。
