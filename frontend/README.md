# FastAPI Project - Frontend

## LingSight AI 水迷宫界面预览

登录后可从侧栏进入「实验管理」「分析任务」「统计与报告」。四个页面分别展示实验视频列表、分析准备、单次分析结果和实验统计报告；示例入口位于 `/`、`/prepare`、`/results`、`/reports`。页面使用虚构示例数据与合成水迷宫图片，搜索、筛选、逐帧切换、图层显隐和页面跳转可交互；视频导入、实际推理、人工几何保存、事件复核及报告导出尚未连接后端。

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
