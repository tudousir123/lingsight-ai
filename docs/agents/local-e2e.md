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

## 4. 提交后的固定范围预检

在任务 worktree 提交全部目标改动后，从该 worktree 运行：

```bash
bash scripts/pr-preflight.sh <fixed-base-commit-or-ref>
```

预检拒绝 main/master、detached HEAD 和任何 tracked/index/untracked 脏树（Git 忽略文件不计入）。base 必须解析为有效提交；命令打印解析后的 exact base/HEAD，并复用 CI 的 `uv run prek run --from-ref BASE --to-ref HEAD --show-diff-on-failure` 双端点范围，不改用 merge-base。为保证可重复审查，优先传固定 SHA，而非会移动的远程分支。

prek 中有自动修复钩子，因此仅在任务 worktree 执行。钩子非零、产生工作树/索引改动、改变 HEAD 或分支，预检都失败；不会暂存、提交、推送、stash 或 reset。修复结果原样保留，人工审查并提交后重跑。该命令只保证 committed-head 范围，不替代真实 Docker、应用或科研服务验收。

标准库 CLI 护栏由既有 prek/CI 入口自动发现 `scripts/tests/test_*.py`；也可单独运行：

```bash
python3 -m unittest discover -s scripts/tests -p 'test_*.py' -v
```

拼写配置仅用根 `pyproject.toml` 的 `[tool.typos]`；根 `_typos.toml`、`.typos.toml`、`typos.toml` 即使未跟踪也会被配置护栏拒绝。现有固定版本 typos hook 环境执行 wrapper，不依赖宿主全局 typos。全局配置变更触发 Git 跟踪文件扫描，NUL-safe 保留特殊文件名并继续使用 `--force-exclude`；不递归读取私密未跟踪 `.env`，也不跟随 symlink。普通变更仅扫描传入的跟踪文件。

SDK hook 同时覆盖后端 Schema/依赖、生成器配置，以及根 `package.json`、`bun.lock`、`frontend/package.json`。CI 的冻结依赖安装和 SDK drift 检查继续保留。

## 5. 网关路由与浏览器兼容版本的单源导出

平台支持的浏览器协议/profile 版本只在 `backend/app/contracts.py` 声明；网关直接 import，工作区及其 API 夹具 import 既有生成模块 `frontend/src/lib/upstreamRoutes.gen.ts`。Agent 自身是独立部署的版本广告来源；不能用「共享常量」替代双方各自的 fail-closed 版本/能力核验。

修改声明后沿用现有命令，不需安装新生成工具：

```bash
cd backend
uv run python scripts/export_frontend_routes.py
uv run pytest tests/scripts/test_export_frontend_routes.py tests/api/routes/test_agent_gateway.py -q
```

前一测试逐字比较整个生成物，路由和浏览器版本任一漂移都会失败。浏览器兼容拒绝另由网关 HTTP 用例与 `frontend/tests/browser-agent.spec.ts` 锁住；夹具 UI 不替代真实 JWT/gateway/Chromium 的 `tests/api/routes/test_agent_browser_http.py`。
