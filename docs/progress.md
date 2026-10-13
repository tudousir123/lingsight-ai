# LingSight AI 进度（事实优先）

更新时间：2026-10-13

| 项目 | 状态 | 证据 / 待办 |
|---|---|---|
| 产品与选型 | **文档已确定** | 以 README 和 docs/01-product-spec.md 为准 |
| GitHub 仓库正式更名 | **待执行** | 当前连接器无重命名操作，需要在 GitHub Settings 手动完成 |
| 脚手架选型 | **FastAPI 官方 full-stack-fastapi-template（已落地）** | ADR-0002；MIT、React+TS+Vite、SQLModel+Alembic、JWT、Docker/CI/Playwright |
| M0 脚手架验收（工单 #2） | **已验收（2026-10-12）** | 一键 `docker compose up -d --wait` 全 healthy；MySQL 8.4 适配（pymysql/CHAR(36)/迁移重建，ADR-0005）；模板自带测试全绿：pytest 58/58（coverage 92%）、Playwright 62/62；证据 `docs/evidence/m0/`。偏离：asyncmy→pymysql（模板为同步数据层） |
| Text-to-SQL | **选型与 M1 前置全部完成，待出 Spec 开工** | 2026-10-12：评测集 v1 完成（docs/09：25 问 + 标准 SQL + 黄金基准值实算）；`platform_positions` 已入库（E1 CSV 8 行，含 Probe 靶区）；事件定义验证决策前置 M1 中段；video=试次按 1:1 获认可；只读账户 `lingsight_ro` 五表白名单已验证（备份表/写操作/巨型表全拒）。遗留数据疑点：qc_status 517/549 review 语义待确认、coord 溯源（A100），见 docs/09 |
| M1-T2 语义层 v1（工单 #3） | **已完成（2026-10-12，提交 b315588）** | `backend/app/text_to_sql/semantic_layer.yaml` 唯一事实来源（ADR-0004）：7 条目（5 已授权表 + platform_positions + trial_metrics 占位）；加载器同源渲染提示词上下文与 AST 白名单；三大陷阱（animal_code/session_label/trial_no）纠正口径 10 项测试锁定；mask_rle_* 全表不可达；双轴 code-review 修订（date_dir 补 0809 探测日、未暴露表的 join 路径不进提示词）。术语对齐：ADR-0004 已删自造词「MDL-lite」（2026-10-13 用户裁决，GLOSSARY 统一用「语义层」） |
| M1-T3 指标表（工单 #4） | **已完成（2026-10-13，合并 778e906）** | `trial_metrics` 落 water_maze（549 视频 × 4 指标 × v1-polyline-ok-frames，2196 行）：dist_px/speed_px/valid_kp_ratio/in_pool_ratio，含算法版本/单位/计算状态；幂等整版替换；黄金矩阵 60/60 格 PASS（最大漂移 0.084%，源于 2026-10-11 数据刷新 ok+265 帧，容差 0.5%，证据 docs/evidence/m1-t3/）；lingsight_ro SELECT 已授并验证；语义层 trial_metrics 条目定稿 exposed: true |
| M1-T4 查询管线 tracer（工单 #5） | **已完成（2026-10-13，合并 778e906）** | POST /api/v1/research/query 全链路：语义上下文 → 薄 Model Gateway（env 配置，OpenAI 兼容）→ SQLGlot 校验（白名单/单 SELECT/禁跨库/强制 LIMIT）→ lingsight_ro 限时执行 → 口径声明结构化回答；演示题真库返回 6（≠26）；D21-23 类型化拒绝；凭据全 env（.env.example 占位）；无 LangGraph/LangChain，新增依赖仅 sqlglot。**真 LLM 直跑已通（2026-10-13）**：本地 Hermes/antigravity 代理（gemini-3.8-flash，key 在 .env 不入库）——演示题返回 6+口径声明；黄金题 Q3 命中基准（A3/79.69 px/s，LLM 自行锚定 trial_metrics+逐鼠-逐日口径）。智谱 key 余额不足（1113）暂弃用 |
| M1-T5 SQL Repair 完整化（工单 #8） | **已完成（2026-10-13，合并收口）** | 重试预算 ≤2 次按错误分型：语法类回喂重试（markdown 围栏先剥离不耗预算）；权限类可改写重试但白名单+行数上限每 run 冻结（spy 断言同对象、提示词明示不放宽）；执行/超时零重试类型化失败；空结果走成功通道（SQL 逐字不变+empty 标记+建议文案）；attempts/trace 审计字段入响应。附带：sqlglot ParseError 的 ANSI 转义剥离 |
| M1-T8 v_query_* 只读视图（工单 #7） | **已完成（2026-10-13，合并收口）** | `v_query_frame_predictions` 视图（幂等 DDL 单一事实源 `views.py` + 可重放脚本）：12 精选列；mask_rle_counts 视图层物理不可达（实测 Unknown column）；基表直查账户层拒绝（实测 1142）；语义层白名单/AST 切换指向视图（`view_of` 血缘 + 双入口拒绝校验）；证据 `docs/evidence/m1-t8/` |
| mask 族列开放（工单 #15） | **已完成（2026-10-13）** | 用户决策「需要开放mask」反转 #3/#7 排除锁定（ADR-0007）：视图 12→24 列（RLE/解码参数/质心/面积/bbox/valid），白名单/AST/提示词同步、RLE 带长文本 caution；IoU 内部列维持物理不可达；D24 期望反转（经视图小范围读 RLE 为允许，行数上限兜底）；真库已重放 DDL 并实测（证据 m1-t8/03）；#9 评测按新事实编码 |
| M1-T9 收口（工单 #10） | **进行中（关票被 #9/#6 阻塞）** | 2026-10-13：端到端演示链 7 场景归档（m1-t9/demo：成功链路 + D21–23 类型化拒绝 + 模型自觉实证）；全量回归 120 passed / 覆盖率 90%（m1-t9/01）；/code-review 双轴通过（m1-t9/02）——修复审计日志服务端缺口（pipeline logger，每次尝试+终局落日志，含测试锁定）与 docs/09 D24 反转遗漏（ADR-0007）；README/spec/source-audit 口径同步。剩余：25 问全量评测待 #9 评测套件、事件口径确认待 #6，两者关闭后 #10 收口 |

| 科研 RAG | **未开始实现** | 先做文献来源与评测集 |
| Agent 集成 | **未开始实现** | M3 |
| CV / Tracking 联通 | **待接入与测试** | 既有平台成果不等于本仓库已经集成 |

说明：旧 SalesPilot/Lab Agent 学习资料不是 LingSight AI 的当前产品开发路线；历史资料有参考价值时另行归档，不冒充产品源码。
