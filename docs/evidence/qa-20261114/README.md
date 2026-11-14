# QA B02–B07 修复验证

基线 `860ebb4bc0b584d6ad43c3a5a19765ca71adc634`（origin/main）。正式站旧报告的六项问题在此版本全部仍可复现，没有 obsolete 项。工单：[姓名校验 #57](https://github.com/tudousir123/lingsight-ai/issues/57)、[报告预览 #58](https://github.com/tudousir123/lingsight-ai/issues/58)、[目录历史 #59](https://github.com/tudousir123/lingsight-ai/issues/59)、[任务 404 #60](https://github.com/tudousir123/lingsight-ai/issues/60)、[后台运行提示 #61](https://github.com/tudousir123/lingsight-ai/issues/61)、[中文文案 #62](https://github.com/tudousir123/lingsight-ai/issues/62)。

用户确认的 TDD 边界是浏览器页面和 HTTP API 合成夹具。正式站复测仅登录与读取；超长姓名提交在浏览器被拦截。真实报告和凭据不入库，本机复测截图与详细记录在 `~/mattdev-qafix/REPORT.md`。

## Red → green

每个功能先执行失败测试，再修改实现；各次完整输出保存在本机 `~/mattdev-qafix/evidence/`。

| 工单 | 修复前失败断言 | 修复后证据 |
| --- | --- | --- |
| #57 | 256 字符姓名未标 aria-invalid；服务端 422 未定位字段 | 4 个测试通过，含 255 字符提交与两表单 422 字段提示 |
| #58 | 缺少一级/二级标题、引用、强调和列表语义 | 渲染、源码编辑和原有 HTML 安全测试通过；另覆盖危险链接与远程图片 |
| #59 | 打开目录后 URL path 仍为空；迟到响应覆盖后退后的根目录 | 刷新/前进/后退/返回上一级、source_id 和迟到响应测试通过 |
| #60 | 缺少“任务不存在或已被删除”状态 | 404 停止请求、返回列表再打开合法任务，以及 503 恢复通过 |
| #61 | 7 种状态中 5 个不应显示的状态失败，排队/运行两个通过 | 7 种状态全部通过 |
| #62 | 认证、设置、管理页面及登录错误的中文断言失败 | 中文标题、操作、字段校验、删除确认和服务错误测试通过 |

定向回归 56 passed；追加安全/恢复/迟到响应测试 3 passed。本机完整 API 夹具套件 **98 passed, 4 skipped (1.3m)**；跳过项为既有视频预览模式开关，不是失败重试。390×844 窄屏的 #57–#60、#62 **17 passed (12.3s)**。#61 明确检查桌面文案，手机本就隐藏该提示。

## 重放

依赖安装：仓库根 `bun ci`。启动独立前端（未覆盖的 API 请求指向不可用端口，不进入正式站）：

```bash
cd frontend
VITE_API_URL=http://127.0.0.1:9 bun run dev --host 127.0.0.1 --port 5197 --strictPort
```

另一个终端执行（浏览器先用 `bun x playwright install chromium` 安装）：

```bash
cd frontend
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5197 bun x playwright test --project=chromium --no-deps --reporter=list tests/{account-forms,agent-workspace,inference-workspace,landing-navigation,manual-annotation,onboarding,project-research,project-video-folder,research-copilot,trial-directory,user-settings-validation,video-workflow}.spec.ts
bun run build
```

本机使用临时 Playwright 配置指定已安装 Chromium、3 workers、空 storageState，以上测试文件自身也声明空 storageState。实际运行命令：`bun x playwright test --config=/home/x/mattdev-qafix/playwright.config.mjs`；移动验证在同一命令前设 `QA_MOBILE=1` 并加 `-g '#57|#58|#59|#60|#62'`。本机 Bun 1.3.9；CI 固定 Bun 1.3.12。

本机 `bun run build`（TypeScript + Vite）通过。涉及真实账号持久化和邮件的原有测试留给 GitHub CI 的隔离栈，本机不对正式后端运行这些测试。未部署此修复。

Markdown 使用 MIT 许可的 [react-markdown](https://github.com/remarkjs/react-markdown)，保留默认安全 URL 转换、原始 HTML 文本显示，并禁止图片节点；未启用 raw HTML 插件。只读预览不触发远程图片请求。

## 自审修正

Standards 轴发现姓名上限手写复制后端约束，已改为从同一 OpenAPI 文档生成 `src/client/userConstraints.gen.ts`，由 SDK 生成脚本一起维护；生成器检查注册与新增用户契约一致。404 判断集中到 `isTaskNotFound`，用于查询刷新、页面状态和事件轮询。

Spec 轴发现非姓名 422 的泛化提示丢失字段/限制，追加失败测试后修复为读取 `loc`、错误类型与 `ctx`，输出例如“密码最多 128 个字符”；服务端原始技术文案不会直接显示。修正后的相关回归 **7 passed (6.0s)**，本机构建、定向 Biome 和 SDK 再生成通过。
