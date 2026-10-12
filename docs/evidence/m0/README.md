# M0 验收证据（2026-10-12，工单 #2）

官方 full-stack-fastapi-template（commit `7257e60`）导入 + PostgreSQL→MySQL 适配后的完整验收记录。环境：本机 Docker 29.1.3 / Compose 2.40.3，宿主 MySQL 端口 3306/3307 已被本机既有容器占用，compose db 发布 3308。

| 文件 | 内容 |
|---|---|
| `01-compose-up.log` | 一键启动（`up -d --wait`）全 healthy + 健康检查（API 200 / 前端 HTML 200 直连+代理 / 登录 JWT 200 / MySQL 8.4.11 + char(36) schema） |
| `02-container-logs.log` | db + backend 容器启动日志片段 |
| `04-alembic-upgrade.log` | `alembic upgrade head` 建表成功（初始迁移由 autogenerate 对空 MySQL 库检出 user/item 全表后人工修正 import） |
| `05-alembic-parity-check.log` | 二次 autogenerate 产出空迁移（模型↔MySQL 库一致） |
| `06-prestart.log` | 全新数据卷上容器内 `scripts/prestart.sh`（迁移+初始超管）成功 |
| `07-pytest.log` | 模板自带 pytest：**58 passed**（coverage 92%，CI 门槛 90%） |
| `08-playwright.log` | 模板自带 Playwright E2E：**62 passed**（chromium，39.2s） |

## 结果对照验收标准

- [x] docker compose 一键启动前后端，健康检查通过（proxy/db/backend/adminer/mailpit 全 Healthy；playwright 为按需服务不常驻）
- [x] 数据层 MySQL（mysql:8.4，与本机 water_maze 同大版本），Alembic 可生成迁移（autogenerate→upgrade→空迁移一致性校验）
- [x] 模板自带 pytest 与 Playwright 在 MySQL 配置下全绿（58/58、62/62）
- [x] LICENSE/来源注记（MIT，`docs/scaffold/README.md` 头部），`.env.example` 仅占位符
- [x] 本文件即 M0 验收证据记录（另见 `docs/progress.md`）

## 适配偏离（详见 ADR-0005）

- 驱动用同步 `pymysql`（模板 2026-10 基线为全同步数据层，asyncmy 为纯异步驱动无法接入；不为此重写模板与测试）
- UUID 列 `CHAR(36)`（`TypeDecorator`，非 `Uuid(native_uuid=False)` 的 CHAR(32)）
- 引擎 `isolation_level="READ COMMITTED"`（对齐模板假设的 PostgreSQL 默认隔离级别；MySQL 默认 REPEATABLE READ 会使 pytest session 级 fixture 读不到其他连接的提交，11 个测试失败）
- adminer 本地端口 8081（宿主 8080 被占）
