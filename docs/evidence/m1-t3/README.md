# M1-T3 验收证据（2026-10-13，工单 #4）

指标表 `water_maze.trial_metrics`（ADR-0003）：确定性 Python 从 `frame_predictions` 计算 549 个视频的首批 4 指标（游泳距离 / 平均速度 / 有效关键点帧占比 / 在池时间占比）并入库。root 凭据全程只经容器 env 注入进程 env，未落盘、未回显、未入库。

| 文件 | 内容 |
|---|---|
| `01-compute-run.log` | SHOW CREATE TABLE（幂等 DDL 由计算脚本应用）+ 计算运行日志 + 样本行（含 algo_version / unit / calc_status 列） |
| `02-idempotency-rerun.log` | 同 algo_version 重跑前后行数一致（2196 行 / 549 视频 / 4 指标），重复主键检查 = 0 |
| `03-golden-matrix-validation.log` | 组×日黄金矩阵逐格 PASS/FAIL（60/60 PASS）+ SQL 交叉核对 + qc sanity |
| `04-grant-verify.log` | root 执行 GRANT SELECT + `SHOW GRANTS FOR 'lingsight_ro'@'%'` 摘录 |

## 结果对照验收标准

- [x] 组×日均值与 docs/09 黄金矩阵逐格一致（浮点容差）：60/60 格 PASS。容差取 0.5% 相对：docs/08 记录 ok=783,790 帧，当前库 784,055（2026-10-11 修复管线刷新后 265 个 miss 帧翻转为 ok），实算最大格偏差 0.084%（c1 0804 距离 7988.69 vs 7982）。附加强证据：docs/09 黄金 CTE 在当前库重算并与 Python 写入值逐试次对照，最大相对偏差 7.4e-15（浮点求和次序量级）——Python 与 SQL 口径完全一致，矩阵偏差全部来自库数据刷新。
- [x] 指标行含算法版本、单位、计算状态列：`algo_version='v1-polyline-ok-frames'`、`unit ∈ {px, px/s, ratio}`、`calc_status`（本次 2196 行全部 ok；no_frames / no_ok_frames / insufficient_ok_frames / missing_pool_params 为防御性状态，由单测覆盖）。
- [x] 重跑幂等，不产生重复行：见 `02-idempotency-rerun.log`（事务内 DELETE+INSERT 同版本整替）；单测 `backend/tests/metrics/test_store.py` 覆盖重跑不重复、陈旧行清除、跨版本共存。
- [x] lingsight_ro 获得指标表 SELECT 授权：`GRANT SELECT ON water_maze.trial_metrics`，SHOW GRANTS 六表授权并存（datasets / platform_positions / qc_summary / rescue_code_definitions_20261011 / trial_metrics / videos）。

## 复现命令（凭据经容器 env，单条命令内传递）

```bash
cd backend
export METRICS_DB_PW=$(docker exec healthad-mysql printenv MYSQL_ROOT_PASSWORD)
uv run python -m scripts.metrics.compute_trial_metrics      # 建表（幂等）+ 计算入库
uv run python -m scripts.metrics.validate_golden_matrix     # 黄金矩阵验证，exit 0 = PASS
```
