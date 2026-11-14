# 2026-11-14 正式站科研目录 503 修复与登录后补验

工单：[#56](https://github.com/tudousir123/lingsight-ai/issues/56)。此次只修复正式运行配置；镜像仍为 `lingsight-platform:860ebb4bc0b584d6ad43c3a5a19765ca71adc634`。未合并的防复发代码不部署到正式镜像。

## 根因与处置

登录成功后 `GET /api/v1/experiments` 返回 `503 {"detail":"Research catalog unavailable"}`。后端缺少科研库环境变量，使用默认 `127.0.0.1:3306` 和空密码；正式科研 MySQL 实际为 `openscientist-water-maze-mysql` 的 `127.0.0.1:13306`。正式 Compose 还缺少科研库变量透传，单改 env 不足以修复。

Compose 标签定位的私有配置是 `/home/x/.config/lingsight/platform.env`，来源是 `/home/x/.proma/agent-workspaces/lingsight-ai/1bf7d713-c37f-4cc0-a46b-6b319c081e1b/release-source/compose.local-production.yml`。已有 OpenScientist/DBHub 配置使用另一账号；MySQL 中没有 `lingsight_ro`。按授权新建 `lingsight_ro`，用随机强密码，只授予 `water_maze.* SELECT`。核对 `SHOW GRANTS` 为 USAGE 与 SELECT，无角色授权；未复用权限范围更广的 DBHub 账号。

私有 env 增加 `RESEARCH_DB_HOST=127.0.0.1`、`RESEARCH_DB_PORT=13306`、`RESEARCH_DB_USER=lingsight_ro`、`RESEARCH_DB_NAME=water_maze`、`LINGSIGHT_RO_PASSWORD`，权限 0600。当前旧部署来源使用私有 `/home/x/.config/lingsight/compose.research.yml`（0600）显式透传这五项。后续使用本 PR 的 Compose 时已内置透传；不要遗漏当前旧来源的第二个 `-f`。

先用同一镜像的一次性 backend 容器执行真实目录只读查询成功，再以 `--no-build --no-deps --pull never` 仅重建 backend。其镜像 ID 保持不变；其余所有既有容器 ID、镜像和启动时间不变，见 [运行核验](runtime-acceptance.json)。没有修改科研或平台业务数据，没有运行迁移、推理、发布或科研任务，也没有修改 L3、推理服务、socat、8000 转发。

## 登录后界面补验：已完成

此前发布记录中的“登录后界面尚未验收”是旧验收凭据失效造成。本次使用用户指定的本机管理员凭据完成真实登录，未重置账号密码。

- [API 验收](api-acceptance.json)：experiments 200 且非空，trials 列表/详情/分页 200；用户、项目、Agent 任务列表、推理来源只读接口均为 200。
- [Playwright 验收](browser-verification.json)：15 项通过；工作区登录和刷新、既有项目对话/资料导航和刷新、手动标注入口、`/experiments` 与 `/annotations` 的试次目录显示真实行并支持刷新；无页面 JS 错误和意外业务写请求。
- 本机截图：`/home/x/mattdev-503/experiments.png`、`annotations.png`、`workspace.png`。截图含真实目录展示，按要求只保留本机，不提交仓库或工单。未截取登录凭据或认证状态。

复现及补验命令（只在获授权的本机执行，不输出凭据/数据内容）：

```bash
python3 /home/x/mattdev-503/probe.py
# 修复前连续两次：status=503, nonempty=false, detail=Research catalog unavailable, FAIL
# 修复后：status=200, nonempty=true, PASS
python3 /home/x/mattdev-503/accept-api.py
# 8 项只读检查通过
node /home/x/mattdev-503/verify-browser.cjs
# 15 项通过，pageErrors=[], blockedWrites=[]
```

本次验收不代表视频文件已接入、标注保存、GPU 推理、人工确认、结果发布或科研结论通过；这些不是此次只读目录修复的范围。

## 当前运行与回滚

从上述 `release-source` 执行：

```bash
docker compose --env-file /home/x/.config/lingsight/platform.env -f compose.local-production.yml -f /home/x/.config/lingsight/compose.research.yml config --quiet
docker compose --env-file /home/x/.config/lingsight/platform.env -f compose.local-production.yml -f /home/x/.config/lingsight/compose.research.yml up -d --no-build --no-deps --pull never --wait --wait-timeout 180 backend
```

修复前配置备份：`/home/x/.config/lingsight/backups/platform-before-catalog-503-20261114.env`（0600）。回滚此修复仅恢复这五项科研配置的原值/缺失状态，保留后来其他合法变更；并从 Compose 命令移除私有 `compose.research.yml`，使用同一旧来源和同一镜像仅重建 backend，再检查健康/登录。回滚将重新出现目录 503；优先纠正科研连接配置。新只读账号可保留，避免破坏其他后续消费者；无需恢复数据库、删除账号或修改任何业务数据。不要把整份旧 env 直接覆盖到已发生其他配置更新的环境。
