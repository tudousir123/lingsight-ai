# 科研工作区桌面首页调整 · 2026-11-10

## 目标与设计

参考用户提供的深色科研工作区截图，优化登录后的 `/` 首页：圆角主画布、紧凑侧栏、居中的研究主卡片与指南/报告小卡片，以及保持可见的输入区。根据用户后续要求，首页及相关科研工作区导航、提示、任务状态和示例问题使用中文；本轮以桌面端为验收重点，未新增依赖。

- `frontend/src/features/agent/WorkspaceHome.tsx`：独立首页展示组件。接收最近任务和 `onStart(prompt)`；水迷宫线稿为装饰性示意，并非实测数据。主卡片及问题快捷入口仅填入草稿并聚焦；指南和报告链接使用现有路由。
- `frontend/src/features/agent/workspace-home.css`：首页布局、卡片、插画与输入区视觉；短桌面显示器采用紧凑间距。
- `frontend/src/features/agent/Workspace.tsx`：使用首页组件，概览栏只在任务页展示；保留现有 API、创建任务、澄清、取消、报告操作及失败处理。
- `frontend/src/features/agent/workspace.css`：共享外框和页头调整，移除已替换的旧首页样式。
- `frontend/src/components/Sidebar/AppSidebar.tsx` 与 `research-sidebar.css`：移除装饰性窗口灯，紧凑导航与圆角选中态，保留搜索、项目和账号菜单。

已有未提交工作保留。本轮没有部署服务，也未改动后端或科研数据。

## 验证

从仓库根目录运行：

```bash
cd frontend
bun x biome check src/features/agent/WorkspaceHome.tsx src/features/agent/Workspace.tsx src/features/agent/workspace-home.css src/features/agent/workspace.css src/components/Sidebar/AppSidebar.tsx src/components/Sidebar/research-sidebar.css
PLAYWRIGHT_BASE_URL=http://localhost:5173 bun x playwright test tests/agent-workspace.spec.ts --project=chromium --no-deps --reporter=line --workers=2
bun x tsc -p tsconfig.build.json
bun x vite build --outDir /tmp/lingsight-homepage-refresh-build
cd ..
node docs/evidence/homepage-refresh/preview.cjs
```

- 定向 Biome 检查通过（`check.log`）。
- 工作区已有 14 项 Playwright 回归通过（`playwright.log`）；该文件包含原有移动端基础断言，但本轮不进行手机视觉细调。
- TypeScript 检查与临时目录生产构建通过（`build-isolated.log`）。常规 `bun run build` 因既有 `backend/app/frontend/assets` 目录写入权限失败（`build.log`），未调整目录权限；改用隔离输出目录验证同一源码。
- 桌面 1280×720、1440×900、1600×1000、1920×1080 截图及边界检查：无横向溢出、输入区不超出视口、无浏览器页面错误（`preview.log`）。
- 主卡片填入带批次/动物映射约束的草稿并聚焦，不自动提交；报告和指南卡片进入已有页面（`preview.log`）。

测试及预览使用拦截 API 的合成任务与账号，不构成真实科研 Agent 执行或生产部署的验证。最终截图使用 `desktop-*-v4.png`，每轮均使用新文件名。

## 中文界面更新

用户要求“用中文”后，已将首页、侧栏及账号菜单、输入区、任务状态、任务与报告操作、项目操作改成中文。首页示例问题也使用中文，同时保留实验范围、动物映射、有效试次和批次分开的约束。用户已保存的项目名称和任务内容按原样显示；只调整未保存过项目时提供的默认项目名称。

新增涉及文件：`api.ts`（状态文案）、`projects.ts`（默认项目与错误提示）、`ProjectPage.tsx`、`Artifacts.tsx`、`components/Sidebar/User.tsx`、`components/ui/sidebar.tsx`（无障碍侧栏按钮文案）、`routes/_layout/index.tsx`（页面标题）；已有工作区测试同步中文选择器。此前英文版截图和日志作为历史记录保留，当前截图使用 `desktop-*-zh-v1.png`。

当前验证记录：`chinese-check.log`（定向 Biome）、`chinese-build.log`（TypeScript 通过后执行临时目录生产构建）、`chinese-playwright.log`（中文工作区回归）、`chinese-preview.log`（四种桌面尺寸与首页入口交互）。运行命令与上节相同，预览脚本已更新中文选择器。研究指南页面的既有引导内容未在本轮翻译。
