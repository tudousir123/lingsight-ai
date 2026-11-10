# 科研入门引导验收 · 2026-11-09

根据用户反馈，引导改为「认识平台 → 看看示例 → 选择方向 → 准备问题」四屏。先说明平台用途、当前数据入口和交付物，再用一个训练日问题解释核对、分析和报告流程，最后提供带用途说明的选项。示例不展示虚构分析结果，明确实际产出取决于数据完整性与动物映射核验。

使用原生 CSS scroll snap，滚轮向下推进、向上回看，支持触屏。长屏允许先阅读余下内容；输入框使用 overscroll containment，长文本滚动不连带翻屏。选项只更新问题，不立即跳页。保留键盘可用的前后翻页按钮；辅助翻页只滚动 main，页面框架固定在视口，避免祖先滚动容器把顶部栏带走。最后由用户明确进入工作台，发送后才创建分析任务。

修改文件：`frontend/src/features/research/Onboarding.tsx`、`frontend/src/features/research/research.css`、`frontend/tests/onboarding.spec.ts`、`frontend/README.md` 和本记录。沿用 `brief.ts` 的研究说明、存储恢复和下载机制；未增加依赖。

在 `frontend/` 执行：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 bun x playwright test tests/onboarding.spec.ts --project=chromium --no-deps --reporter=line --workers=1 --output=/tmp/lingsight-onboarding-scroll-tests

bun x biome check src/features/research/Onboarding.tsx src/features/research/research.css tests/onboarding.spec.ts

bun run build --outDir /tmp/lingsight-onboarding-scroll-build
```

结果：Playwright **10 passed (38.0s)**，完整输出见 [scroll-tests.log](scroll-tests.log)；Biome **Checked 3 files，No fixes applied**；TypeScript + Vite 构建退出码为 0，3071 modules transformed，built in 1.21s。

浏览器测试覆盖三类方向、输入接力和恢复、返回保留修改、切换方向、数据范围、跳过、空输入、存储失败下载、非法存储、键盘与减少动态效果，以及滚轮双向翻页、选择后停留、长文本框滚动和 390×640 短屏真实触摸事件。使用空登录状态并拦截 API 请求，不访问真实科研库，不运行 pytest。

视觉检查包括 1440×960 桌面四屏、390×844 移动欢迎屏和 390×640 触屏内容。修正了辅助翻页带动外层容器的问题，顶部栏与底部进度保持可见；页面无 JavaScript 错误、无横向溢出。截图使用独立新文件名，保存在本机 `/tmp/lingsight-guide-*-scroll-r*.png`。

本次验收仅证明引导交互与前端构建，未执行真实科研任务，不代表完整科研闭环联验或正式部署完成。构建输出到临时目录，未替换后端静态资源。


## 英文引导与 70ms 打字节奏 · 2026-11-10

根据用户反馈，将当前四屏引导统一为英文：Meet your assistant → Explore behavior → Research outputs → Start your research。包括标题、说明、进度、滚动提示、按钮、示例问题、可选数据范围、错误提示、下载研究说明、图示的辅助说明与页面标题。既有用户输入与已保存的问题保留原文，v1 研究说明结构不变；英文默认说明仍包含批次分开、动物映射核验、空间标定及朝向不等于视觉感知的科研约定。

用户将打字间隔明确指定为 **70ms/字符**。`GuideScene.tsx` 使用逐次 timeout，开始前停顿 350ms，逗号等附加 250ms、句末标点附加 350ms、换行附加 500ms。滚轮可随时进入下一屏；回看时显示完整标题；开启减少动态效果时立即显示全文，动态切换该设置也会取消剩余计时。离屏及卸载时清理 timer。

为英文长度补充手机排版：行为示意图上下布局、产出卡片文字适配、底部提示分行，保留完整的滚轮、键盘与编辑器滚动行为。修改文件为 `Onboarding.tsx`、`GuideScene.tsx`、`brief.ts`、`ResearchIllustration.tsx`、`research.css`、引导路由、引导与工作区测试，以及前端 README。

在 `frontend/` 验证：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 bun x playwright test tests/onboarding.spec.ts tests/agent-workspace.spec.ts --project=chromium --no-deps --reporter=line --workers=1 --output=/tmp/lingsight-english-onboarding-tests
# 28 passed (45.2s)，完整输出见 english-onboarding-tests.log。

# 最终由 100ms 调整为用户指定的 70ms 后复验：
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 bun x playwright test tests/onboarding.spec.ts --grep 'types its introduction|typing leaves|every introduction' --project=chromium --no-deps --reporter=line --workers=1 --output=/tmp/lingsight-onboarding-70ms-tests
# 3 passed (4.3s)，完整输出见 typing-70ms-tests.log。

bun x biome check src/features/research/Onboarding.tsx src/features/research/GuideScene.tsx src/features/research/brief.ts src/features/research/ResearchIllustration.tsx src/features/research/research.css src/routes/onboarding.tsx tests/onboarding.spec.ts tests/agent-workspace.spec.ts
# Checked 8 files. No fixes applied.

bun run build --outDir /tmp/lingsight-english-onboarding-build
# TypeScript + Vite exit 0; built in 844ms.
```

新增用例检查所有引导场景均无中文静态文案、390×844 手机无横向溢出，并通过浏览器时钟确认标题在两秒时仍处于逐字输出、切换减少动态效果后立即完成。既有示例切换、草稿恢复、失败下载、键盘/滚轮、离屏回看与工作台输入接力均通过。未访问科研库或执行真实分析任务。

实际查看 1440×900 桌面和 390×844 手机四屏，无页面脚本错误。最终 70ms 版本已实际打开并等待标题完成，截图 `/tmp/lingsight-guide-english-70ms-desktop-r2.png`；手机截图 `/tmp/lingsight-guide-english-mobile-step1-r1.png` 至 `step4-r1.png` 使用减少动态效果检查布局。


## 字符淡入与稳定排版 · 2026-11-10

根据「出字生硬」反馈调整 `GuideScene.tsx` 与 `research.css`。原先每次追加一个字符，使居中的未完成行持续移动；现在预先排好完整标题，每个字符占据最终位置，逐个改变透明度。保留用户指定的 70ms 出字间隔，每字使用 240ms ease-out 淡入，相邻字符的过渡重叠。光标采用绝对定位的伪元素，不参与文字排版；最后一字淡入结束后再展示辅助说明。回看和减少动态效果直接显示全文。淡入时长只定义在组件常量中，通过 CSS 变量共享给样式，避免计时与过渡时长漂移。

本轮修改文件：`frontend/src/features/research/GuideScene.tsx`、`research.css`、`frontend/tests/onboarding.spec.ts` 与前端 README。用户输入、任务 API 与科研口径不变。

验证：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 bun x playwright test tests/onboarding.spec.ts --project=chromium --no-deps --reporter=line --workers=1 --output=/tmp/lingsight-onboarding-smooth-tests
# 16 passed (32.0s)，完整输出见 smooth-typewriter-tests.log。

bun x biome check src/features/research/GuideScene.tsx src/features/research/research.css tests/onboarding.spec.ts
# Checked 3 files. No fixes applied.

bun run build --outDir /tmp/lingsight-onboarding-smooth-build
# TypeScript + Vite exit 0; built in 1.99s.
```

新增桌面 1440px 与手机 390px 的真实 requestAnimationFrame 采样：字符出现时存在 0 与 1 之间的透明度，且已显示字符的横纵位置变化小于 0.5px，证明实际淡入且无逐字重排。既有英文、草稿恢复、下载、键盘/滚轮、回看和减少动态效果用例通过。实际在用户当前的内置浏览器页重新加载查看，截图 `/tmp/lingsight-onboarding-smooth-live-r1.png`。未运行真实科研任务或后端测试。
