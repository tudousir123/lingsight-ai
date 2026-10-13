# M1-T8 验收证据（2026-10-13，工单 #7）

`water_maze.v_query_frame_predictions` 只读视图（root 建，幂等 CREATE OR REPLACE VIEW）：从基表 `frame_predictions` 直取语义层精选 12 列（video_id, frame_idx, time_s, center_x/y, head_x/y, tail_x/y, status, head_tail_mode, head_tail_corrected），无计算列；`mask_rle_*` 与其余排除列物理不存在于视图。`lingsight_ro` 改授视图 SELECT，基表保持从未直授（docs/09 D24 实测口径不变）。root 凭据全程只经容器 env 注入进程 env；lingsight_ro 密码只经容器 env 注入会话，未回显、未落盘、未入库。

| 文件 | 内容 |
|---|---|
| `01-apply-views.log` | root 重放 `scripts.schema.apply_v_query_views`：建视图 + GRANT + 视图列清单（12 列，与语义层白名单逐列一致）+ 行数 788,088 + SHOW GRANTS 摘录（本轮为第二次运行，证明幂等） |
| `02-ro-view-probe.log` | lingsight_ro 视角四项实测：① 视图查精选列成功（count=788088，样例行 12 列）；② 视图查 `mask_rle_counts` → ERROR 1054 Unknown column（物理不可达）；③ 直查基表 `frame_predictions` → ERROR 1142 SELECT command denied；④ SHOW GRANTS（含视图授权，无基表授权，其余六表未动） |

## 结果对照验收标准（工单 #7）

- [x] 经视图可查询帧级精选列：probe ①，`SELECT COUNT(*)` 与 `SELECT *` 均成功；行数 788,088 与 docs/09 Q10 黄金分解一致（783,790 ok + 4,292 miss + 6 coord）。服务层同口径回归：`backend/tests/text_to_sql/test_query_pipeline.py::test_frame_query_runs_through_the_view`（真实 lingsight_ro 执行）。
- [x] `mask_rle_counts` 在视图层不可达：probe ②，ERROR 1054 Unknown column——列在视图 DDL 中不存在，账户层无从泄露；AST 白名单先于执行拒绝（`test_d24_mask_rle_counts_rejected_before_execution`），schema 与校验双层防御。
- [x] 基表直查被账户层拒绝：probe ③，ERROR 1142 SELECT command denied；probe ④ 确认 `frame_predictions` 从未出现在授权清单。
- [x] 语义层白名单与 AST 校验指向视图：`semantic_layer.yaml` frame 条目切换为 `v_query_frame_predictions`（exposed: true、view_of: frame_predictions、列=精选 12 列、关系端点指向视图），加载器新增双入口拒绝校验；`backend/tests/text_to_sql/test_semantic.py` 13 项、`test_views.py` 6 项锁定。

## 复现命令（凭据经容器 env，单条命令内传递）

```bash
cd backend
export METRICS_DB_PW=$(docker exec healthad-mysql printenv MYSQL_ROOT_PASSWORD)
uv run python -m scripts.schema.apply_v_query_views   # 建视图 + GRANT + 校验投影与白名单一致（幂等）
```

lingsight_ro 探针：容器内 `mysql -ulingsight_ro`，密码从根 `.env` 读入 shell env 后 `docker exec -e RO_PW=...` 注入（见 `02-ro-view-probe.log` 头注）。

## 03-mask-open-probe.log（2026-10-13，ADR-0007 / 工单 #15）

用户决策开放 mask 族列后的复测：视图 24 列投影；RLE 经 lingsight_ro 小范围可读（316–391 字符样本，coco_counts_column_major，2560×1440，含面积）；`prev_mask_iou` 物理不可达（1054）；基表直查仍拒（1142）。原 02 探测记录中「mask_rle_counts Unknown column」为 #7 时点的历史事实，已被本决策反转。
