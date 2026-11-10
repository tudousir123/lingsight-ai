# 科研管线权威实现位置（code map）

为何存在：#41 票面写"从 A100 取回冻结球弦实现"，实际唯一生产实现在**本机** `~/wm_heading_v9_20261105/`——按票面在 A100 上绕了约 8 步探索才命中（2026-11-10，retro-5）。找科研管线代码时先查本表，再动手搜。

| 管线阶段 | 唯一权威实现 | 现役拷贝 / 去向 |
|---|---|---|
| 冻结 7px 球弦朝向（v3 重算入库的生产路径，2026-11-05） | 本机 `~/wm_heading_v9_20261105/`：`frozen_ball.py`（几何模块，逐字拷贝自 2026-10-14 冻结版）+ `recompute_heading_v9.py` / `writeback.py`（8 月）/ `october_ingest_v3.py`（10 月） | `lingsight-inference/app/frozen_ball.py` 逐字拷贝（sha256 `ea915df0…`，见其 ADR-0001；推理服务为唯一生产者）+ `app/heading.py`（编排） |
| v9 关键点推理（A100 批量，2026-11-02） | A100 `/home/nbustu/v9_keypoints_all_20261102/` | 推理协议在 `lingsight-inference/app/vision.py` keypoints 阶段复刻；权重哈希见其 README |
| 主库 v9 staging 上载（2026-11-03） | 本机 `~/workspace/v9_mysql_update_20261103/`（`update_mysql.py`） | 主库三表应用仍未执行（见 `水迷宫朝向/archive/v9处理流程.md` §C） |
| 8 月 mask 追踪与八月版朝向 | A100 `/home/nbustu/batch3v8/`（`run_batch_r6_direct.py`；`r6_direct_7px.py` 是**八月朝向版**，非 v3 重算路径） | — |
| 试点 / 评审代码（非生产） | A100 `/home/nbustu/03health_7px_20261013/`（10-13 试点与评审渲染）、`/home/nbustu/2610render/`（渲染导出）、`paper-experiments/`（训练实验） | 不要当生产实现取回 |
| 对账夹具再生成 | `lingsight-inference/scripts/build_heading_fixtures.py`（wm_ro 只读抽样） | `lingsight-inference/tests/fixtures/heading_v3/` |

维护规则：发现某阶段权威实现搬家时改本表一行；不给试点目录留模糊空间。冻结规格与十项参数表在 `水迷宫朝向/archive/v9处理流程.md`（本机，不入库）。
