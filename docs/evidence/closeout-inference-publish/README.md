# #43 发布管道收尾证据（2026-11-11）

基线 `d81e55a`，独立工作树 `closeout/inference-publish`。仅使用合成科研产物和
`scripts/test-local.sh` 创建并销毁的独立 MySQL 8.4；未修改现役容器、研究库、
推理服务或用户工作树，未代替用户确认真实科研结果。

## 修复与契约

- 发布请求必须是合法 UUID，先阻断目录穿越，再访问上游。任务 JSON 有大小上限，
  非 JSON、非对象、编码错误返回 502；人工 review 门禁仍先于任何产物下载。
- 核对请求任务 ID、视频与模型 SHA-256、人工确认快照、冻结 7px 算法/主半径/
  关键点协议、帧号与范围、朝向状态/提案标记/极性标记。保留科研数值，拒绝非法输入。
  上游朝向四舍五入可得到 360°，原值可无损入库。
- 并发先声明任务唯一汇总行，再写帧；保留驱动唯一键错误进行同项目重放或跨项目
  409 判定。避免先删帧引发 MySQL 间隙锁死锁；不覆写已发布版本。
- 回读强制刷新 ORM identity map，确保核对数据库科学载荷。DB 连接层篡改质心会
  导致整笔事务回滚；2003 帧用例覆盖实际 2000 行分段边界。
- 已只读核对推理仓 `105a347` 的 `app/vision.py`、`app/heading.py`、
  `app/frozen_ball.py`：追踪从 seed 帧起，关键点覆盖全视频，seed 前缺失 mask
  合法；不能强制追踪产物也覆盖全视频。
- `published_result` / `published_frame` schema 与已生成的前端 API 类型均未变化。
  项目用户归属校验、人工门禁、内容指纹重放、跨项目拒绝及项目删除级联已有回归。

## 可重放验证

仓库根目录除非另有注明。日志均保存于本目录。

| 命令 | 结果 | 输出 |
| --- | --- | --- |
| `cd backend && uv run bash scripts/lint.sh` | mypy / ty / ruff / format 全绿 | `backend-lint.txt` |
| `cd backend && bash scripts/test-local.sh` | **212 passed, 6 skipped**，coverage 91% | `backend-full-tests.txt` |
| `bun install --frozen-lockfile` | 472 packages，锁文件未改变 | `frontend-install.txt` |
| `cd frontend && bun run build` | tsc + Vite 成功 | `frontend-native-build.txt` |
| `docker run --rm --user 1000:1000 -v "$PWD":/app -w /app/frontend oven/bun:1 bun run build` | 容器工具链 tsc + Vite 成功 | `frontend-docker-build.txt` |
| `cd frontend && PLAYWRIGHT_BASE_URL=http://127.0.0.1:5299 bun x playwright test tests/inference-workspace.spec.ts tests/agent-workspace.spec.ts --no-deps --project chromium --grep '发布\|逐帧行摘要' --reporter line` | **4 passed** | `frontend-publish-tests.txt` |

Playwright 使用本工作树独占的 `bun run dev --host 127.0.0.1 --port 5299 --strictPort`，
所有 API 为既有浏览器夹具；运行后已停止此预览服务。没有复用其它工作树的 5173。
六项 skip 来自 `test_assets_research_live.py` 的真实研究库门控；本轮未依赖研究库。

`scripts/fe.sh build` 的共享卷首次安装阶段等待超过四分钟，已停止本次创建的 bun
容器（`frontend-build.txt` 留存启动记录）；随后使用锁文件在宿主安装依赖，并在相同
`oven/bun:1` 镜像内成功构建，见上表。

## 修复前证据

- `regressions-before.txt`：新增回归在旧实现上 **9 failed / 4 passed**，复现并发
  500、目录形 task ID 被转发、帧号/朝向/极性/7px 参数/哈希/来源快照漏检。
- `readback-before.txt`：数据库连接直接改变质心后，旧实现仍返回 201，测试失败。
  修复后该 HTTP 回归返回 500，汇总和逐帧行均无残留。
- `publish-tests.txt`：中间版本的定向发布测试记录；最终完整结果以上表全量日志为准。

## 剩余验收

真实主站部署、L3 真产物发布与研究者人工复核闭环，仍由部署和用户最终验收完成；
本证据不声称已完成这些步骤。Agent 按 project 消费应用库数据属于 #44。
