# LingSight AI · water_maze 真实库 Schema 审查（M1 前置）

审查日期：2026-10-12（同日完成第 2 轮口径验证）。数据源：本机 Docker 容器 `healthad-mysql`（127.0.0.1:3306）的 `water_maze` 库；DDL（仅结构）已导出至 `~/workspace/mysql_backups/schema_reviews/water_maze_schema_20261012.sql`（仓库外）。连接凭据见 `Public/003_HealthAD_Result/r6_20260927/mysql/README.md`，**凭据不入库**。

## 规模与表分类（21 表 + 1 视图）

| 类别 | 表（约行数） | 处置建议 |
|---|---|---|
| 生产核心（4） | `datasets`(1)、`videos`(549)、`frame_predictions`(~788k)、`qc_summary`(549) | 语义层白名单候选 |
| 修复管线（4） | `rescue_runs`(1)、`frame_rescue_annotations`(35.5k)、`video_rescue_annotations`(23)、`rescue_code_definitions_20261011`(21) | 白名单候选（审计/追溯用途） |
| 探测批次（6） | `probe_datasets`(1)、`probe_videos`(50)、`probe_frame_predictions`(132k)、`probe_qc_summary`(50)、`probe_arena_calibration`、`probe_platform_metadata`(1) | 白名单候选（0809t 无台子批次，独立管线） |
| 备份/暂存（7 表 + 1 视图） | `rescue_backup_*_20261011`×4、`rescue_iou_stage_20261011`、`rescue_publish_stage_20261011`、`rescue_frame_candidates_v20261011`、视图 `frame_predictions_with_rescue_20261011` | **黑名单**（查入即双计数；视图硬编码了 run_id） |

同实例还有 3 个快照/暂存库：`water_maze_data1_data4_20250929`、`wm_before_sync_20261012_191811`、`wm_sync_stage_20261012_191811`，均不在 Text-to-SQL 查询范围。

## 实验层级（2026-10-12 已验证）

**数据集（1 个）→ 训练日（5 天）→ 区块（每日 4 个，第N次=第N放鼠象限）→ 试次（每区块每鼠 4 个，c2 组 5 个）→ 帧。**

- 物理鼠 **6 只，每组恰好 1 只**（A+L1-2、A+L3-1、A2-2、A3-2、c1-1、c2-2）。此前『26 只动物』是把 `animal_code` 当动物的误读。
- 每鼠每天 16 个试次（4 区块 × 4 试次；c2 组 20 个），5 天合计 499 视频 + 0809 有台子探测 50 = 549，与 003 导出 README 对账一致（0806/第三次/A3-2-1 按要求留空）。
- 目录名「第N象限」与文件名「第N次」的 N 恒等（抽验全部吻合）：训练期放鼠象限随区块轮转；探测期直接以象限命名。
- 文件名编码：`{MMDD}{第N次}-{组}-{鼠号}-{试次尾号}.mp4`。

## 领域概念映射（spec 七概念 → 实际承载）

| spec 概念 | 实际承载 | 状态 |
|---|---|---|
| 实验 Experiment | `datasets`（当前 1 行）+ `videos.batch_id` | 可用 |
| 动物 Animal | **`(group_name, mouse_id)` 联合标识**；`animal_code` 是「组-鼠-试次尾号」三段编码，**不能当动物 ID 用** | ✅ 已验证 |
| 实验组 Group | `videos.group_name`（6 组）；本数据集组与动物一一对应 | ✅ |
| 试次 Trial | 与视频 1:1，`(date_dir, session_no, animal_code)` 唯一；`trial_no` 为 varchar | ✅ 数据侧已验证，待 protocol 层认可 |
| 训练日 Training Day | `date_dir`（0804–0808 = 第 1–5 天）；`session_no` 是**当日区块序号**（第N次=第N象限），不是天 | ✅ 已验证 |
| 帧 Frame | `frame_predictions`（主键 video_id+frame_idx） | ✅ |
| 指标 Metric | 库中不存在 → **M1 新建确定性指标表**（ADR-0003） | 决策已定 |

## 关键取值域（统计过滤必须用到）

- `videos.phase`：`training_day`（499 视频/5 天/6 鼠）| `probe_platform_present`（50 视频/1 天/6 鼠*）
- `frame_predictions.status`：`ok`(783,790) | `miss`(4,292，全部坐标为空) | `coord`(6，**有中心、无头尾、无 mask**——数据实证；生成代码在 A100 端未溯源)
- `ok` 帧中 head 缺失 2,137、tail 缺失 4,179：关键点统计需 `status='ok' AND head_x IS NOT NULL`
- `frame_predictions.head_tail_mode`：`heatmap_peak` | `viterbi_rescue` | `partial_rescue`（关键点来源/修复方式）
- `qc_summary.qc_status`：`ok`(32) | `review`(**517/549**)——当前值与 003 README 导出时的"12 个 review"不符，疑为 2026-10-11 修复管线刷新；"review"现语义待确认（见 docs/09 遗留疑点）
- `videos.session_label` **一列两义**：训练视频 =「第N次」（区块）；探测视频 =「第N象限」（放鼠象限）
- `videos.artifact_mode` = `run_r4_eval_v2`；fps=30.0、`time_s=frame_idx/30`（E1 修复后）；头尾修正帧 `head_tail_corrected=1`

## 已识别风险（Text-to-SQL 视角）

1. **`animal_code` 陷阱（最高优先）**：三段编码含试次尾号，按它过滤/分组会把一只鼠拆成 4–5 个假动物。语义层必须强制「动物 = (group_name, mouse_id)」口径。
2. **一列两义 / 多列同义**：`session_label` 双义；`session_no`（区块）易被误当「天」。聚合口径在语义层唯一化。
3. `trial_no` 为 varchar：字符串排序 `'10'<'2'`。
4. **全库无外键**：join 只靠约定列，错误 join 不报错；语义层显式声明关系。
5. 备份/暂存 7 表 + 3 个快照库：查入即双计数 → 白名单是硬约束。
6. **只有 root 账户**：M1 首个安全任务是建只读账户 + 表级授权。
7. 隐藏平台逐日坐标**已于 2026-10-12 入库**：`platform_positions` 表（源自 `~/桌面/0809t实验/E1_分析前置_20260110/task3_platform/platform_coordinates.csv`，含逐日共识坐标、成像/行为双法交叉、Probe 靶区与'all'汇总行，共 8 行，已授 `lingsight_ro`）。
8. `mask_rle_counts` 为全帧 COCO RLE 长文本：语义层不暴露。
9. `videos.notes` 含自由文本（文件名笔误修正等），不作结构化口径来源。

## 语义层白名单建议（初稿）

- 暴露：`videos`（精选列）、`datasets`、`qc_summary`、`frame_predictions`（精选列，排除 `mask_rle_*`）、`rescue_code_definitions_20261011`、**新建指标表**（ADR-0003）
- 已落地（2026-10-12）：只读账户 `lingsight_ro` 对 `datasets`/`videos`/`qc_summary`/`rescue_code_definitions_20261011`/`platform_positions` 五表授权并验证；`frame_predictions` 待 `v_query_*` 视图就绪后改授视图
- 二期再议：`probe_*` 六表、修复审计三表
- 黑名单：全部 `*_20261011` 备份/暂存表与同名视图、三个快照库

## 剩余 Open Questions

1. `status='coord'` 的生成代码溯源（A100 推理端）；当前以数据实证记录（6 帧：有中心、无头尾、无 mask）。不阻塞 M1。
2. ~~`platform_coordinates.csv` 实际位置~~ 已解决：位于 `~/桌面/0809t实验/E1_分析前置_20260110/task3_platform/`，2026-10-12 已入库为 `platform_positions`。
3. ~~「视频 = 试次」protocol 层认可~~ 已确认：数据侧验证无拆分/合并/重复，用户 2026-10-12 委托确认按 1:1 设计。
4. `qc_status` 当前 517/549 为 review 与 003 README（12 个）不符，语义待确认（docs/09 遗留疑点）。
