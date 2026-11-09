# AI native 科研平台：本地现状与设计访谈

核查日期：2026-11-09。核查方法为本地容器/配置/源码只读查看，以及 MCP `initialize`、`tools/list`。初次调研未查询实验行；后续在用户确认实现后，对单个真实视频做显式只读分析验收，证据留在 Agent 本机数据目录。未改变既有 DBHub、MySQL 和平台服务配置；敏感连接串和令牌不写入本记录。

## 已核实事实

| 对象 | 当前情况 | 证据 |
|---|---|---|
| DBHub | `water-maze-dbhub`，镜像 `bytebase/dbhub:1.5.1`，host network | 本地 Docker 元数据 |
| MCP 入口 | `http://127.0.0.1:19080/mcp`，配置了 Bearer 身份认证 | 服务启动配置及本地 MCP 握手 |
| 数据源 | source ID / 数据库均为 `water_maze_v3`，MySQL `127.0.0.1:3306`，账号 `wm_ro` | `/home/shuncheng/.config/dbhub/water_maze_v3.toml` 的非敏感字段 |
| 工具 | `search_objects`、`execute_sql`；配置与工具元数据表示只读；未提供领域专用工具 | MCP `tools/list` 与上述 TOML |
| 执行限额 | 当前 TOML 与容器环境未显式设置行数和查询时限；不推断 DBHub 的默认值 | 配置及筛选后的环境变量核查 |
| 对外方式 | 运行中的 SSH 反向隧道，将远端回环端口 `19081` 转发至本地 `19080`；非直接公网监听 | `/home/shuncheng/.config/systemd/user/water-maze-dbhub-tunnel.service` |
| 现行平台 | `lingsight-ai-backend-1` 仍通过 `host.docker.internal:3306` / `lingsight_ro` 直接查询 `water_maze`；200 行 / 10 秒属于该旧管线配置 | 容器内 `ResearchQuerySettings` 的非敏感字段 |
| 运行源码 | 现行平台代码来自 `backend:latest` 镜像；唯一 bind mount 为覆盖率输出目录 | Docker mounts；桌面新 checkout 不等于当前运行代码已替换 |

随后通过 `information_schema` 元数据核实：`wm_ro` 全局仅 USAGE，对 `water_maze` 与 `water_maze_v3` 均有库级 SELECT，无转授权权限。这是两库可读账号，不能把 DBHub source 名称当作仅限 v3 的数据库权限。

尚未核实：真实分析查询表现、外部客户端的实际使用、v3 状态字段和统计口径的完整定义。单视频输入可用性的后续核查不能替代有效帧科学定义或动物映射核验。

## v3 元数据与旧库的关键差异

`water_maze_v3` 当前有六张表，无视图及声明外键：

| 表 | 粒度 / 主要职责 |
|---|---|
| `videos` | 每视频一行；只有视频 ID、帧率、帧计数和导入时间 |
| `frames` | 每视频每帧；Mask RLE、头尾关键点、朝向及 proposal 标记 |
| `video_pool_geometry` | 每视频的池几何；包含 `batch/date_dir/phase` 与几何来源信息 |
| `video_mark_geometry` | 每视频每标记的多边形几何及来源信息 |
| `platform_reference` | 参考视频/标记级平台标定 |
| `platform_daily_reference` | 每批次每天的平台参考几何 |

当前显式表结构没有旧库的 `datasets`、动物/实验组列、日内区块/试次编号、`trial_metrics`、QC、分析运行版本和人工核对表。`frames` 也没有旧版的身体中心、`time_s` 和 `status` 列。不能把旧 YAML 当作 v3 现成 schema，不能仅依据字段名称认定质量或有效帧口径。

## 已找到的实验映射来源

- 8 月注册文件位于 `/home/shuncheng/workspace/poi-paper-rebuild/healthad_003_angular_availability_20261012/video_geometry_registry_final.json`，每条视频显式保存视频 ID、日期、阶段、原动物编码及分组等标识。相邻 `register_video_geometry.py:41`、`:44` 表明这些标识来自旧库。
- 同目录 `方法与结果报告.md:35` 注明独立动物登记表尚未核验。该文件是映射来源，不能直接称为已经验证的生物学动物主表。
- `/home/shuncheng/桌面/水迷宫朝向/几何位置可视化/入库前几何核查/导入几何与平台.py:8` 引用了 10 月 registry 的 A100 挂载路径。此次未访问该远程挂载，未确认其内容完整性。该脚本 `:34`、`:37` 显示 v3 仅导入部分维度与几何来源，未导入完整动物和组标识。
- `/home/shuncheng/桌面/水迷宫朝向/archive/分析_v9重写/db.py:27` 与 `extract.py:15` 保留视频编码解析和分组约定；它们可以作为既有规则依据，但不能替代身份核验。
- `/home/shuncheng/桌面/水迷宫朝向/AGENTS.md:17` 明确 8 月与 10 月批次年龄不同、属于不同动物、应分开分析；`:5` 规定 7px 朝向算法冻结。本文仅记录已存在规则，未改动算法或重新计算数据。

## 第一轮已确认方向

1. 首期从已有实验数据出发，完成统计、绘图及带来源、口径和分析代码的报告。
2. Agent 独立启动、升级并对外提供 API；后续确认立即使用独立仓库。
3. 取消专用 Text-to-SQL 管线作为目标架构；允许 Agent 通过 DBHub 使用 SQL；保留科研领域定义。

后续确认：首期仅供个人使用；允许 Agent 在独立分析执行环境中自主编写、运行和修改 Python 并保存代码及结果；前期采用 Pi SDK 作为独立服务内部引擎。

第二轮后续确认：采用科研任务工作区；支持关闭网页继续运行，以及服务中断后保留恢复依据；先展示简短计划，常规步骤自动执行，仅在关键科研口径不明确时向用户提问。见 [ADR-0011](../adr/0011-durable-research-task-workspace.md)。

第三轮确认：Agent 与 Python 分析均先在本机运行；科研知识采用版本化 Skills 与确定性函数；先允许注明映射状态的视频级探索，正式动物统计需核验映射，不同批次默认分开。

第四轮确认：Agent 自己拥有任务、步骤、会话关联及产物；首期交付 Markdown/网页报告和完整分析材料；用户选择立即拆到独立仓库，而非同仓服务。仓库名 `lingsight-agent` 已在整体确认后创建为独立私有仓库。见 [ADR-0012](../adr/0012-agent-repository-owns-tasks-and-artifacts.md)。

决策见 [ADR-0009](../adr/0009-independent-research-agent-via-dbhub.md)。本轮只形成设计记录，未实施代码或运行环境迁移。

## 设计树与后续问题

已确定根节点：科研任务及交付物 → 独立 Agent 服务 → DBHub 数据工具入口。

产品边界决策已收敛。任务状态、SQLite 持久化、容器执行、单任务并发、事件协议及迁移顺序作为工程建议写入产品规格评审稿，已获用户整体确认，并进入独立仓库的最小实现与验收。主站现已完成个人工作区首轮本机联调，真实账号验证任务创建、澄清等待、刷新和取消；正式部署及完整科研闭环联验仍待完成，详见[工作区验收记录](../evidence/agent-workspace/README.md)。

## Pi SDK 核查

本机当前安装版本 `1.2.0`，包名 `@earendil-works/pi-coding-agent`，上游仓库为 `earendil-works/pi`。安装包文档及 SDK 示例确认：可创建会话、订阅消息/工具/运行事件、管理会话状态；SDK 使用 MCP 时需显式装载扩展并绑定，不能将 CLI 的默认行为视为服务中的自动行为。本次只检查文档与声明，未发起模型调用或修改个人 Pi 配置。参见 [ADR-0010](../adr/0010-pi-sdk-as-initial-agent-engine.md)。
