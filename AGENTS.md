# AGENTS.md — LingSight AI 工程协作规则

本文件约束在本仓库工作的 AI 编码 Agent 与开发者。**当前项目是 LingSight AI（灵视科技）动物行为分析与科研智能体平台**，不是 Lab Agent、SalesPilot 或其他历史学习项目。

## 0. 导航指针

- **工单与流程**：[docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)（GitHub issues + `gh` 用法、阻塞边查询）；并行工单与分叉合并（含 merge-tree 预演）用 [docs/agents/parallel-tickets.md](docs/agents/parallel-tickets.md)。
- **本机跑全栈 Playwright**：用 `scripts/e2e-local.sh`；夹具 env、重跑清表与 bun/npm 漂移三个坑见 [docs/agents/local-e2e.md](docs/agents/local-e2e.md)。
- **领域词汇**：[GLOSSARY.md](GLOSSARY.md)。评审、口径与命名以此为准（如：语义层不说 MDL；动物 = (group_name, mouse_id)）。
- **已退役模块**：Text-to-SQL 管线与试次准备/核对/结果闭环已于 2026-11-10 删除（ADR-0014）；`water_maze_v3` 语义由独立 Agent 的版本化科研 Skills 与确定性函数承担，参见 ADR-0009 至 ADR-0013。trials 目录浏览与 metrics 管线暂留（annotations 页仍消费）。
- **真实科研库与新数据入口**：现行 LingSight 仍直连本机容器 `healthad-mysql` 的旧 `water_maze`（`lingsight_ro`）。新目标经现有 DBHub 连接 `water_maze_v3`；DBHub 的 `wm_ro` 现对旧库和 v3 都有 SELECT。v3 的表、动物映射及指标条件与旧库不同，不可只改数据库名或直接复用旧 schema。核查事实见 `docs/research/ai-native-platform-local-discovery.md`。凭据仅通过本机环境/运行配置取得，不回显、不入库。
- **科研管线权威实现在哪**：找冻结球弦朝向、v9 推理等各阶段的生产实现时先查 [docs/agents/research-code-map.md](docs/agents/research-code-map.md)——冻结球弦唯一生产实现在**本机** `~/wm_heading_v9_20261105/`（不是 A100；A100 上只有试点与 v9 推理）。
- **检查命令**：静态检查 = `cd backend && uv run bash scripts/lint.sh`（mypy strict + ty + ruff，覆盖 `app/` 与 `scripts/`）；完整测试 = `cd backend && bash scripts/test-local.sh`（每次独立临时 MySQL，退出销毁，不触碰 dev 库）。纯计算/转发测试可直接 `uv run pytest <files>`；需要持久化的测试必须显式使用 `TEST_DATABASE_URL` 且库名为 `lingsight_test_*`，缺配置即拒绝，不回退开发库。`env_gated` 执行层测试依赖真实研究库/LLM，门控探活失败自动 skip（CI 只跑结构层）。详见 local-e2e §4。独立脚本/探针要 `import app.*` 时先 `from tests.runtime import configure_application; configure_application()`（合成 settings，不读开发 .env；范例 `scripts/export_frontend_routes.py`）。评审判断型规则见 [CODING_STANDARDS.md](CODING_STANDARDS.md)。前端本机无 bun 时用 `scripts/fe.sh`（build / regen-routes / check|fix <files>，docker 跑仓库锁定的 bun 工具链，文件路径相对 frontend/；别用 `npm run lint`，见 local-e2e §3）。
- **进度事实**：[docs/progress.md](docs/progress.md)；决策依据在 [docs/adr/](docs/adr/)。

## 1. 当前目标与边界

- 2026-11-09 用户确认新目标：**科研任务工作区 + 独立仓库的科研 Agent 服务**，前期使用 Pi SDK，经 DBHub 查询 v3 数据，在本机独立分析环境完成统计绘图与可编辑报告。常规步骤自主执行，关键科研口径不清时提问，任务可后台运行并保留恢复依据。ADR-0001 的自建专用 Text-to-SQL 目标已由 ADR-0009 取代。
- 本仓库角色已收敛为 **React 科研工作台 + FastAPI 认证网关**（`routes/agent.py` → lingsight-agent、`routes/inference.py` → lingsight-inference，见 ADR-0014）。独立私有仓库 `tudousir123/lingsight-agent` 已实现并验收首个真实视频级闭环；本仓库个人工作区首轮本机接入完成（网关与前端已合并 main），完整科研闭环联验与正式部署仍待完成，见 `docs/evidence/agent-workspace/README.md` 与 `docs/evidence/backend-convergence/README.md`。不能将本仓库旧测试当作新服务能力证据。
- 平台基座保持 React+TS+Vite / FastAPI / MySQL；科研任务、步骤、Pi 会话关联和交付物由独立 Agent 服务拥有。首期个人使用；论文 RAG、自动 GPU 推理、多租户和 PDF/Word 排版不计入首个闭环。
- 优先小型可验收闭环，不因拆分新增不必要的基础设施；不把任务运行等同于单次模型回复。不同批次默认分开，未核验动物映射时只做注明状态的视频级探索，正式动物统计先核验映射。
- 目标架构不代表代码已实现。查阅 [README](README.md)、[产品规格](docs/01-product-spec.md)、[开发路线](docs/03-learning-roadmap.md) 和 [进度](docs/progress.md)，以实际源码和测试结果为准。

## 2. 工作流程

1. 动手前检查现有文件、依赖、配置、调用链及相关测试，**不臆测脚手架和数据库已有的功能**。
2. 每项变更先写清楚目标、接口、输入输出、失败路径及最小验收；优先小而可验证的改动。
3. 代码沿用现有项目结构和命名，避免无理由引入新框架、重复抽象或重写已工作的模块。
4. 必须执行与变更相关的测试/静态检查；无法执行时如实报告原因，不将“已写代码”等同“已验证”。
5. 交付说明包含：修改文件、设计取舍、运行/测试命令及结果、尚未解决的问题。
6. 用户希望亲自掌握代码：关键设计和复杂实现要能解释职责、调用链和异常边界，不把决策完全外包给 Agent。

## 3. 历史约束：Text-to-SQL 管线（已退役，见 ADR-0014）

以下原则在旧管线删除后由独立 Agent 服务与网关继承，评审新链路时仍适用：

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
- 给视觉模型重传改过的影像产物时**一律换新文件名**：CDN 对同名文件返回旧版，模型会读到过期画面（曾把已画标注的图当成未标注）。

## 5. 安全、仓库和文档纪律

- 不提交 API Key、密码、真实客户/科研原始数据、大型模型权重或无授权的第三方源码/ZIP；先审查脚手架 LICENSE、依赖和敏感配置。
- 主树提交一律**显式文件路径** add（禁 `git add -A`/`-u`/`commit -a`）：本机常有多个会话共用主工作树，并行 WIP 随时在场（2026-11-10 实例：retro 提交时另一会话的营销页 WIP 共存树中）。
- 不删除未经确认的既有业务代码或历史 Git 记录；结构迁移先核对差异和可恢复路径。
- README 是项目入口；规格、路线和进度各维护一份，不新增相互冲突的 V2/V3 文档。
- 不声称模型运行、性能指标、测试通过或部署完成，除非存在实际证据。
