---
status: accepted
---

# MySQL 适配：同步 PyMySQL 驱动与 CHAR(36) UUID，而非 asyncmy

ADR-0002 的 PostgreSQL→MySQL 清单写了「asyncmy 驱动、UUID 列 CHAR(36)」。导入模板基线（commit `7257e60`，2026-10-08）后实测发现：**2026 版模板数据层是全同步的**（`create_engine` + psycopg + 同步 `Session` 依赖注入，路由、CRUD、conftest 及约 1100 行测试全部同步，模板仓库历史上从未有过异步数据层）。asyncmy 是纯异步 DBAPI，无法接入同步引擎。

## Decision

1. **驱动用 `pymysql`（同步、纯 Python）**，连接串 `mysql+pymysql://`；附 `cryptography`（MySQL 8 默认 `caching_sha2_password` 认证需要）。不为此重写模板为异步。
2. **UUID 列用 `TypeDecorator(CHAR(36))`**（`backend/app/models.py::Char36UUID`）。`sa.Uuid(native_uuid=False)` 在 MySQL 上是 CHAR(32) 无连字符；显式 CHAR(36) 与工单要求一致、与 MySQL `UUID()` 输出同格式，且全方言可移植。
3. **模板 5 个 PG 专用迁移压平为 1 个 MySQL 初始迁移**：旧链含 `uuid-ossp` 扩展与 `postgresql.UUID`，在 MySQL 上不可执行；项目尚无存量数据库，重生成无迁移成本。`script.py.mako` 增补 `from app.models import Char36UUID` import（autogenerate 会以模块限定名引用自定义类型）。
4. **compose `db` 用 `mysql:8.4`**（与本机 `water_maze` 服务器同大版本），健康检查用 app 账户 `SELECT 1`（同时验证首启初始化完成）；本地端口发布 **3308**（宿主 3306/3307 已被本机 MySQL 容器占用）。
5. **CI 各 workflow 增加 `cp .env.example .env`**：模板仓库直接提交 `.env`，本仓库忽略 `.env`（密钥卫生），检出后需先复制。
6. **引擎 `isolation_level="READ COMMITTED"`**（`app/core/db.py`）：MySQL InnoDB 默认 REPEATABLE READ 会把 pytest session 级 `db` fixture 的事务快照钉死在 `init_db` 时刻，读不到 API（其他连接）后续提交的数据，模板 11 个测试因此失败；READ COMMITTED 是 PostgreSQL 的默认隔离级别，即模板测试编写时假设的语义。

## Considered Options

- **全量改异步（asyncengine + asyncmy + AsyncSession + httpx AsyncClient 测试栈）**：符合 ADR-0002 字面，但重写模板全部数据层与测试，M0「模板自带测试全绿」变成「重写后测试全绿」，验收意义丧失；工作量与 M0 目标（工程先跑起来）不成比例。Text-to-SQL 只读执行（M1）如需并发，可在其自身管线内评估独立异步引擎，与模板数据层解耦。
- **`mysqlclient`（C 扩展）**：性能略好，但镜像需 apt 安装 `libmysqlclient-dev`/`pkg-config`，收益对 M0 无意义。

## Consequences

- 偏离 ADR-0002 的「asyncmy」字面表述，以本 ADR 为准（ADR-0002 已加注链接）。
- 前后端用户/权限数据与实验数据同源同构（MySQL），后续 `water_maze` 只读接入（`lingsight_ro`）不跨数据库品类。
- DATETIME 不存时区（MySQL 方言行为），应用侧统一写 UTC（`get_datetime_utc`）。
