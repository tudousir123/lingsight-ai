# 正式部署 preflight：TDD 与检查证据（#56）

用户确认测试接口为正式部署 preflight 命令，自审基线为 `860ebb4bc0b584d6ad43c3a5a19765ca71adc634`。

## Red → green

在允许写入的 `/tmp/lingsight-503-review` 副本按纵向切片执行；没有修改主工作区或重新部署镜像。

命令：从副本 backend 目录执行 `PYTHONDONTWRITEBYTECODE=1 /home/x/mattdev-503/wt/.venv/bin/python -m pytest -p no:cacheprovider tests/test_deploy_preflight.py -q`。

1. 配置缺失：测试先因部署命令尚不存在失败；增加命令与缺失项检查后 `1 passed`。
2. 连接失败：完整合成配置指向 `127.0.0.1:1`，测试捕获旧逻辑错误返回 0；复用真实目录的 `read_rows(..., "SELECT 1", ())` 后 `2 passed`。
3. 非法配置脱敏：非法端口触发 Pydantic 原始堆栈，未返回规定错误；增加配置校验/脱敏后 `3 passed`。所有输入均为合成值。
4. Compose 透传：用真实 `docker compose ... config --format json` 和合成 env 渲染正式文件，旧配置中 `RESEARCH_DB_HOST` 为缺失；新增五项必填环境映射后 `4 passed`。

随后进入评审阶段，提取重复的 Docker 进程替身夹具，扩展每项配置缺失/空白、端口范围及 Compose 错误脱敏覆盖。测试调用正式 shell 命令；只替换 Docker 进程边界，实际执行 Python 探针、配置模型和 MySQL 驱动。另一个测试使用真实 Compose CLI 验证 env 透传，不启动容器。

## 早期受限环境的验证记录

- `PYTHONDONTWRITEBYTECODE=1 /tmp/lingsight-503-review/.venv/bin/python -m pytest -p no:cacheprovider backend/tests/test_deploy_preflight.py -q -k 'not authenticated_isolated'`：16 passed，1 deselected。
- mypy / ty：均通过（实际命令及输出见下）；`_env_file=None` 是 BaseSettings 的有效运行时参数，mypy 在此配置类上生成的签名遗漏它，所以仅此行使用精确 `call-arg` 抑制，两个类型检查器均已验证接受。保留 dotenv 隔离，不通过放宽全局规则掩盖问题。
- 新增的真实隔离库成功路径应由 `cd backend && bash scripts/test-local.sh` 运行；它依赖受保护的 `TEST_DATABASE_URL` 与 `lingsight_test_*` 库。当时沙箱拒绝 Docker daemon，未能执行；权限恢复后的结果见下。
- 当时沙箱拒绝 GitHub 网络，不能提交 PR 或运行 CI；本记录不将早期离线检查算作 CI 全绿。

正式站上轮配置修复、API 与 Playwright 验收证据见本目录 README；不能用上轮站点验收替代本次新命令的成功路径测试。

## 静态检查与既有护栏检查的实际输出

以下从 `/tmp/lingsight-503-review/backend` 执行；复制的虚拟环境已将 editable 路径指向此副本，避免误检查原 worktree。

```bash
PYTHONDONTWRITEBYTECODE=1 MYPY_CACHE_DIR=/tmp/lingsight-503-mypy-fixed /tmp/lingsight-503-review/.venv/bin/python -m mypy app scripts
# Success: no issues found in 52 source files
PYTHONDONTWRITEBYTECODE=1 /tmp/lingsight-503-review/.venv/bin/ty check --python /tmp/lingsight-503-review/.venv app scripts
# All checks passed!
RUFF_CACHE_DIR=/tmp/lingsight-503-ruff /tmp/lingsight-503-review/.venv/bin/ruff check app scripts tests/test_deploy_preflight.py
# All checks passed!
RUFF_CACHE_DIR=/tmp/lingsight-503-ruff /tmp/lingsight-503-review/.venv/bin/ruff format --check app scripts tests/test_deploy_preflight.py
# 53 files already formatted
```

以下从副本根目录执行：

```bash
PYTHONDONTWRITEBYTECODE=1 /tmp/lingsight-503-review/.venv/bin/python -m unittest discover -s scripts/tests -p 'test_*.py' -q
# Ran 38 tests in 4.350s
# OK
bash -n scripts/deploy-preflight.sh
git diff --check
# 两项均退出 0，无输出
```

## 权限恢复后的完整隔离验证

已将同一代码同步回指定 worktree `/home/x/mattdev-503/wt`，未修改主工作区的未提交文件。2026-11-14 从该 worktree 的 `backend/` 执行：

```bash
uv run bash scripts/lint.sh
# mypy: Success: no issues found in 52 source files
# ty: All checks passed!
# ruff: All checks passed! / 52 files already formatted
bash scripts/test-local.sh
# tests/test_deploy_preflight.py .................
# 264 passed, 7 skipped, 1 warning in 49.08s
# TOTAL 2435 statements, 207 missed, 91% coverage
```

17 项新增 preflight 测试全通过，包括真实隔离 MySQL 的认证后成功查询。测试只启动并清理一次性的 `lingsight-tests-*` 容器，持久化仅使用 `lingsight_test_*` 数据库。7 项跳过属于未配置真实科研依赖的 env-gated 用例。未使用科研库代替隔离库，也未操作任何正式 Docker 服务。

本轮依用户指示不对正式 Docker 运行新 preflight；真实 Compose 环境透传由合成 env 的渲染测试核对，执行成功路径在隔离库验证。PR 的远端 CI 结果以对应 head SHA 的 GitHub checks 为准，最终记录保存在 `/home/x/mattdev-503/REPORT.md`。
