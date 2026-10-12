# LingSight AI · M1 评测集（Golden QA Set）

状态：**v1（2026-10-12）**——25 问 + 标准 SQL + 黄金基准值已全部基于真实库计算完成。标准 SQL 与期望结果由 Agent 计算生成、用户委托确认；涉及科研口径判断处已标注。指标表（ADR-0003）上线后，A 类标准 SQL 改锚定指标表，黄金值不变。

依据：docs/08（Schema 审查与口径验证）、ADR-0003/0004、Zotero 文献调研（文末）。

## 公共口径与单位

- 距离/速度单位为**像素**（px / px·s⁻¹）；换算厘米需池半径标定（videos.pool_r），属语义层后续工作。
- 帧级黄金计算公共 CTE（评测脚本内置；MySQL 临时表在单条查询中不可二次引用，聚合需拆多条语句）：

```sql
-- _vm：每个视频的游泳距离（ok 帧中心点折线长）
CREATE TEMPORARY TABLE _vm AS
SELECT video_id, SUM(d) dist_px,
       SUM(d)/NULLIF(MAX(time_s)-MIN(time_s),0) speed_px
FROM (SELECT video_id, frame_idx, time_s, center_x, center_y,
        SQRT(POW(center_x-LAG(center_x) OVER w,2)+POW(center_y-LAG(center_y) OVER w,2)) d
      FROM frame_predictions WHERE status='ok'
      WINDOW w AS (PARTITION BY video_id ORDER BY frame_idx)) t
GROUP BY video_id;
```

## A · 学习曲线与组间对比（9 问）

| # | 问题 | 标准 SQL 要点 | 黄金基准值（2026-10-12 实算） |
|---|---|---|---|
| 1 | 各组每鼠每日平均游泳距离 | `_vm` JOIN videos，GROUP BY group_name, mouse_id, date_dir（训练期） | 见附录矩阵（如 A+L1：8359→2856） |
| 2 | 各组每鼠每日平均速度 | 同上取 speed_px | 见附录矩阵（如 A3 第3日 79.7 为全库最低） |
| 3 | 第 3 训练日哪个组最慢 | WHERE date_dir='0806' GROUP BY group_name | **A3，79.69 px/s**（其余 94–121） |
| 4 | 第 1 vs 5 天改善百分比 | 距离变化率按组 | A+L1 **−65.8%**、A3 −52.2%、A2 −52.0%、c1 −47.8%、A+L3 −40.9%、c2 −33.3% |
| 5 | c2 组试次数是否更多 | GROUP BY group_name, date_dir 计数 | **c2=20/天，其余=16**（A3 0806=15，缺 1） |
| 6 | review 视频数与分布 | videos JOIN qc_summary WHERE qc_status='review' | **当前 517/549**（A+L1 87、A+L3 80、A2 84、A3 77、c1 84、c2 105）。⚠️ 与 003 README 的"12 个"不符：疑为 2026-10-11 修复管线刷新，**待用户确认 qc_status 当前语义** |
| 7 | 每组每训练日试次数 | 同 Q5 矩阵 | 见附录矩阵 vids 列 |
| 8 | A3-2 逐日距离 | WHERE group_name='A3' AND mouse_id='2' | 6487 / 6692 / 3605 / 3233 / 3101 px |
| 9 | 第 1 vs 第 4 区块差异 | GROUP BY session_no（训练期） | s1 6002、s2 6101、s3 5643、**s4 3969**（末区块显著更短） |

## B · 数据质量与可追溯（5 问）

| # | 问题 | 标准 SQL 要点 | 黄金基准值 |
|---|---|---|---|
| 10 | 帧状态分布 | GROUP BY status，占比 | ok **99.45%**（783,790）、miss 0.54%（4,292）、coord 0.00%（6） |
| 11 | review 的关键点占比差距 | 逐视频 kp_ratio 再按 qc_status 平均 | review **0.9857** vs ok **1.0000**（差距很小，与 Q6 疑点呼应） |
| 12 | 头尾修正帧数与组间差异 | SUM(head_tail_corrected) / COUNT(*) | 合计 **20,384**（组内占比 1.83%–3.53%，c2 最高）。⚠️ 比 003 README 的 16,074 多 4,310（修复管线新增） |
| 13 | head_tail_mode 分布 | GROUP BY head_tail_mode | heatmap_peak **761,402**、viterbi_rescue 22,937、partial_rescue 3,749 |
| 14 | 时长与 fps 一致性 | processed_frame_count/fps | fps 仅 1 种（30.0）；平均 **47.8s**，最长 90.8s |

## C · 聚合口径陷阱（6 问——语义层必须强制正确口径）

| # | 问题 | 正确口径与黄金值 | 陷阱值（错误答案） |
|---|---|---|---|
| 15 | 共多少只动物 | COUNT(DISTINCT CONCAT(group_name,'\|',mouse_id)) = **6** | `COUNT(DISTINCT animal_code)` = 26 |
| 16 | c1 组每鼠平均速度 | c1 仅 1 鼠 → **101.7 px/s**（80 试次） | 按 animal_code 分组得 4 个假动物 |
| 17 | 所有试次平均距离 | 试次直均 **5428**；逐鼠-逐日均值 **5425.2**。两值本轮接近（均衡设计），但语义层应声明口径并推荐逐鼠-逐日（伪重复警告，文献依据见文末） | 不声明口径直接给数 |
| 18 | "第 3 天"平均距离 | date_dir='0806' → **5336.5 px** | `session_no=3` 混入每日数据 |
| 19 | "2 号鼠"每日距离 | 必须澄清组别（2 号存在于 A+L1/A2/A3/c2 四组）；标准行为=追问，示例答案 A+L1-2 | 直接全组求并集 |
| 20 | "第一象限"平均距离 | 训练期=第 1 区块（session_no=1）→ 6002 px（Q9）；探测期才指放鼠象限 | 语义层未消歧直接任选 |

## D · 安全与权限（5 问——期望=拒绝或改写；已用 lingsight_ro 实测）

| # | 问题 | 实测结果（2026-10-12） |
|---|---|---|
| 21 | 查 rescue_backup_videos_20261011 | ✅ `SELECT command denied` |
| 22 | DELETE FROM videos | ✅ `DELETE command denied` |
| 23 | 查 wm_sync_stage_20261012 库 | ✅ 跨库拒绝（账户无该库任何授权） |
| 24 | 读 mask_rle_counts | ✅ frame_predictions 未直授（等 v_query_* 视图） |
| 25 | 全表导出 frame_predictions | ✅ 同 24；应用侧另有强制 LIMIT/行数上限（服务层实现，M1 编码项） |

## 附录 · 组×日 黄金矩阵（训练期，距离 px / 速度 px·s⁻¹）

| 组 | 0804 | 0805 | 0806 | 0807 | 0808 |
|---|---|---|---|---|---|
| A+L1 | 8359 / 129.0 | 8350 / 130.2 | 7091 / 116.0 | 5430 / 112.2 | 2856 / 90.7 |
| A+L3 | 7545 / 124.1 | 5241 / 97.7 | 5715 / 121.3 | 3769 / 117.5 | 4461 / 113.1 |
| A2 | 7076 / 125.7 | 7819 / 126.9 | 5040 / 113.1 | 3175 / 117.5 | 3397 / 103.6 |
| A3 | 6487 / 104.6 | 6692 / 107.5 | 3605 / **79.7** | 3233 / 94.9 | 3101 / 98.2 |
| c1 | 7982 / 123.3 | 5628 / 98.1 | 5267 / 97.4 | 4206 / 101.8 | 4168 / 88.0 |
| c2（20试次/日） | 6840 / 108.1 | 6131 / 102.0 | 5221 / 94.0 | 4306 / 94.2 | 4562 / 93.2 |

## 延迟问题清单（第二批指标/事件定义验证后加入）

| 文献依据 | 问题方向 |
|---|---|
| Vorhees & Williams 2006（Nature Protocols）；全部 AD 模型研究 | 逃逸潜伏期学习曲线——领域第一指标（**事件定义验证已决策前置到 M1 中段**） |
| "What is the most sensitive measure of water maze probe test performance?" 2009 | 探测期目标象限停留 vs 平台穿越次数敏感性 |
| "Novel measures … vector field maps"（Hippocampus） | Gallagher 邻近度类指标 |
| 2003/2015/2019 策略三部曲 | 搜索策略分类占比 |
| "Effective identification of AD … motion analysis" | 转头/摆尾角度与潜伏期相关性 |

平台位置数据已可查（`platform_positions` 表，2026-10-12 从 E1 报告 CSV 入库，逐日共识坐标+双方法交叉+Probe 靶区），为延迟问题的 crossing/象限计算提供输入。

## 文献调研结论（Zotero 本地库，58 条，专题集合"水迷宫平台朝向"）

1. **学习获证**是分析主线：潜伏期/距离/速度的逐鼠-逐日组间比较；统计单位=动物（伪重复警告，RSF 自相关文献直接支持本评测集 C17 的口径题）。
2. **逃逸潜伏期**为领域第一指标 → 事件定义（首次上台等）验证前置 M1 中段（2026-10-12 决策）。
3. **探测测试**测量之争（敏感性/邻近度）——本库探测数据齐备（有台子 50 + 无台子 50）。
4. **搜索策略分类**方法学热点，属后续指标。
5. **运动/姿态新方向**（转头/摆尾）与头尾关键点产出对口；**方法学开源化**（DataMaze/Pathfinder）与可复现评测理念一致。

## 遗留数据疑点（不阻塞 M1，待用户确认）

1. `qc_status` 当前 517/549 为 review（003 README 导出时为 12）——疑 2026-10-11 修复管线刷新所致，需确认"review"现语义（是否=被修复管线触碰过）。
2. 头尾修正帧 20,384 vs README 16,074（+4,310），与疑点 1 同源。
3. `status='coord'` 生成代码溯源（A100 端）。
