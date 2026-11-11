# 旧项目导入与首次列表读取竞态修复

日期：2026-11-11。修复前基线：`f0e7b9e`。验证环境：Node `v24.22.0`、Playwright `1.63.0`、本机独立 Vite 端口 `5197`；浏览器 API 全部使用测试夹具，不访问真实账号、研究库或既有容器。

## 根因与修复

CI 分片 2/4 的首次项目列表 GET 与迁移 POST 并发。导入成功时，首次 GET 仍未结束，React Query 中没有该查询的缓存数据。此时 `invalidateQueries` 会复用首次 GET 的 Promise，而非取消并重新请求。首次 GET 返回导入前的空快照后，界面仍为空，且不会再发列表 GET。失败 trace 的请求顺序与此一致：GET `projects/` 紧邻 POST `projects/import`，二者均为 200，之后没有列表 GET。

`useLegacyProjectImport` 在导入成功后，先取消该账号的精确项目列表查询，再使它失效，确保读取导入后的列表；晚到的旧响应无法覆盖新查询结果。迁移标记与旧缓存清理规则保持不变。没有增加超时或重试，也没有修改 CI 的 flaky 门禁。

现有迁移端到端测试增加两个 Promise 门：先确认首次 GET 已开始，再允许导入完成；首次 GET 的空响应一直延后到迁移标记写入后才释放。保留原有项目可见、成员可见、旧缓存清除与刷新不重导入的断言。

## 可重放验证

在 `frontend/` 启动独立前端：

```bash
node ../node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5197 --strictPort
```

以下测试都显式关闭重试、跳过真实登录 setup，仅使用 spec 自带的空登录态与 API 桩。

修复前，将生产文件恢复为基线 `f0e7b9e` 的 `frontend/src/features/agent/projects.ts`，保留新增门控测试，运行：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5197 node ../node_modules/@playwright/test/cli.js test tests/agent-workspace.spec.ts --grep 'localStorage' --project=chromium --no-deps --workers=1 --retries=0 --reporter=line
```

结果：**1 failed**，精确复现 `学习与记忆` 链接不存在、`toBeVisible` 5000ms 超时。见 [red.log](red.log)。采集后已立即恢复修复代码。

修复后，重复执行同一受控竞态：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5197 node ../node_modules/@playwright/test/cli.js test tests/agent-workspace.spec.ts --grep 'localStorage' --project=chromium --no-deps --workers=1 --retries=0 --repeat-each=10 --reporter=line
```

结果：**10 passed (38.1s)**，见 [repeat.log](repeat.log)。

相关工作区与项目分析用例：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5197 node ../node_modules/@playwright/test/cli.js test tests/agent-workspace.spec.ts tests/project-research.spec.ts --project=chromium --no-deps --workers=1 --retries=0 --reporter=line
```

结果：**20 passed (54.2s)**，见 [suites.log](suites.log)。

静态检查：

```bash
node ../node_modules/@biomejs/biome/bin/biome check src/features/agent/projects.ts tests/agent-workspace.spec.ts
node ../node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit
```

Biome：**Checked 2 files. No fixes applied.**，见 [biome.log](biome.log)；TypeScript：**退出码 0，无诊断**。

这些证据只覆盖本次前端竞态和相关夹具回归；提交后的远端 CI 结果另行核验。
