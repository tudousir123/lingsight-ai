# LingSight AI 当前后端架构

分析对象：当前工作区后端（含已有未提交的科研任务联调改动）。2026-11-09 后端收敛更新；验证与迁移说明见[收敛记录](../evidence/backend-convergence/README.md)。

[历史交互架构图](backend-current.html)保留原交付证据，仅代表此前 `98b38a2` 源码快照；本页文字与当前源码为最新依据。

## 1. 总体结构

平台后端是模块化 FastAPI 应用，科研任务通过已存在的 `api/routes/agent.py` 转发至独立 Agent。API 路由、用户鉴权、试次服务和科研问答管线位于同一应用中；模块间使用 Python 调用。数据访问以同步 SQLModel/SQLAlchemy、PyMySQL 和同步 httpx 为主。LLM 网关是进程内适配层，不是独立网关服务。应用同时挂载构建后的前端。

源码：[`app/main.py`](../../backend/app/main.py)、[`api/main.py`](../../backend/app/api/main.py)、[`core/db.py`](../../backend/app/core/db.py)、[`gateway.py`](../../backend/app/text_to_sql/gateway.py)。

## 2. 两套数据库职责

| 存储 | 保存什么 | 谁访问、如何访问 |
|---|---|---|
| 应用 MySQL | `user`、`experiment_access`、`trial_review`，以及模板遗留 `item` | SQLModel + SQLAlchemy + PyMySQL；会话依赖管理；Alembic 迁移；允许业务写入 |
| 科研 MySQL `water_maze` | 实验/视频目录、帧级轨迹视图、平台标定、QC 和 `trial_metrics` | 在线问答与试次读取使用 `lingsight_ro`；指标预计算脚本通过独立 `METRICS_DB_*` 凭据写入 |
| 本地挂载文件 | 原视频、离线 Overlay、标志物 JSON | `trials/media.py` 为目录及素材统一解析路径；媒体接口做鉴权和实验授权后返回 `FileResponse` |

这是逻辑职责分离，不代表本次确认了两台物理数据库服务器。科研库已有数据和模型推理结果不由 Git 仓库恢复。

源码：[`models.py`](../../backend/app/models.py)、[`core/config.py`](../../backend/app/core/config.py)、[`text_to_sql/executor.py`](../../backend/app/text_to_sql/executor.py)、[`trials/assets.py`](../../backend/app/trials/assets.py)、[`metrics/_db.py`](../../backend/scripts/metrics/_db.py)。

## 3. 试次浏览与人工核对链路

`JWT 身份校验 → 实验授权 → TrialCatalog / ResearchTrialAssets → 试次服务组装 → 前端`

- 入口为 `/api/v1/experiments` 及其试次子路由，提供列表、详情、准备、人工核对、结果和媒体。
- `TrialCatalog` 使用固定、参数化 SQL 查询科研目录；普通用户仅能浏览应用库明确授权的实验，管理员可看全部。
- `ResearchTrialAssets` 聚合科研库与本地文件；展示的是已有离线结果，不会在浏览请求中启动 GPU 推理。
- 人工核对写入应用库 `trial_review`。提交时校验素材版本；最终确认要求四项核对通过且必要素材齐全；同一素材版本确认后是终态。新版本重新核对，旧版本记录保留；媒体按内容指纹、轨迹按完整材料参与版本计算。
- 人工准备核对、推理 `qc_status` 和结果质量复核是不同状态。结果质量复核目前仍为 `not_started`。
- `TRIALS_FIXTURE_DIR` 可将目录与素材实现替换为合成文件夹具，用于测试/演示；不能把夹具结果当真实推理。

源码：[`routes/trials.py`](../../backend/app/api/routes/trials.py)、[`trials/service.py`](../../backend/app/trials/service.py)、[`trials/catalog.py`](../../backend/app/trials/catalog.py)。

## 4. 科研问答链路

`自然语言问题 → YAML 语义层 → LLM 生成 SQL → SQLGlot 校验 → 只读 MySQL 执行 → 结构化结果`

1. `semantic_layer.yaml` 同时生成模型提示词中的科研口径和 AST 白名单，避免维护两份相互矛盾的规则。
2. Model Gateway 通过 httpx 兼容 OpenAI 和 Anthropic 协议，具体端点和模型来自环境配置。本次没有 `.env`，不判断当前实际使用哪个供应商。
3. SQLGlot 限制单条 SELECT、表列白名单和数据库范围，并加上/收紧 LIMIT。
4. 校验失败默认允许最多 2 次修复，即最多 3 次生成；修复期间白名单不放宽。供应商失败、数据库执行失败和超时直接返回类型化错误；空结果作为成功返回，不编造数据。
5. 默认最多返回 200 行，数据库语句时间预算 10 秒。上述值可配置。
6. 后端直接组装列、行、SQL、口径说明、来源、尝试次数及错误 trace；没有把执行结果再交给 LLM 生成自由文本答案。

端点：`POST /api/v1/research/query`、`POST /api/v1/research/query/stream`。

SSE 是 `threading.Thread(daemon=True) + queue.Queue + StreamingResponse`，返回真实 generation / validation / execution 阶段和最终结果。它是进程内流式请求，不是持久任务队列。客户端断开后后台线程仍会结束当前有界查询；流式响应开始后的类型化拒绝通过事件返回，HTTP 状态不能再改。

源码：[`pipeline.py`](../../backend/app/text_to_sql/pipeline.py)、[`semantic.py`](../../backend/app/text_to_sql/semantic.py)、[`validator.py`](../../backend/app/text_to_sql/validator.py)、[`settings.py`](../../backend/app/text_to_sql/settings.py)、[`routes/research.py`](../../backend/app/api/routes/research.py)。

## 5. 指标计算与权限边界

轨迹距离、速度、有效帧比例和行为事件指标由 `app.metrics` 中的确定性代码及独立脚本计算，带单位、算法版本和计算状态写入 `trial_metrics`；在线问答主要查询这些结果。模型不负责凭空计算实验统计。

必须区分两种访问策略：

- **试次浏览：**实验级授权。
- **科研问答：**v1 登录用户可以查询科研库的白名单数据，没有套用试次实验授权。全库只读不代表任意表列可读。

该差异是明确记录的产品决策。第二课题组或外部用户接入前，需要把实验范围约束落实到问答生成/校验/执行层，不能依赖前端过滤。

源码与决策：[`compute_trial_metrics.py`](../../backend/scripts/metrics/compute_trial_metrics.py)、[`ADR-0008`](../adr/0008-qa-surface-auth-logged-in-whole-db.md)。

## 6. 当前尚未实现的架构部分

当前仓库没有接入科研 RAG、上传后自动 GPU 推理调度；通用科研任务编排归独立 Agent，本仓库仅转发工作区请求。平台未采用 Redis/Celery 持久队列或 LangGraph/LangChain 运行时。现有核心是“读既有科研结果、人工核对、受控自然语言查询”。模型推理和科研结果的历史存在，不等于已经形成此仓库内的视频上传到推理再到报告的完整自动链路。

依据：API 注册清单、后端依赖清单、模块调用链及 [`docs/progress.md`](../progress.md) 的当前记录。原 README 的初始化描述和部分早期进度文字落后于已合入的试次与 SSE 代码；本说明以当前源码为主。

## 7. 历史图形验收

图类型 `architecture`；9/9 showcase 校验通过，0 错误、0 警告；9 个源码引用与指定提交核对通过。Chrome 在 1440×900、1600×1000、1920×1080、2048×1320 四种尺寸均无页面溢出。已查看两个端点尺寸的深浅色截图，视觉复核通过。未额外手动验证搜索、导出等交互。完整哈希和字节数见交付记录。

## 8. 收敛后的配置与验证职责

应用配置定义在 `core/settings.py`，共享实例在 `core/config.py` 装配；旧科研库连接配置归 `core/research.py`，试次浏览不依赖问答配置。`trials/service.py` 统一准备、结果、核对所用的素材读取规则；科研指标计算与 SQL 安全校验保持原职责。

`tests/runtime.py` 构造合成应用配置；`conftest.py` 只有显式数据库依赖才初始化专用测试库。`scripts/test-local.sh` 与 CI 使用独立临时 MySQL、真实迁移和 pytest，结束销毁该容器，开发库不参与。纯计算、校验及转发契约测试可以独立运行。
