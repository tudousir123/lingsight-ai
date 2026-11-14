# FastAPI Project - Frontend

## 科研入门引导（2026-11-09）

`/onboarding` 使用英文四屏引导：Meet your assistant → Explore behavior → Research outputs → Start your research。先介绍科研助手、行为探索与交付形式，再让用户输入问题或选择示例。标题每字间隔 70ms，以 240ms 透明度过渡逐字淡入；整句预先排版避免居中和换行抖动，标点和换行留短暂停顿；滚轮上下推进和回看，回看立即显示完整标题。减少动态效果时直接显示全文。数据范围为选填，进入工作台后仍由用户发送问题才开始分析。

进入工作台前将研究目标、数据范围和问题保存在 `sessionStorage`，沿用既有任务输入框接力逻辑；进入引导本身不读取科研数据或发起分析。重新打开可继续使用已保存的问题；返回保留编辑，切换研究方向重新生成建议。跳过只标记引导已看，不生成研究说明。存储失败保留输入，提供 Markdown 下载；非法存储内容忽略。

最小验收：滚轮前进与回看、选择后停留、短屏触屏阅读、长输入框滚动、三类方向、返回修改、输入接力和恢复、跳过、空输入与存储失败、移动端键盘操作、减少动态效果。浏览器测试使用空登录状态与请求拦截，不依赖或修改真实科研库。运行 `PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 bun x playwright test tests/onboarding.spec.ts --project=chromium --no-deps --workers=1`。验证命令与结果见 [引导验收记录](../docs/evidence/onboarding/README.md)。

## 科研任务工作区与 Agent 网关（2026-11-09）

工作台首页与官网首页使用英文。工作台按官网预览提供完整侧栏、中央研究流程、右侧 Overview 和底部任务输入区。侧栏包含 New research task、Experiments & data、Videos & annotations、Analysis & reports、Search research，以及真实 Recent tasks 和 Projects。Video inference 在品牌菜单中保留入口。Projects 支持新建与任务归类，按账号保存在当前浏览器，不具备跨设备同步；科研任务与交付物仍由 Agent 服务拥有。验证见[英文侧栏与首页验收记录](../docs/evidence/agent-workspace/README.md#完整英文侧栏与首页--2026-11-10)。

`/` 是新任务对话；`/tasks/:taskId` 保存同一任务的对话、执行步骤、口径确认及交付物；`/analysis` 列出真实任务；`/inference` 展示尚未接入的视频推理状态。视频目录与试次地址保持可访问。任务状态由独立 `lingsight-agent` 持有，前端按事件游标增量读取，刷新后重放，关闭页面不会取消执行。任务失败保留输入；断连显示错误并重试；恢复操作由用户显式发起。报告预览仅渲染文本，编辑另存版本。

后端配置 `AGENT_BASE_URL`、`AGENT_API_TOKEN` 和 `AGENT_WORKSPACE_EMAIL`（见根目录 `.env.example`）。这是一个个人工作区：仅管理员及配置的普通账号可访问，其他账号返回 403；不能用于多用户数据隔离。Agent token 只保存在服务端，浏览器沿用平台登录凭据，由 `/api/v1/agent/*` 转发允许的操作。Agent 容器地址必须从运行 FastAPI 的环境可达。

本机当前保留旧 API `:8000`，独立联调网关 `lingsight-ui-gateway` 在 `:8001`，Agent 在 `:19100`。Vite 启动示例：

```bash
VITE_API_URL=http://localhost:8000 VITE_AGENT_GATEWAY_URL=http://127.0.0.1:8001 bun run dev --host 127.0.0.1 --port 5173
```

正常部署时将新 FastAPI 与前端一起发布，配置服务端 Agent 环境变量即可；`VITE_AGENT_GATEWAY_URL` 仅用于开发代理分流。当前联调容器不是正式部署，不运行迁移或测试清库。浏览器契约测试、网关单测、真实账号最小连通记录及限制见 [工作区验收记录](../docs/evidence/agent-workspace/README.md)。

## LingSight AI 水迷宫界面预览

侧栏「视频标注」（`/annotations`）读取后端实验与试次目录；普通用户只看到应用库中显式授予访问权限的实验，管理员可浏览全部。试次详情使用 `/experiments/:experimentId/trials/:trialId` 固定地址。后端需要配置研究库只读账户；研究库不可用、无权限和视频文件不可访问会分别显示状态。当前详情页只展示试次元数据，视频核对和结果联动由后续工单实现。旧的四页效果图保留在开发演示模式。

部署时先运行 Alembic 迁移，再由管理员在应用库的 `experiment_access` 表写入 `(user_id, experiment_id)` 授权；`user_id` 对应应用库 `user.id`，`experiment_id` 对应研究库 `datasets.dataset_id`。目前没有授权管理界面，未授予实验的普通用户会看到空实验列表。当前科研语义层将 `0804–0808` 映射为第 1–5 训练日，目录页的训练日筛选沿用这一已确认口径；接入其他实验协议前须先核定其训练日映射。

旧的四页演示组件仍保留；其中分析准备、单次结果和统计报告入口为 `/prepare`、`/results`、`/reports`，`/` 现已切换为科研对话。除单独启用的本机 HealthAD 样片外，这些效果图使用虚构示例数据与合成水迷宫图片；视频导入、实际推理、人工几何保存、事件复核及报告导出尚未连接后端。启动开发演示模式需要设置 `VITE_DEMO_PREVIEW=true`。

页面以 [shadcn/ui 官方 dashboard-01](https://ui.shadcn.com/blocks?category=dashboard) 的卡片、侧栏、表格和图表组合为参考，在已有 FastAPI 模板前端中改造；未覆盖现有登录与用户管理。官方块采用 MIT 许可，来源：[shadcn-ui/ui](https://github.com/shadcn-ui/ui)。默认示例图是合成画面；本地开发可单独启用 `003_HealthAD` 的实拍视频演示。

本机若已有 `frontend/public/local-preview/003-healthad-*` 素材，可在 `frontend` 目录运行 `VITE_DEMO_PREVIEW=true VITE_HEALTHAD_SAMPLE=true npm run dev -- --host 127.0.0.1` 打开免登录演示页。在此模式下，视频列表、人工检查和分析结果均对应 `0809第一象限-A2-2-4.mp4`；结果页读取同名离线推理 JSON 的 244 帧中心点及头尾关键点，展示真实轨迹、有效帧数和 1124.1 px 路径长度，不再使用其他试次的虚构指标。播放器使用既有离线推理生成的 `adaptive_overlay` 视频，同源人工 LabelMe 水池与标志物轮廓叠加其上；基准平台圆来自本机 `E1_分析前置_20260110/task3_platform/platform_coordinates.csv` 的 0809 共识坐标（1501.7, 622.6，半径 46 px），不是视频模型检测结果。速度曲线由对应推理 JSON 的逐帧中心点计算：30 fps、前后各 3 帧的中心位移除以时间差，单位 px/s；没有空间标定时不换算成 cm/s。平台区域首次进入时间仅为中心点与标定圆重合的候选，未判定有效上台。视频进度与曲线指示线同步。素材目录由 `.gitignore` 排除，Vite 构建关闭 `public` 目录复制，正式产物只打包代码引用的合成示例图，不包含这段本地视频或标注。

The frontend is built with [Vite](https://vitejs.dev/), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [TanStack Query](https://tanstack.com/query), [TanStack Router](https://tanstack.com/router), [Tailwind CSS](https://tailwindcss.com/), and [shadcn/ui](https://ui.shadcn.com/).

## Requirements

- [Bun](https://bun.sh/)

## Quick Start

From the project root, install the dependencies and start the frontend development server:

```bash
bun install
bun run dev
```

Then open <http://localhost:5173/> in your browser.

Run `uv run bash scripts/prestart.sh` and `uv run fastapi dev` from the `backend` directory, with PostgreSQL running in Docker Compose. See [../development.md](../development.md) for the complete setup.

To serve the frontend with FastAPI, run `bun run build` from the `frontend` directory and open `http://localhost:8000`.

Check `frontend/package.json` to see the other available commands.

## Removing the Frontend

If you are developing an API-only app and want to remove the frontend, you can do it easily:

* Remove the `./frontend` directory.

* In the `backend/app/main.py` file, remove the `app.frontend()` call.

* In the `backend/Dockerfile` file, remove the frontend build stage and the `COPY --from=frontend-build` instruction.

* In the `compose.override.yml` file, remove the `playwright` service.

* In the `.github/workflows/deploy.yml` file, remove the **Set up Bun**, **Install frontend dependencies**, and **Build frontend** steps.

* In the `.fastapicloudignore` file, remove the `!backend/app/frontend/` entry.

Done, you now have an API-only app. 🤓

## Generate Client

The root workspace pins `@hey-api/openapi-ts` together with TypeScript 6 for its
JavaScript compiler API. The frontend independently uses TypeScript 7 for builds;
TypeScript 7 does not expose the legacy `createPrinter` / `NewLineKind` API needed
by this generator. Keep the generator and its compiler API dependency at the root,
and run frontend builds from the frontend workspace, not with the root `tsc`.
Both versions are installed reproducibly by the root `bun ci`.

### Automatically

* From the project root, run the script:

```bash
bash ./scripts/generate-client.sh
```

* Commit the changes.

### Manually

* Make sure the backend is running.

* Download the OpenAPI JSON file from `http://localhost:8000/api/v1/openapi.json` and copy it to a new file `openapi.json` at the root of the `frontend` directory.

* To generate the frontend client, run:

```bash
bun run generate-client
```

* Commit the changes.

Regenerate the client whenever backend changes affect the OpenAPI schema.

## Using a Remote API

By default, the built frontend uses the same origin as the FastAPI app. If you want to use a remote API while running the Vite development server, you can set the environment variable `VITE_API_URL` to the URL of the remote API. For example, you can set it in the `frontend/.env` file:

```env
VITE_API_URL=https://my-domain.example.com
```

Then, when you run the frontend, it will use that URL as the base URL for the API.

## Code Structure

The frontend code is structured as follows:

* `frontend/src` - The main frontend code.
* `frontend/public` - Static assets.
* `frontend/src/client` - The generated OpenAPI client.
* `frontend/src/components` - The components of the frontend, including the shadcn/ui components in `frontend/src/components/ui`.
* `frontend/src/hooks` - Custom hooks.
* `frontend/src/lib` - Shared frontend utilities.
* `frontend/src/routes` - The frontend routes and pages.

## End-to-End Testing with Playwright

The frontend includes initial end-to-end tests using Playwright. To run the tests, you need to have the Docker Compose stack running. Start the stack with the following command:

```bash
docker compose run --rm backend bash scripts/prestart.sh
docker compose up -d --wait backend
```

Then, you can run the tests with the following command:

```bash
bunx playwright test
```

You can also run your tests in UI mode to see the browser and interact with it running:

```bash
bunx playwright test --ui
```

To stop and remove the Docker Compose stack and clean the data created in tests, use the following command:

```bash
docker compose down -v
```

To update the tests, navigate to the tests directory and modify the existing test files or add new ones as needed.

For more information on writing and running Playwright tests, refer to the official [Playwright documentation](https://playwright.dev/docs/intro).
