# AGENTS.md — LingSight AI 工程协作规则

本文件约束在本仓库工作的 AI 编码 Agent 与开发者。**当前项目是 LingSight AI（灵视科技）动物行为分析与科研智能体平台**，不是 Lab Agent、SalesPilot 或其他历史学习项目。

## 0. 导航指针

- **工单与流程**：[docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)（GitHub issues + `gh` 用法、阻塞边查询）；并行开发两张工单时用 [docs/agents/parallel-tickets.md](docs/agents/parallel-tickets.md) 的 worktree 配方。
- **领域词汇**：[GLOSSARY.md](GLOSSARY.md)。评审、口径与命名以此为准（如：语义层不说 MDL；动物 = (group_name, mouse_id)）。
- **语义层唯一事实来源**：`backend/app/text_to_sql/semantic_layer.yaml`。改 water_maze 表结构、暴露面或口径，先改这份 YAML，再同步库与测试——提示词上下文与 AST 白名单都从它渲染，禁止手写第二份。
- **真实科研库**：本机容器 `healthad-mysql` 的 `water_maze` 库；root 凭据只存在于容器 env（`docker exec healthad-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" …'`，不回显不入库）；应用侧只读账户 `lingsight_ro`（密码在根 `.env`，不入库）。
- **进度事实**：[docs/progress.md](docs/progress.md)；决策依据在 [docs/adr/](docs/adr/)。

## 1. 当前目标与边界

- M0 脚手架已验收（2026-10-12）；当前推进 **M1 Text-to-SQL 最小闭环**，之后才推进科研 RAG、Agent 集成、视觉推理链路。
- 技术栈：React+TS+Vite 前端 + FastAPI 官方 full-stack 模板（ADR-0002，PostgreSQL→MySQL 适配 ADR-0005）；Text-to-SQL 借鉴 WrenAI 语义层与 LangGraph SQL Agent 思想但**自建轻量管线**（ADR-0001，不引入其运行时）。
- 第一阶段不做本地 LLM、多 Agent、SFT/RL、大规模重构或不必要的基础设施。
- 目标架构不代表代码已实现。查阅 [README](README.md)、[产品规格](docs/01-product-spec.md)、[开发路线](docs/03-learning-roadmap.md) 和 [进度](docs/progress.md)，以实际源码和测试结果为准。

## 2. 工作流程

1. 动手前检查现有文件、依赖、配置、调用链及相关测试，**不臆测脚手架和数据库已有的功能**。
2. 每项变更先写清楚目标、接口、输入输出、失败路径及最小验收；优先小而可验证的改动。
3. 代码沿用现有项目结构和命名，避免无理由引入新框架、重复抽象或重写已工作的模块。
4. 必须执行与变更相关的测试/静态检查；无法执行时如实报告原因，不将“已写代码”等同“已验证”。
5. 交付说明包含：修改文件、设计取舍、运行/测试命令及结果、尚未解决的问题。
6. 用户希望亲自掌握代码：关键设计和复杂实现要能解释职责、调用链和异常边界，不把决策完全外包给 Agent。

## 3. Text-to-SQL 不可违反的约束

- LLM **只能提出查询候选**，不能持有生产数据库写入权限或执行任意 SQL。
- 数据库账户只读，使用允许的表/视图/列清单与实验访问控制；SQL AST 校验、查询超时、结果行数上限和审计日志必须在服务端强制执行。
- 不将真实实验数据、访问凭据、内部 Schema 或敏感科研资料未经授权发送到云端模型。
- 区分 experiment、animal、trial、training_day、frame 的统计粒度；指标、单位、筛选口径来自经过确认的语义定义，**SQL 能运行不等于科研统计正确**。
- SQL 执行异常按类型有限次重试；对结果无依据的情况返回不确定/无法查询，不编造数据。
- 以人工确认的 SQL/期望数值构建回归集，覆盖正常、歧义、空结果、越权、危险 SQL 和统计粒度错误。

## 4. 科研 RAG 与视觉结果

- 实验数据以数据库与确定性计算为准；文献观点以可追溯文献片段和出处为准。LLM 不替代统计检验，也不编造论文引用。
- 先验证基本文档解析、混合检索、重排和引用，再增加复杂 Agentic Retrieval。
- 隐藏水迷宫平台不可见时须读取实验元数据/校准信息，不能仅从视频像素猜测；“朝向标志物”不能直接表述为“看到标志物”。
- 模型评测区分 Mask IoU、关键点误差、Tracking、行为事件与科研指标的端到端正确性。

## 5. 安全、仓库和文档纪律

- 不提交 API Key、密码、真实客户/科研原始数据、大型模型权重或无授权的第三方源码/ZIP；先审查脚手架 LICENSE、依赖和敏感配置。
- 不删除未经确认的既有业务代码或历史 Git 记录；结构迁移先核对差异和可恢复路径。
- README 是项目入口；规格、路线和进度各维护一份，不新增相互冲突的 V2/V3 文档。
- 不声称模型运行、性能指标、测试通过或部署完成，除非存在实际证据。
