# LingSight AI 进度（事实优先）

更新时间：2026-10-12

| 项目 | 状态 | 证据 / 待办 |
|---|---|---|
| 产品与选型 | **文档已确定** | 以 README 和 docs/01-product-spec.md 为准 |
| GitHub 仓库正式更名 | **待执行** | 当前连接器无重命名操作，需要在 GitHub Settings 手动完成 |
| 脚手架选型 | **FastAPI 官方 full-stack-fastapi-template（已落地）** | ADR-0002；MIT、React+TS+Vite、SQLModel+Alembic、JWT、Docker/CI/Playwright |
| M0 脚手架验收（工单 #2） | **已验收（2026-10-12）** | 一键 `docker compose up -d --wait` 全 healthy；MySQL 8.4 适配（pymysql/CHAR(36)/迁移重建，ADR-0005）；模板自带测试全绿：pytest 58/58（coverage 92%）、Playwright 62/62；证据 `docs/evidence/m0/`。偏离：asyncmy→pymysql（模板为同步数据层） |
| Text-to-SQL | **选型与 M1 前置全部完成，待出 Spec 开工** | 2026-10-12：评测集 v1 完成（docs/09：25 问 + 标准 SQL + 黄金基准值实算）；`platform_positions` 已入库（E1 CSV 8 行，含 Probe 靶区）；事件定义验证决策前置 M1 中段；video=试次按 1:1 获认可；只读账户 `lingsight_ro` 五表白名单已验证（备份表/写操作/巨型表全拒）。遗留数据疑点：qc_status 517/549 review 语义待确认、coord 溯源（A100），见 docs/09 |
| M1-T2 语义层 v1（工单 #3） | **已完成（2026-10-12，提交 b315588）** | `backend/app/text_to_sql/semantic_layer.yaml` 唯一事实来源（ADR-0004）：7 条目（5 已授权表 + platform_positions + trial_metrics 占位）；加载器同源渲染提示词上下文与 AST 白名单；三大陷阱（animal_code/session_label/trial_no）纠正口径 10 项测试锁定；mask_rle_* 全表不可达；双轴 code-review 修订（date_dir 补 0809 探测日、未暴露表的 join 路径不进提示词）。术语对齐：ADR-0004 已删自造词「MDL-lite」（2026-10-13 用户裁决，GLOSSARY 统一用「语义层」） |
| M1-T3 指标表（工单 #4） | **已完成（2026-10-13，合并 778e906）** | `trial_metrics` 落 water_maze（549 视频 × 4 指标 × v1-polyline-ok-frames，2196 行）：dist_px/speed_px/valid_kp_ratio/in_pool_ratio，含算法版本/单位/计算状态；幂等整版替换；黄金矩阵 60/60 格 PASS（最大漂移 0.084%，源于 2026-10-11 数据刷新 ok+265 帧，容差 0.5%，证据 docs/evidence/m1-t3/）；lingsight_ro SELECT 已授并验证；语义层 trial_metrics 条目定稿 exposed: true |
| M1-T4 查询管线 tracer（工单 #5） | **已完成（2026-10-13，合并 778e906）** | POST /api/v1/research/query 全链路：语义上下文 → 薄 Model Gateway（env 配置，OpenAI 兼容）→ SQLGlot 校验（白名单/单 SELECT/禁跨库/强制 LIMIT）→ lingsight_ro 限时执行 → 口径声明结构化回答；修复环 1 次；演示题真库返回 6（≠26）；D21-23 类型化拒绝；凭据全 env（.env.example 占位）；无 LangGraph/LangChain，新增依赖仅 sqlglot。LLM key 已配（智谱 glm-5.3，.env，不入库）；账户余额不足（1113）暂无法直跑，充值后 `cd backend && uv run python scripts/demo_query.py "一共有多少只动物"` 即可 |

| 科研 RAG | **未开始实现** | 先做文献来源与评测集 |
| Agent 集成 | **未开始实现** | M3 |
| CV / Tracking 联通 | **待接入与测试** | 既有平台成果不等于本仓库已经集成 |

说明：旧 SalesPilot/Lab Agent 学习资料不是 LingSight AI 的当前产品开发路线；历史资料有参考价值时另行归档，不冒充产品源码。
