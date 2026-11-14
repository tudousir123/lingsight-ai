# 本机全栈 Playwright 与隔离测试

## 1. 每次使用一次性 Compose 栈

从仓库根运行：

```bash
bash scripts/e2e-local.sh
# 仅运行特定 spec 或分片，参数原样交给 Playwright：
bash scripts/e2e-local.sh tests/agent-workspace.spec.ts
bash scripts/e2e-local.sh --shard=1/4
```

脚本创建随机 `lingsight-e2e-*` project、网络和 MySQL 卷，为其生成随机密码与测试账号。只加载 `compose.yml` + `compose.e2e.yml`，不加载根 `.env` 或开发 `compose.override.yml`，不发布宿主端口，不启动代理/研究服务，不访问开发库。根 `.env` 缺失、现役开发栈已启动都可运行。不再需要 `LINGSIGHT_E2E_ALLOW_REVIEW_DELETE`，也不再清任何已有表。

两个镜像均从当前源码构建（应用和测试各自在 backend / playwright 镜像里），先迁移并创建测试账号，再等待后端健康并运行测试。正常结束、测试失败及 INT/TERM 退出都会销毁自己的容器、网络、卷和两个带 project 名称的本地镜像标签；不会停止其他栈。测试报告保留在 `frontend/blob-report` 和 `frontend/test-results`，Playwright 以宿主 UID/GID 写入，避免 Docker root 产物阻塞后续本机测试。构建上下文排除旧浏览器认证缓存。

调试时将 `--keep` 放在所有 Playwright 参数之前：

```bash
bash scripts/e2e-local.sh --keep tests/login.spec.ts
```

脚本打印保留的 project 名称、临时 env 路径及清理命令。env 只有合成测试凭据，目录权限 700、文件权限 600。可用打印的 `--env-file`、`-p` 和两个 `-f` 参数检查该栈，最后执行清理命令并删除临时目录。CI 仍使用其每分片的新建栈流程。

需要本机代理才能下载构建依赖时，可显式配置仅用于镜像构建的网络/代理；测试服务仍使用独立 Compose 网络：

```bash
LINGSIGHT_E2E_BUILD_NETWORK=host LINGSIGHT_E2E_HTTP_PROXY="$HTTP_PROXY" bash scripts/e2e-local.sh
```

默认不启用上述设置，代理不写入镜像或测试容器。

## 2. 夹具、端口与页面边界

隔离配置固定 `TRIALS_FIXTURE_DIR=/app/backend/app/trials/fixtures`，不依赖研究数据库或 LLM。私有 Agent / inference 服务不随测试启动，其页面 spec 用 API 夹具；真实服务验收另行进行。旧 trial preparation / review 闭环已按 ADR-0014 退役；保留目录浏览与过滤。

FastAPI SPA 深链接探活需要 `Accept: text/html`；curl 默认 `*/*` 会被当作资产请求，不会回退 index.html。

空登录态的 API 夹具 spec 需同时桩布局层的 `users/me`、`projects`（示例 `tests/utils/projectsApi.ts`），不能借用开发账号。登录/账号测试明确将引导页标记为已读，独立的 onboarding spec 验证首次引导。滚轮测试须等场景已渲染，将鼠标置于场景的非编辑器区域，并用 Playwright 虚拟时钟推进手势冷却，不用固定 sleep。

## 3. 后端与前端检查

```bash
cd backend
uv run bash scripts/lint.sh
bash scripts/test-local.sh
```

后端完整测试每次创建独立 MySQL 8.4、随机宿主端口和 `lingsight_test_*` 数据库，迁移后运行测试与 coverage，退出销毁自己的容器，不触碰开发账号。自行管理测试库时须显式传 `TEST_DATABASE_URL`，库名必须符合 `lingsight_test_*`；缺失则拒绝运行。纯计算/网关测试可直接 `uv run pytest <files>`。真实研究库/LLM 测试标记 `env_gated` 并探活，未配置或不可达时 skip。

前端依赖锁定 `bun.lock`，CI 使用 Bun 1.3.12。执行 `bun ci` 后 `cd frontend && bun run build`。本机无 Bun 用 `scripts/fe.sh build` 或 `check <files>`。不要用全仓 unsafe 写入的 `npm run lint` / `bun run lint`；用 `uv run prek run --files <files>` 或定向 Biome 检查，避免版本漂移和无关格式变动。
