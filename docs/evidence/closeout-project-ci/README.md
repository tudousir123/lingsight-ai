# Project 实体与 CI 收尾（2026-11-11）

范围：#42 / PR #46 的 Project CRUD、用户隔离、任务/视频归组、旧 localStorage 幂等导入验收；#47 的本机隔离 E2E；#48 的确定性滚轮测试。基线为 feat/project-entity 的 `3e866a6`。未触碰桌面主树、现役数据库、远端分支或工单状态。

## 已定位并修复

- CI Compose build 失败在 Ubuntu apt 镜像同步（不是应用编译）。Playwright 镜像改从固定 Bun 1.3.12 镜像复制可执行文件，去掉 apt/unzip/远程安装脚本。两个 Dockerfile 均使用完整 workspace manifests + `bun ci`；后端下载超时调为 120 秒。
- 账号 spec 仍断言退役首页与旧退出菜单，trial spec 仍访问 ADR-0014 移除的详情路由。改为验当前工作区、目录过滤/刷新、权限失败边界；所有归组、迁移、推理用例保留。
- 侧栏遗漏外观入口：恢复既有 SidebarAppearance。主题保留用例等待菜单关闭及可见 class，去掉立即 evaluate 的时序假设。
- 滚轮 spec 在 React 监听器挂载前发事件；最终场景又把鼠标停在 textarea。等待已渲染场景、在非编辑器区域发真实滚轮，以 Playwright 虚拟时钟推进既有冷却；不改产品滚轮行为。
- welcome 路由在挂载后确定初始 fragment 的位置；reload 临时禁用浏览器旧滚动位置恢复并归顶，离开页面恢复原设置。避免 SPA 未挂载目标或浏览器后续恢复覆盖归顶。
- `e2e-local.sh` 每次用随机 Compose project / 合成随机账号密码 / 独立卷网络，无宿主端口，只加载 `compose.yml` + `compose.e2e.yml`，忽略开发 `.env`。成功、失败、INT/TERM 自动清理自身资源，`--keep` 可保留调试。Playwright 用宿主 UID/GID 写报告，旧认证缓存不进入镜像。
- 吸收本地 `b28d066` 的 CI 全量后端 lint 门禁；现有分支已包含 `.env` 无关的 SDK 生成修复，无需重复改写。

## 可重放验证

从此 worktree 根目录执行：

```bash
(cd backend && uv run bash scripts/lint.sh)
(cd backend && bash scripts/test-local.sh)
uv run --project backend pytest backend/tests/scripts/test_e2e_local.py -q
(cd frontend && bun run build)
LINGSIGHT_E2E_BUILD_NETWORK=host LINGSIGHT_E2E_HTTP_PROXY="$HTTP_PROXY" bash scripts/e2e-local.sh
```

本机下载 CDN 需要代理，最后一条显式让镜像构建访问本机代理；测试容器仍是独立网络。其他环境可以直接 `bash scripts/e2e-local.sh`。根 `.env` 在验收期间不存在。

- 后端完整测试：173 passed / 6 skipped（真实研究库门控），coverage 90%；9 个 Project API 用例均通过。见 `backend-tests.txt`。
- 隔离 runner：4 passed，覆盖成功、构建失败、SIGTERM、SIGINT，均校验未继承开发项目/账号/Agent 地址及自动清理。见 `runner-tests.txt`。
- 前端 tsc + Vite 构建通过；Agent / inference / onboarding / landing API 夹具共 37 passed。见 `frontend-build.txt`、`frontend-fixtures.txt`。
- 本机旧滚轮测试先红（停在 01/04），修复后连续 3 次通过。见 `onboarding-before.txt`、`onboarding-after.txt`。
- welcome 定向回归连续 5 轮，共 15 passed。见 `landing-after.txt`。
- 定向 prek 全部适用检查通过（Biome、ruff、mypy、ty、YAML、typos 等）。见 `prek.txt`。

最终全栈 Playwright **95 passed（2.2 分钟）**，无 flaky；自建栈自动清理，现役栈 inspect 完全一致，报告归宿主用户。见 `full-stack.txt`、`isolation.txt`。

本轮子进程通过后，runner 自身最终返回 127：测试运行期间补充 SMTP 空凭据导出时修改了正在执行的 shell 文件，Bash 按旧字节偏移恢复读取，读到了不存在于最终源码的 `ail-on-flaky-tests` 残片。该行原样保留在日志中；最终脚本 `bash -n` 和四种退出路径回归均通过。此日志证明浏览器全套通过与隔离清理，不声称 runner 的该次退出码为 0；最终整合树需在运行期间保持脚本不变再验其干净退出。

SMTP_USER / SMTP_PASSWORD 已在最终 runner 中显式清空并写入私有 env；E2E Compose 也将它们固定为空，防止保留栈的手动检查重新继承宿主 SMTP 凭据。四路 runner 用例含对应断言。

## 边界

GitHub 历史红灯未在远端重跑：Compose run `42832301535`、Playwright run `42832301596`；本次不 push、不合并、不修改工单。Agent / inference 的私有服务在浏览器 spec 中使用 API 夹具，本证据不代表真实推理发布或科研 Agent 服务端到端联验。浏览器旧分组跨设备的改名/删除取舍仍以 ADR-0016 为准。
