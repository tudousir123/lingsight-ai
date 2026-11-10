# PR #38 桌面 Web 深色界面优化验收

日期：2026-11-09。基于 PR #38 的 `962a2762d4da759e1a6ab093538ce34d20550265`，本地分支 `codex/science-ui-polish`。本轮只修改前端；工作区已有的产品规格、ADR、进度等修改不属于本轮交付。

## 目标、接口和验收边界

沿用用户选定的 PR 风格：`#0a0a0a` 画布、`#171717` 卡片、细边框和少量橙色强调，优先桌面 Web。保留 React / TanStack Router / Query 和既有 FastAPI API。

- 输入仍为实验目录、试次准备/离线结果、人工核对及科研问答 SSE 接口；未改变请求或响应协议。
- 输出为统一的导航、表格、筛选器、素材状态、视频/轨迹视图、问答结果及登录界面。
- 加载失败保留重试；空目录、无匹配结果、权限拒绝、素材缺失及问答拒绝继续明确区分。缺失视频新增占位说明。
- 最小验收：生产构建、变更文件静态检查、既有目录/问答测试、桌面截图及合成视频交互检查。

## 主要文件与取舍

- `frontend/src/index.css`、`frontend/index.html`：收敛深色主题变量，移除按旧颜色类名强行覆盖的 CSS；在首屏绘制前应用主题。默认深色，保留用户已有外观选择。
- `frontend/src/components/Common/{Logo,AuthLayout,Footer,PageHeader}.tsx`：统一品牌、登录布局和业务页标题。
- `frontend/src/components/Sidebar/{AppSidebar,Main}.tsx`、`frontend/src/routes/_layout.tsx`：完善试次详情选中态、内部滚动和内容宽度；正式导航不再把会重定向的 `/prepare` 标为“分析任务”。报告入口保留“预览”标识。
- `frontend/src/features/trials/{directory,prepare,result,scene,speed-chart}.tsx`：统一表格、按钮、状态及图表配色；说明关键词仅搜索当前页，增加清除筛选；实验切换清除旧条件；小于桌面分栏阈值时允许内容自然滚动。
- `frontend/src/features/qa/qa-page.tsx`：统一提问与回答区域；完成态历史使用非空结果类型，修复完整构建发现的类型错误；请求期间禁用历史切换，避免正在显示的查询被替换。
- `frontend/src/features/mwm-demo/{pages,shared}.tsx`：报告及演示页使用主题变量；图例和曲线保持对应；补齐表单标签关联。报告仍是示例，未接入新的导出服务。
- `frontend/src/features/marketing/LingSightLanding.tsx`：保留 PR 首页视觉，移除未使用导入，首页指标引用既有历史常量，并将入口与导出说明调整到实际能力范围。
- `frontend/src/routes/`：浏览器标题统一为 LingSight Science。
- `frontend/vite.config.ts`：开发服务器代理 `/api` 到配置的 `VITE_API_URL`，缺省为本机 `8000`，使相对媒体 URL 与生产环境同源行为一致。

本轮未增加科研 Agent API、实时推理或批量报告导出。使用现有组件，不新增 UI 框架。部分修改文件原本未通过格式化检查，本轮按仓库 Biome 配置整理；未改动的 PR 首页 CSS 和 SVG 文件保留原格式。

## 自动检查

以下命令在仓库锁文件对应的依赖下运行，日志与本文件一起保存。

```bash
bun install --frozen-lockfile
bun run --cwd frontend build
```

结果：TypeScript 与 Vite 构建通过，详见 [build.log](build.log)。

在 `frontend` 目录，对本轮修改及新增的 TS/TSX/CSS/HTML 文件执行：

```bash
bun x biome check --no-errors-on-unmatched --reporter=summary <本轮变更文件>
```

结果：32 个文件，0 error / 0 warning；首页有 2 条非阻断字符串模板建议，详见 [biome.log](biome.log)。此结论限于本轮变更文件，不代表全仓历史格式检查均通过。

启动前端并运行既有测试：

```bash
cd frontend
VITE_API_URL=http://localhost:8000 bun run dev --host 127.0.0.1 --port 5173
# 在另一终端，FIRST_SUPERUSER / FIRST_SUPERUSER_PASSWORD 从本机后端运行配置注入，不回显。
bun x playwright test tests/trial-directory.spec.ts tests/qa-page.spec.ts \
  --project=chromium --reporter=line --workers=2
```

结果：`12 passed (12.2s)`，包含一次真实后端登录与 11 项使用接口拦截的目录/问答测试。覆盖稳定试次地址、重新加载、权限拒绝、空数据、重试、训练日筛选、SSE 成功/拒绝/错误/加载状态及历史回看，详见 [playwright.log](playwright.log)。不是完整真实科研库/LLM 或核对保存持久化的端到端验收。

`git diff --check` 通过。开发代理探活：`curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/api/v1/utils/health-check/` 返回 `200`。

## 浏览器检查

使用临时 Playwright 检查脚本，在 1440×1000、1024×768 下检查桌面页面，额外以 390×844 检查基本溢出。目录截图使用合成响应，视频/离线结果响应由现有后端 `FileTrialStore` 与 Pydantic schema 生成，媒体为仓库自带 `fixture-overlay.mp4`；未使用真实科研影像。

- 登录、目录、问答、报告、试次缺失素材、视频准备和离线结果页均成功渲染，浏览器无未捕获异常。
- 检查的窗口尺寸下，页面整体宽度均等于窗口宽度；宽表格在容器内部横向滚动。
- 试次详情保持实验管理导航选中。
- 合成视频可加载，逐帧滑块键盘调整可改变视频时间；四项核对全部勾选后“最终确认”启用。没有点击保存或最终确认，没有写入应用数据库。
- 暗色曲线、图例、素材缺失提示以及视频区经截图人工检查。

第一次临时媒体拦截只返回 HTTP 200，无法模拟实际媒体服务的字节范围读取，滑块检查失败；补齐与后端一致的 Range / 206 响应后检查通过。没有因此改动业务同步算法。宿主 Python 依赖下载缓慢，夹具响应生成改用已运行后端容器，取消了冗余宿主安装；后端源码未修改，未运行 pytest。

检查输出：[visual-check.log](visual-check.log)。留存截图：

- [实验目录（合成数据）](science-experiments-v4.png)
- [离线结果（仓库合成视频）](science-result-v4.png)
- [登录页面](science-login-v4.png)

## 当前交付状态

可在本机开发服务器查看；尚未提交、推送或更新 PR #38。报告页保留示例状态，新独立 Agent 工作区接入不属于本轮视觉优化。

## 首页按钮对比度修复（用户截图反馈）

用户截图中的浅色按钮出现白字白箭头。根因是 `landing.css` 的 `.landing a` 比 `.pill-white` 优先级高，覆盖了按钮原定的深色前景。本次只把通用链接选择器改为 `.landing :where(a)`，让按钮等组件自己的颜色正常生效，保留原定浅灰按钮背景。

Chromium 实测：顶部、首屏和页尾共三个浅色按钮，修复前前景与 SVG stroke 均为 `rgb(247,247,247)`；修复后普通、悬停及聚焦状态均为 `rgb(25,25,25)`，普通背景保持 `rgb(233,233,233)`。已目视核对 [修复后截图](welcome-button-contrast-v1.png)。

验证命令及结果：`cd frontend && bun x biome lint src/features/marketing/landing.css --reporter=summary` 退出 0，保留该 PR CSS 原有的 13 条非阻断 warning；`bun run build` 通过（`✓ built in 1.19s`）；`git diff --check -- frontend/src/features/marketing/landing.css` 通过。未添加测试文件。

## 参考图首屏重构（ClawsGO 风格截图反馈）

用户指定新的首屏参考图后，调整 `LingSightLanding.tsx` 和 `landing.css`，新增 `research-window.css`。标题和导航共用居中 1280px 内容宽度；首屏改为两行标题、双入口、渐隐点阵背景，以及带透视、倾斜和右侧/底部渐隐的大幅科研任务界面。预览内容保留 LingSight 品牌，展示水迷宫研究步骤、报告及明细文件示意，不复制参考图的品牌或科研结论。任务区域为不可交互的装饰预览，已明确标注，未接入新 Agent 服务。

最小验收：首屏截图与参考构图对照、按钮对比度、基本导航、不同窗口宽度和生产构建。使用 Chromium 检查 2048×1038、1440×900、1024×768、390×844；各页面整体宽度均与窗口一致，三个浅色 CTA 的文字均保持 `rgb(25,25,25)`，无浏览器未捕获异常。功能锚点、结果导出介绍 tab、登录入口及未登录进入工作台时的登录跳转均通过。详见 [hero-reference-check.log](hero-reference-check.log) 和 [2048px 桌面截图](hero-reference-2048-v3.png)、[1440px 桌面截图](hero-reference-1440-v3.png)。

命令：`cd frontend && bun x biome check src/features/marketing/LingSightLanding.tsx src/features/marketing/research-window.css`；两文件通过（无 warning/error）。`bun x biome lint src/features/marketing/landing.css --reporter=summary` 退出 0，保留原 CSS 的 13 条 warning。`bun run build` 的输出单独记录在 [hero-reference-build.log](hero-reference-build.log)。`git diff --check -- frontend/src/features/marketing` 通过。未修改后端，未重复执行数据库测试。

## 机构名称滚动带（参考图追加需求）

用户确认使用截图中的机构并选择国内外名校。在首页首屏下新增 `InstitutionMarquee.tsx` 和 `institution-marquee.css`，由 `LingSightLanding.tsx` 引入。展示 Yale、MIT、Stanford、清华、Harvard、北大、Princeton、ETH Zürich、浙大和东京大学十所学校，以文字字标呈现，不使用官方徽章素材。标题为“面向全球科研工作者”，下方注明名称为示例，不声称合作或用户背书。

两个等宽名称组以 70 秒周期连续左移，两侧遮罩渐隐；重复组对辅助技术隐藏。支持悬停暂停及暂停/继续按钮；系统开启减少动态效果时改为静态排列。此组件没有后端接口依赖，最小验收为连续滚动、暂停恢复、重复组等宽和窄屏无页面溢出。

`cd frontend && bun x biome check src/features/marketing/InstitutionMarquee.tsx src/features/marketing/institution-marquee.css src/features/marketing/LingSightLanding.tsx` 通过，3 文件无问题；`bun run build` 通过，见 [构建日志](institution-marquee-build.log)。营销目录 `git diff --check` 通过。

Chromium 检查 2048px 桌面及 390px 手机：滚动正常，两个名称组宽度在 0.1px 浮点容差内相等，暂停、恢复和悬停暂停通过，无页面横向溢出或未捕获异常。减少动态效果下动画关闭且重复组隐藏。见 [浏览器检查日志](institution-marquee-check.log)、[桌面截图](institution-marquee-desktop-v1.png)、[手机截图](institution-marquee-mobile-v1.png) 及 [静态排列截图](institution-marquee-reduced-v1.png)。

## 主页入场与流程动画（用户提供的触发机制）

目标：按用户提供的参数实现首屏加载入场、下方区域进入视口后一次性播放、科研流程自动上移，以及 36 秒机构滚动循环。使用原生 React 与 CSS，没有新增依赖或第三方源码。

- 新增 `InView.tsx`：稳定外层容器使用 `IntersectionObserver`，阈值 0.35；触发后设置 `data-inview` 并断开观察，CSS 从暂停切换为播放。组件卸载时清理观察器和系统偏好监听。初始静态内容可见；缺少观察器或开启减少动态效果时保留静态展示。
- 同文件 `ScrollPreview`：测量窗口与内容的实际高度，以 `ResizeObserver` 更新最终位移 `min(0, 窗口高度 - 内容高度)`，适应字体加载和窄屏换行。
- 新增 `landing-motion.css`：标题 1 秒渐显，首屏界面元素分批执行 2 秒下落；实现 650ms 上浮缩放、450ms 模糊渐显、280ms 分词渐显、350ms 弹出、450ms 行入场和 900ms 短暂高亮。流程窗口高 16rem，延迟 3 秒后在 3.9 秒内上移，两端渐隐，结束后保持位置。
- `LingSightLanding.tsx`：替换原空实现的 Reveal，为现有功能卡片、时间线和功能介绍接入观察器；在视觉识别步骤中加入流程演示，保留演示标识与页面导航。动画仅影响内层，外层倾斜保持固定。
- `landing.css`：桌面首屏透视调整为 4000px，保留手机构图。`institution-marquee.css`：周期从 70 秒调整为用户指定的 36 秒，保留暂停功能。

验收：`cd frontend && bun x biome check src/features/marketing/InView.tsx src/features/marketing/landing-motion.css src/features/marketing/LingSightLanding.tsx src/features/marketing/institution-marquee.css` 检查 4 个文件通过；`bun run build` 通过，见 [构建日志](landing-motion-build.log)。营销目录 `git diff --check` 通过。

临时 Playwright 脚本实测进入视口前时间为 0、20% 可见时未触发、40% 可见时触发；等待期位移为 0，页面停止滚动后内容继续上移。离开视口后动画完成，返回后仍停留在 6900ms，不重新播放。桌面内容高 645px、窗口高 256px，最终位移 -389px；390px 窄屏内容高 794px，位移自动变为 -538px。1440、1024、390px 下无页面横向溢出；功能介绍依次入场和结果导出 tab 可用。运行中切换及重新加载减少动态效果设置，流程完整静态显示；模拟缺少 IntersectionObserver 时内容正常显示；无浏览器未捕获异常。

留存 [浏览器日志](landing-motion-check.log)、[首屏截图](motion-hero-settled-v1.png)、[流程起始](motion-workflow-start-v1.png)、[流程移动中](motion-workflow-moving-v1.png)、[流程完成](motion-workflow-finished-v1.png)、[手机流程](motion-workflow-390-v1.png) 和 [浏览器验收录像](landing-motion-demo-v1.webm)。本轮未修改后端或执行数据库测试，动画演示不代表实时科研任务已接入。

## 截图指定内容删除

按用户最新截图删除首屏底部预览说明、机构名称示例说明，以及整个历史统计数据区域（标题、四项数字和脚注）。调整 `LingSightLanding.tsx`、`InstitutionMarquee.tsx`，清理 `landing.css`、`research-window.css`、`institution-marquee.css` 中失去引用的样式及 `aria-describedby`。机构滚动带之后直接衔接功能卡片，其他区域的历史数据引用保留。

四个格式化源文件 Biome 检查通过，生产构建通过，营销目录 `git diff --check` 通过。Chromium 确认被删除的元素不再存在、机构滚动带仍在、下一块为功能介绍。前文截图与说明记录的是此前版本。

## 主页全英文

按用户要求，将 `LingSightLanding.tsx` 的导航、标题、按钮、任务预览、流程演示、交付说明、标签页及页尾统一改为英文，并给主页根元素设置 `lang="en"`。`InstitutionMarquee.tsx` 中机构名称及暂停控件英文化；`ResearchVisuals.tsx` 中图表无障碍说明与校准日志英文化；`routes/welcome.tsx` 的页面标题改为英文。`institution-marquee.css` 调整英文校名字体，`landing-motion.css` 为分词动画保留词间距；流程问题按英文单词依次入场。保留历史数值与功能状态含义，没有修改应用工作台的语言。

五个格式化源文件 Biome check 通过；`ResearchVisuals.tsx` 的 Biome lint 退出 0，保留原有 5 条字符串模板建议；生产构建通过，见 [构建日志](homepage-english-build.log)。相关目录 `git diff --check` 通过。浏览器遍历 Calibration、Metrics、Export 标签页，确认主页文本及 aria-label/title/alt/placeholder 无汉字残留，页面标题和语言标记正确；1440、1024、390px 无页面或抽查组件横向溢出。暂停/继续与流程自动上移正常，英文换行后的流程位移自动更新，无浏览器未捕获异常。

留存 [检查日志](homepage-english-check.log)、[英文桌面首页](homepage-english-desktop-v1.png)、[英文手机首页](homepage-english-mobile-v1.png) 和 [英文流程演示](homepage-english-workflow-v1.png)。
