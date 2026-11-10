# 后端收敛记录

2026-11-09 用户委托：并行开发后统一后端职责，自主完成改造和验证。

## 目标与取舍

保持现有浏览器契约、同步 MySQL、科研指标口径及独立 Agent 对科研任务/交付物的所有权。先集中配置与测试环境，再收拢同一试次的素材规则。旧问答仍保留，不将旧 `water_maze` 配置改名冒充 v3。

| 改造 | 输入 / 输出与职责 | 失败路径 | 最小验收 |
| --- | --- | --- | --- |
| 测试运行环境 | 合成应用配置、显式测试数据库 → 可重复测试；数据库初始化仅由依赖它的测试触发 | 缺少测试连接或指向非专用库时拒绝；临时容器退出清理 | 纯计算/转发测试不连接开发库；完整测试在临时 MySQL 上运行 |
| 科研库配置归属 | 旧库只读配置归独立配置 module；问答配置复用它 | 缺配置保持原错误语义；变量名与只读/超时约束兼容 | 实验浏览不再导入 text_to_sql 配置；旧问答测试通过 |
| 试次素材与核对 | 实验、试次、素材来源 → 一致可用性、准备/结果与核对版本 | 缺素材显式返回原因；素材变化使旧核对版本失效 | 映射源视频与 overlay 的目录/详情一致；同帧数轨迹修正和同尺寸媒体替换可识别 |
| 科研任务转发 | 保留现有个人工作区许可、转发白名单、事件游标及交付物下载 | 保留现有 403/404/413/422/502/503 | 现有契约测试纳入统一 pytest，无开发库依赖 |

不引入队列、通用 repository 或全量异步迁移。模型生成 SQL 的白名单与确定性指标计算保持原职责。实现时以当前工作区为基线，保留已有未提交的联调工作。

## 审查证据

- `tests/conftest.py` 原全局 autouse 数据库夹具会删除开发库全部 User/Item；`test_views` 和 `test_store` 也直接执行 DDL。
- 准备、结果、核对分别拼装同一试次素材；目录用数据库原始路径检查文件，详情使用本地路径映射并优先 overlay。
- 已用合成数据复现：修改轨迹中心坐标但保留帧数，原 `source_version` 不变。
- 改造前静态检查在临时 mypy/ruff 缓存下通过，转发 unittest 9/9 通过；默认缓存目录权限异常，与源码检查失败不同。

## 验收

完成平台后端这一轮收敛；源码尚未部署到现有平台容器。2026-11-10 用户追加的独立 Pi Agent 后端已更新并验收，独立仓库记录完整运行证据。

| 命令 / 场景 | 结果 | 证据 |
| --- | --- | --- |
| `cd backend && uv run bash scripts/lint.sh`（`MYPY_CACHE_DIR`、`RUFF_CACHE_DIR` 指向新建临时目录） | mypy：64 files；ty、ruff、format 全通过 | [lint.log](lint.log) |
| `cd backend && bash scripts/test-local.sh -q -m 'not env_gated' -p no:cacheprovider` | 261 passed、45 deselected；coverage 87% | [pytest.log](pytest.log) |
| 临时库升级、插入旧核对、再升级及有损降级拒绝 | 1 passed；旧记录不变，多版本存在时降级拒绝且保留两条记录 | [migration-validation.log](migration-validation.log) |
| 未提供 / 空 TEST_DATABASE_URL，误配 app 库 | 均在连接前拒绝，返回测试运行指引 | [database-guard.log](database-guard.log) |
| FastAPI → 临时 Node Agent HTTP 契约（合成任务） | 通过；覆盖 SSE、报告编辑、ZIP、澄清、取消等 | [platform-agent-contract.log](platform-agent-contract.log) |
| 无数据库运行计算、派生、转发与配置检查（第一轮） | 59 passed | 本会话终端输出 |

迁移复验源文件为 [review_migration_check.py](review_migration_check.py)，从 backend 执行 `bash scripts/test-local.sh ../docs/evidence/backend-convergence/review_migration_check.py -q -p no:cacheprovider`。首次验证使用内容相同的临时文件 `/tmp/test_lingsight_review_migration.py`。该用例会改变测试库 schema，只通过独立临时容器运行。

独立复查补充修复：核对写入在已存在的用户行上加锁后读取/修改，同版本并发草稿与确认不会覆盖确认终态；无记录首建也能串行化。并发 HTTP 用例已纳入 261 项。测试 runner 支持准确选择单文件，空连接字符串按未配置处理。

## 修改文件与职责

- 配置：`backend/app/core/settings.py`、`core/config.py`、`core/research.py`、`text_to_sql/settings.py`。
- 试次：`backend/app/trials/{media,assets,catalog,derive,fixture_store,schemas,service}.py`、`api/routes/trials.py`。
- 持久化：`backend/app/models.py`、`app/alembic/versions/d4e5f6a7b8c9_review_source_versions.py`。
- 验证：`backend/tests/runtime.py`、`conftest.py`、新配置/媒体/版本/并发测试，既有数据库测试显式依赖隔离 fixture；测试脚本和 `.github/workflows/test-backend.yml` 使用同一 runner。
- 说明：AGENTS、GLOSSARY、backend/README、local-e2e、当前架构与本记录。已有 Agent gateway 源码与前端工作保留。

## 升级与限制

更新平台运行版本前执行 Alembic `upgrade head`。旧核对记录不删除；增强后的素材版本与旧计数型版本不等价，因此旧确认不自动变成当前素材的确认。对同一新版本重新核对后产生新记录；本轮未在开发库执行迁移，也未重启平台容器。

媒体内容首次读取需要计算 SHA-256，随后按文件设备/inode/大小/纳秒修改及变更时间缓存；未做真实大视频性能测量。素材读取是一个请求内的统一规则，不宣称跨文件和数据库的原子快照。真实科研库/LLM 与前端 E2E 未在本轮执行。保留的 Starlette TestClient/httpx 弃用提示不是测试失败。旧 root-owned mypy/ruff 缓存未修改，验证使用独立可写缓存。

## 可视化报告

本机报告 `/tmp/architecture-review-20261110-000138.html` 已用 Chrome 打开；两幅 Mermaid 渲染成功，已检查 1440×1000 截图。报告包含四个候选的 before/after、取舍与已实施状态。报告在系统临时目录，不新增第二份架构规格。

跨仓联调脚本：[platform_agent_contract.py](platform_agent_contract.py)，在 `backend` 下运行 `uv run python ../docs/evidence/backend-convergence/platform_agent_contract.py`；依赖同级 `lingsight-agent` 仓库的 `scripts/contract-fixture.ts`，使用临时 Node 服务与 SQLite，不访问科研数据库或模型。


## 2026-11-10 独立评审与复核

- 平台数据迁移改用单条 MySQL ALTER，同时识别旧实现可能留下的双索引中间态；临时库验证中断升级、降级续跑及禁止丢失多版本历史，见 [migration-review.log](migration-review.log)。
- 测试数据库改用 MySQL advisory lock，按数据库实体加锁，不依赖 URL 用户名、密码或主机别名；主工作区结构测试 263 passed、45 deselected、coverage 86%（当时已出现并行开发的推理模块），见 [pytest-final.log](pytest-final.log)；评审分支另行独立测试。
- `test-local.sh` 的 coverage 文件每次独立，公共 HTML 生成在锁内串行化。两个独立 MySQL runner 并行运行，各 9 passed；见 [parallel-coverage.log](parallel-coverage.log)。
- 独立 Agent 对此前合成行验收存在真实 Schema/Skill 出站的事实作更正；新验收使用虚构系统提示、Skill、表列和不含科研模块的单独镜像。真实科研数据出站默认关闭，除非另行明确配置授权。


主站浏览器验收：在独立临时 MySQL 上执行当前 Alembic 迁移，以真实浏览器访问复制出的当前前端、临时 FastAPI 和独立 Pi Agent；通过登录、任务创建、澄清及答复、Pi 和隔离 Python 分析、报告编辑、ZIP 下载、刷新，并逐项核对虚构 CSV，见 [workspace-e2e.log](workspace-e2e.log)。该测试连接虚构 MCP 和不含科研模块的合成镜像，不连接真实科研库或已有平台库。

复现前先在独立 Agent 仓库构建 `docker build --network none -f runner/Dockerfile.synthetic -t lingsight-synthetic-acceptance:local .`，该仓库需已配置可使用的 Pi 模型凭据；然后在平台 `backend` 执行 `bash scripts/test-local.sh ../docs/evidence/backend-convergence/workspace_e2e.py -q -s -p no:cacheprovider`。独立仓库默认位于平台仓库同级；可用 `LINGSIGHT_AGENT_REPO` 指定其它路径。验收只对合成数据启用临时模型传输授权，不改真实服务的配置。

固定点需求复审还发现素材在等待用户行锁期间可能更新；已在取得锁后加载并校验当前素材。真实 MySQL 行锁回归验证请求获得 409，并恢复测试夹具；见 [review-race-final.log](review-race-final.log)。

干净开发环境未构建 SPA 时，FastAPI 仅提供 API 且未匹配路径返回 404；正式环境仍在启动时要求已构建前端。独立评审分支的结构测试为 263 passed、45 deselected、coverage 87%，见 [branch-tests.log](branch-tests.log)。
