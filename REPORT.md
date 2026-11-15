# #69 平台后端实现报告

- PR：https://github.com/tudousir123/lingsight-ai/pull/70（目标 `main`，未合并）
- 分支：`impl/69-platform-isolation`
- 初始实现基线：`b0f06e16bd43f75408c27f65ac9a5177965a77c8`
- 当前 PR 基线：`050910bcad9ab5e3ba519162692c4f8044a2f5e1`。工作期间文档 PR #68 由外部合入 main，本分支原样同步；其三个文件与 origin/main 无差异。
- 最终代码验收提交：`be2b669eae818633cab6ff48aa789cd8f7b564ba`（之后仅同步已合入 main 的文档和本报告；后端内容已比较为完全一致）
- 规格：https://github.com/tudousir123/lingsight-ai/issues/69

## 范围与结果

实现平台网关、存储、授权和后端接口。工作区资格与整库权限分离；视频、推理任务、确认版本、发布结果均验证归属与当前输入权限。Agent 操作注入可信用户身份，逐次检查协议能力，并提供实时授权回调。

未修改前端或生成客户端、关联 Agent 仓库代码、文档 PR #68；未部署、合并、启动真实推理/训练或访问科研数据库；未使用 GPU、写入 `/mnt/ugnas_*` 或在 `~/桌面/lingsight-ai` 主工作区执行文件写入。测试只使用生成媒体、受控 HTTP 上游、临时 MySQL 与临时 Agent SQLite。

## 主要修改

| 职责 | 主要文件 | 行为与失败边界 |
|---|---|---|
| 个人工作区与授权 | `backend/app/scope.py`、`scope_models.py`、`api/routes/users.py`、`trials.py`、`api/deps.py` | 有效账号自动具备工作区资格；整库权限只来自管理员身份或显式记录；授予/撤销留审计，单实验权限保留原范围。 |
| 上传与项目归组 | `backend/app/uploads.py`、`upload_models.py`、`media_settings.py`、`api/routes/videos.py`、`projects.py` | 先鉴权再读取 multipart；流式计数与哈希；完整解码和副本验证后提交；幂等重放、临时文件清理、最后归组保护、带鉴权的媒体 Range。 |
| 推理绑定与确认 | `backend/app/inference_access.py`、`inference_models.py`、`preannotations.py`、`api/routes/inference.py`、`preannotations.py` | 客户端 ID 与上游路径分离；无平台归属记录的历史共享任务不可见；候选版本/几何校验；不可变确认先持久化再下发，含并发与超时恢复。 |
| 发布与逐帧读取 | `backend/app/publishing.py`、`api/routes/results.py`、`models.py` | 保留 succeeded + tracking_ok、哈希、整版事务及回读；补输入/确认一致性与当前授权，返回原始视频哈希和确认 ID。 |
| Agent 契约 | `backend/app/api/routes/agent.py`、`agent_authorization.py`、`api/gateway.py` | 默认 none；项目/整库范围显式验证；可信身份头替换外部身份；服务凭据故障与业务拒绝区分；旧能力服务 503。 |
| 运行依赖与说明 | `backend/Dockerfile`、`.github/workflows/test-backend.yml`、`backend/README.md` | 安装 FFmpeg/ffprobe，说明存储标记、媒体副本、只读挂载、授权映射及旧上游限制；不执行部署。 |

新增迁移链：`d9f0a1b2c3e4 → 69a → f69b00000002 → 69c`。迁移只在一次性测试库运行，普通账号没有默认整库授权，也没有将旧共享任务分配给新用户。无可靠归属证据的历史任务保持隐藏，需后续人工核验；未删除上游历史数据。

## 设计取舍

1. 平台只保存授权所需的 owner/project/video/task 绑定与不可变确认；完整推理任务状态仍由推理服务拥有，科研任务状态仍由 Agent 拥有。
2. 原 AVI 保留在平台。推理 MP4 优先重封装，否则使用无损编码，并核验解码像素、帧序、宽高和时间依据；无法核验则拒绝。浏览器预览文件与实际推理输入分别记录，不混用哈希。
3. 上传文件用随机存储键、暂存与原子就位，数据库提交不确定时保留完整文件供恢复核对。专用媒体根必须带平台所有权标记，不能把任意已有目录当作清理范围。
4. 确认下发先持久保存，再保守恢复不确定结果。旧上游没有创建幂等能力，创建超时未知时保留 reservation 并返回 503，避免盲目创建第二个任务。
5. 根目录枚举不等于实验授权；现有科研目录需要服务器配置的 source→experiment→directory 映射。映射缺失或媒体只读挂载未核验时失败关闭。

## 验证证据

| 检查 | 可重放命令 | 结果 |
|---|---|---|
| 基线完整后端 | `bash backend/scripts/test-local.sh`，基线 b0f06e1 | 264 passed，7 skipped |
| 最终静态检查 | `cd backend && uv run bash scripts/lint.sh` | 通过：mypy、ty、Ruff；65 个源文件 |
| 最终完整后端与固定 Agent 契约 | `AGENT_CONTRACT_REPOSITORY=/home/x/mattdev-impl/issue69-context/agent-contract-7b2c020 bash backend/scripts/test-local.sh` | 349 passed、6 skipped、1 warning，152.90 秒；覆盖率 90.52%，85% 门控通过 |
| 提交范围预检 | `SKIP=generate-frontend-sdk bash scripts/pr-preflight.sh b0f06e16bd43f75408c27f65ac9a5177965a77c8` | 代码验收提交通过；SDK 生成明确跳过，遵守不改客户端要求 |
| FFmpeg 运行时依赖 | 在独立 `python:3.14` 容器安装与 Dockerfile 相同的 FFmpeg 包，生成并探测测试视频 | H.264、64×48、5 帧；容器已退出清理 |
| GitHub CI | PR #70 最新 head | 代码提交 be2b669 的 Backend、Docker Compose 通过；Playwright 在 SDK 差异检查失败；pre-commit 自动修复获取 PR Push token 失败（未产生客户端提交） |

测试脚本创建随机 `lingsight_test_*` MySQL，执行真实迁移，结束后清理自己的容器。没有使用开发库验证新能力。原始本机日志在 `/home/x/mattdev-impl/issue69-context/`；报告和 PR 只列非敏感摘要。

关键行为证据：

- 新接口测试先在基线得到 404；实现后新账号可建项目、上传和查看自己的数据。
- 实际发送十进制 2,000,000,000 字节文件成功，+1 字节返回 413；请求不依赖 Content-Length，没有提交巨型 fixture。
- 生成 MP4/AVI 的媒体、预览、双哈希、像素与帧时间核验；伪容器、断流、磁盘/数据库失败、重启恢复、同键并发和最后引用保护。
- 完整平台 HTTP 链：signup→上传→推理绑定→候选帧→持久确认→复核→发布→授权回调 publication 白名单；B 用户猜测 ID、Range、发布或导入均不能读取 A 的私有数据。
- 旧 Agent `54dc314` 被能力门禁拒绝；新 Agent 固定提交 `7b2c02088877cb60b8281ab5c416ad21a4eb06d9` 的真实 Node 服务验证 A/B 隔离、无 Artifact 的 qa 成功、整库撤权后的输出/事件/bundle/run/resume 拒绝及所有者 cancel。Node 使用真实平台授权回调，未调用模型或真实 DBHub。

## Standards

独立评审固定范围 `b0f06e1...7b1df55`：3 项单一来源违规、1 项重复代码判断项。

1. 工作区展示的上传大小/格式与实际限制重复。已统一从 `media_settings.py` 读取大小与 MIME/扩展名策略。
2. 候选图片 URL 绕过 `API_V1_STR`。已从设置生成候选 URL，非默认 API 前缀回归通过。
3. data_scope、completion_mode、错误码家族重复定义。已统一到 `backend/app/contracts.py`，保留原 HTTP 协议。
4. 两处视频 ID 编码对非 ASCII 值行为不同。上传挂载核验与任务创建复用一个编码器，非 ASCII 映射回归通过。

## Spec

独立规格评审确认 2 项可修复问题和 1 项外部兼容限制。

1. P1：已失败旧版本重放与新版本替换可能竞争，下发过期几何。已按 project→binding→confirmation 顺序加锁并重验当前版本，在释放锁前持久记录下发尝试。真实重叠请求先复现错误，再验证旧版本不下发。
2. 外部限制：旧推理服务要求恰好 4 个标志物且标签 ≤80，与平台 0–64 个、标签 ≤100 的契约不兼容。平台保留完整合法确认，返回失败状态并支持后续恢复；不填充、截断或伪造几何。真实上游全契约验收仍受此限制。
3. P2：FFmpeg 写入阶段的磁盘满被归类为 422。已限量接收内部 stderr、区分存储故障并返回不带路径的 503；帧证据、AVI 副本、预览三个子进程失败阶段均验证清理和同键重试。

两轴分别收敛：规范轴原 3 项硬规则与 1 项判断项全部修复，独立复核剩余 0；规格轴 2 项可修复问题均修复并独立复核，保留 1 项外部兼容限制。修复后的定向 HTTP 测试 166 项与 19 个 subtests 通过，再执行上述完整后端测试。

代码提交的远端证据：[Backend](https://github.com/tudousir123/lingsight-ai/actions/runs/43677808549)、[Docker Compose](https://github.com/tudousir123/lingsight-ai/actions/runs/43677808520)、[SDK 差异](https://github.com/tudousir123/lingsight-ai/actions/runs/43677808618)、[pre-commit](https://github.com/tudousir123/lingsight-ai/actions/runs/43677808509)。最终报告提交的实时检查以 PR 页面为准。

## 待接入和限制

- 本次未部署。需要配置专用 `PLATFORM_MEDIA_ROOT`；已有非空且未标记目录会被拒绝。只读挂载、服务 UID/ACL、媒体工具、代理请求大小和超时的要求见 `backend/README.md`。
- `AGENT_AUTHORIZATION_TOKEN` 是专用内部回调凭据，与用户 JWT 和平台→Agent token 分离；两端必须配置匹配的回调地址和凭据。本次没有修改真实运行配置。
- 真实旧推理服务的标志物限制与创建幂等能力仍是外部依赖。合成上游通过不代表真实追踪、GPU 性能或生产部署验收完成。
- 前端和生成客户端未随接口升级。完整客户端生成/前端联调需要独立工作；远端 SDK 差异已实际出现，因此本 PR 的全部 CI 尚非绿色，未用修改或隐藏后端 OpenAPI 来绕过检查。
- 真实科研数据、模型、DBHub 查询、L3 挂载及正式发布均未运行。固定 Agent 合成契约只证明本报告列出的 HTTP 边界行为。
