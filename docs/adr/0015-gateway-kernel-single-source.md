# 网关内核与服务操作声明单源

status: accepted
date: 2026-11-10

# 决策

工单 #39（2026-11-10 架构评审 C1+C2+C5）：两个上游网关（`routes/agent.py`、`routes/inference.py`）此前是语句级同构的转发复印，安全策略（体量上限、上游错误归一、响应头消毒、流式连接清理）没有单一实现点。现收敛为：

- **内核** `app/api/gateway.py`：`forward(request, path, upstream, policy)` 唯一定义转发策略；`UpstreamService`（地址、服务 token、三类失败文案）与 `GatewayPolicy`（体量、读超时、SSE 游标、Range 流式、Accept 透传、`videos` 的 `?path=` 转发）承载全部服务差异，无回调钩子。
- **声明式适配器**：每个网关 = 一张 `OperationTable` 操作声明表（方法 × 路径模式 × 参数模式）+ 服务配置 + 策略参数。白名单正则由内核从声明渲染，适配器不再手写正则（pytest 绊网断言 routes/ 下无 `re.compile`/`re.fullmatch`、`httpx.AsyncClient` 仅内核一处）。
- **平台级依赖归位**：工作区门禁 `ensure_workspace_user` 与媒体 `?token=` 鉴权 `get_media_user` 住在 `app/api/deps.py`；试次路由反向引用，推理路由不再 import 试次模块。工作区门禁全仓库唯一定义（绊网按 403 文案 grep 断言）。
- **前端路由单源导出**：`scripts/export_frontend_routes.py` 读两张操作表，生成入库的 `frontend/src/lib/upstreamRoutes.gen.ts`（base 常量 + 路径模板函数 + `LiteralSet` 渲染的 TS 字面量联合，如 `InferenceArtifactName`）；pytest 绊网内存比对生成物零 diff，不依赖工作树干净。前端全部调用点改用生成模板，不再手拼上游路径。
- **凭据读取收口**：`frontend/src/lib/credentials.ts`（`getToken`/`authHeaders`/`withTokenQuery`）是 token 读取与拼装（header、查询参数）的唯一入口；消费点 = 生成客户端配置、登录态 hook、两个上游适配器与 artifact URL。存储方式不变。

# 为什么白名单正则是渲染出来的

同一操作面此前三处平行实现（后端手写正则、前端手拼字符串、上游真实路由），漂移只在运行期暴露。声明表让三处共享一个事实来源：后端白名单与前端模板函数都从它渲染，改动必须过显式导出步骤，路径拼错在提交期可见（绊网红）。`LiteralSet`（artifact 文件名白名单）同时渲染为后端正则分支与前端 TS 联合类型。

弃掉的选项：

- **继续复印**（现状）：一处修 bug 另一处静默保留旧行为，无测试能发现分叉——本 ADR 的动因。
- **跨仓 codegen**（OpenAPI/typebox 管线连到 lingsight-agent / lingsight-inference）：两个上游服务尚无稳定 schema 产物，管线成本大于两张操作表的维护成本。记录为演进位：上游契约正式化后再评估。前端字段契约现阶段为各功能域单一手写模块（`features/agent/api.ts`、`features/inference/contract.ts`），头注释指向真源。

# 保留的差异（不要好心统一）

- **128K vs 512K 体量上限**：Agent 是任务/对话 JSON；推理确认载荷含四个标志物的 polygon 坐标数组。
- **60s vs 120s 读超时**：推理需要流式返回叠加视频，Agent 只回 JSON/事件流。
- **各自中文错误文案与 503/502 分支文案**：两服务的用户提示语；Agent 对 3xx 单独报 "Unexpected Agent redirect"，推理并入统一 502 文案。
- **门禁与白名单的先后**：Agent 先工作区门禁后白名单（403 优先），推理相反（404 优先）。历史即如此，两侧契约测试分别钉住；统一需先裁决哪个语义正确，不属于本次重构。
- **响应头透传集**：流式服务透传 content-range/accept-ranges/content-length，非流式服务透传 etag；SSE 服务额外 `X-Accel-Buffering: no`。由 `range_streaming`/`sse_cursor` 显式策略位决定。

# 契约诚实边界

- **锁**：操作面（方法 × 路径模式 × artifact 文件名）三方一致——后端白名单、前端生成模板、导出绊网；网关 HTTP 行为（错误归一分支、体量上限、头消毒、流式清理）由两个网关契约测试从假上游驱动断言。
- **不锁**：上游字段形状（响应 JSON 的字段名/结构）。上游改字段名不会红在本仓库——那是上游服务自身测试与平台 e2e 冒烟的责任，前端契约模块头注释写明这一归属。
