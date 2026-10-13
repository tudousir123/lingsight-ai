---
status: accepted
---

# mask 族列开放至帧级查询面（用户决策反转排除锁定）

2026-10-13 用户决策：「需要开放 mask，有用」。mask 家族 12 列——RLE 编码（`mask_rle_counts`）、解码参数（`mask_width` / `mask_height` / `rle_format`）、派生列（`mask_valid` / `mask_centroid_x/y` / `mask_area_px` / `mask_bbox_x1..y2`）——加入 `v_query_frame_predictions` 视图与语义层白名单，可经 `lingsight_ro` 查询。工单 #15。

## 被反转的决策

- docs/08 风险 8 与工单 #3 验收 4（mask_rle_* 白名单不可达）、#7 验收 2（视图物理不可达）——原排除是**策展取舍**（长文本无 LLM 统计价值），非安全边界；用户判断 mask 数据有用（轮廓重建、身体面积等），予以开放。
- docs/09 D24「读 mask_rle_counts 期望拒绝」随反转：经视图小范围读取现为**允许**；#9 评测套件按新事实编码期望。

## 保持不变的边界

- 管线内部质量列（`prev_mask_iou` / `instant_static_by_iou`）维持排除（聚合已在 qc_summary）。
- 防线不放松：只读账户、单条 SELECT、强制 LIMIT 与行数上限（200 行 × 平均 339 字符 ≈ 68KB，带宽受控）、超时、AST 白名单（列集扩大≠校验放松）。
- RLE 在语义层带长文本 caution：按帧号/视频小范围取用；重建轮廓需配合 mask_width/height 与 rle_format。

## Consequences

- 白名单/提示词上下文新增 12 列；`views.py` DDL 与语义层 YAML 同步（一致性测试已有）。
- 计算 vs 查询通道分工不变（ADR-0003）：批量 mask 重建类计算仍走内部计算通道直读基表，不占用查询面行数预算。
