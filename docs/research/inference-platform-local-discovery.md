# 视频推理接入：既有实现核查与设计访谈

核查日期：2026-11-10。仅检查本机源码、Git 版本、权重路径存在性和本机 GPU 信息；未启动推理、运行测试、查询科研数据或访问远端服务。下文历史部署证据不代表当前在线状态。未复制权重、视频或秘密配置。

## 应参考的代码副本

- `/home/shuncheng/桌面/animal-platform`：HEAD `8b0c9e9`，提交日期 2026-09-03；缺少后续预标注模块。
- `/home/shuncheng/workspace/animal-platform`：HEAD `465a10f`，提交日期 2026-09-24；包含首帧定位、池与标志物识别、追踪及恢复代码。下文来源均相对此目录；工作区文件和历史运行记录不能仅以 HEAD 日期概括。
- LingSight 的 `frontend/src/features/agent/Workspace.tsx:555` 是推理待接入页；`backend/app/api/routes/agent.py` 仅代理科研任务及交付物，没有视频推理调用。

## 三段模型能力

| 能力 | 依据 | 输入与输出 |
|---|---|---|
| 首帧小鼠定位 | `backend/app/preannotation/first_frame.py:412`；`configs/models/model_manifest.yaml:53` | 全帧分割扫描，默认最大连通域至少 120 px、连续三帧确认；产出起始帧与质心候选。模型名 `first_frame_unet_resnet34_exp5_20260919`，权重 `best.pt`。该候选不自动成为科研事件定义。 |
| 水池与标志物 | `backend/app/preannotation/pool_marks.py:181`；manifest `:69` | 短窗口概率聚合；产出水池轮廓及拟合圆、四个标志物形状/位置/置信度及几何证据。清单模型为 `pool_marks_unet_resnet34_a2_20260919`，SMP U-Net ResNet34 八类分割。 |
| 逐帧小鼠追踪 | `backend/app/paradigms/water_maze/runner.py:1032`；manifest `:8` | 视频、种子及可选区域输入；区域自适应 U-Net 追踪，产出轨迹、mask、头尾及朝向候选、指标和叠加视频。模型名 `water_maze_unet_labelme_crop_balanced1000`。 |

`backend/preannotation_worker.py:660`、`:679` 依次执行首帧扫描和水池/标志物识别；`:708` 汇总质量，无有效种子或几何质量不足进入 `needs_review`，其余可进入 `auto_ok`。两种状态均不替代人工确认。隐藏平台不属于这些模型的可见场景输出，仍需独立元数据或标定。

## 旧服务契约可作为抽取参考

- `backend/app/preannotation/router.py:119`：`POST /api/preannotations/{video_id}/trigger`；`:201` 查询最新候选；`:222` 的 `promote` 接口确认候选并允许种子/区域修正，事务内幂等。
- `backend/app/api/routes.py:110`：`POST /api/jobs` 接收范式、模型、输入和参数；`:390` 查询任务；`:444` 产物列表；`:464` 下载；`:479` 媒体流；`:550` HLS。
- 预标注与追踪分别有持久化任务/租约/恢复实现。抽取时需要确定统一对外语义，不能直接将两套状态当成一个任务。
- `backend/app/jobs/runtime.py:235` 有内部 `cancel_job`；此次未在通用 jobs 路由找到公开取消接口，不声称现成 API 已支持取消。
- 主推理与 overlay 有独立完成状态；可观看结果的交付不能只看主任务成功。
- 原有测试覆盖预标注质量门禁、截止时间、崩溃收敛与 promote 幂等；真实模型 smoke 在缺权重时可跳过。本次未执行，不能宣称通过。

## 权重和运行事实的限制

`docs/runtime/production-state.md:29` 记录 2026-09-30 将 mark 切换为 `pool-marks-six-scenes-20260930-bc262f52`，SHA256 为 `bc262f52f3fb7f9ba2f4f36cbf903de4fb59bf5ecd5f3e108a4ccf3b32a36c5a`，通过运行配置覆盖清单默认路径；`:37` 记录当时一次预标注 `auto_ok` 与工作台显示。该微调没有独立验证集，历史成功不能视为泛化精度或今天的运行验证。

本机检查清单中三项 `expected_local_path`、两个预标注 NAS 源路径以及历史服务器六场景权重路径均不存在。这只能说明这些本机路径不可用，不能断言远端权重缺失。当前开发机 GPU 查询为 GTX 1050 Ti / 4096 MiB。用户指定的 `62222` 机器是 SSH 别名 `L3`，与旧平台历史部署机器不同；2026-11-10 只读 SSH 核查为四张 24 GiB RTX 3090，查询时显存占用约 15–48 MiB。L3 上 `/mnt/ugnas_DATAS/003_HealthAD/Videos` 可读且为只读 NFS，`/mnt/ugnas_Public/animal-platform/model/` 下存在清单中的首帧和池/标志物两份权重；旧服务器记录中的模型、视频与服务目录在 L3 上不存在。当前账号访问 Docker socket 被拒，是否有其他容器或执行方式仍需核实。该快照不代表部署或推理已验证。

## 已确认与待决策

1. 已确认：首轮为单个视频推理与核对，统计和报告后接。
2. 已确认：抽取模型与推理代码建立新服务，不走旧完整后端 API 接入方案，见 ADR-0013。
3. 已确认：保留预标注人工确认，再追踪，再核对结果；三者不可混为一个完成状态。
4. 已确认：独立 `lingsight-inference` 仓库拥有推理任务、模型版本和产物；部署位置为 `62222` 机器，首轮选已有视频。结果独立版本保存，核对绑定版本，暂不写现有科研库。
5. 已确认：单 GPU 串行队列、关闭网页继续、支持取消与阶段恢复；允许补齐候选，缺隐藏平台标定时仍可追踪，但不能生成依赖该标定的事件或指标。
6. 已确认：LingSight 在指定实验目录内提供浏览和视频选择；以一条真实视频的人工作业闭环验收，跨场景精度另行评估。
7. 旧代码差异：`backend/app/trials/service.py:255` 的最终人工核对门禁要求隐藏平台，和本轮缺平台也可进行追踪、核对的目标不一致，必须适配，不能直接复用原门禁。`animal-platform` 源工作区的 `pool_marks.py`、`promote.py`、`router.py` 存在未提交修改，抽取前需要核对工作区与提交版本。
8. 已确认：GitHub 账号下建立私有 `lingsight-inference` 仓库，运行数据与凭据不入库；首轮沿用现有个人工作区授权，由平台后端以服务凭据访问推理服务。
9. 待核实：L3 的逐帧追踪权重、模型版本及可用执行环境；待确定服务接口与失败边界。
10. 用户指定使用 v9。`/home/shuncheng/桌面/水迷宫朝向/archive/v9处理流程.md` 记载 v9 是在既有 mask 质心居中的 256×256 裁剪上预测头尾关键点，权重为第 41 轮最佳 KP 权重；其本身不产生 mask、完整轨迹或 overlay。与其配套的科研朝向为冻结 7px/4px 滚动球及接触弦算法，不等同头尾连线。该文档写的哈希前缀 `60fc6e3e` 与 A100 实测 `60fc6e31` 不一致，以实测完整哈希为准。
11. 已确认：需要 mask 追踪加 v9 头尾的完整链路，既有视频可以复用并注明已有 mask 和质心，新视频应先生成 mask 与质心，再运行 v9。
12. 已确认：首轮使用 L3 现有 `ac707e…` 池与标志物权重，记录完整哈希，并由研究人员确认候选。

## L3 进一步只读核查

- 首帧权重 SHA256：`42dc7074b5279418deba94fb24c5c4305dbd246e77906f13d1a6df05662dd227`。L3 上名为 `pool-marks-a2-20260919` 的权重实际 SHA256 为 `ac707e786d1da0f478e56e6803039130768fb247b7e8d20f260d7f3dec6ffb24`，与清单中的 `66dd…` 不同；它与历史部署记录中的另一份权重哈希一致，不能只凭目录名确定版本。有限目录搜索未找到历史 six-scenes 权重。
- 旧 crop U-Net `best_unet.pt` 尚未在受查位置找到。L3 有 v8 的 mask+关键点组合权重和脚本，但脚本实际只用已有中心输出头尾，不能直接作为从原视频开始的追踪方案；用户已指定使用 v9，不能将其替换为 v8。
- 实验视频根有限四层范围发现 1202 个可读 MP4，未读取内容；`/home/lsc` 可写。该账号无法访问 Docker socket。已有 Python 环境可见 CUDA 与四张 GPU，但包版本与旧平台不同，兼容性尚未验证；`ffmpeg` 不在 PATH。以上仅为发现，不构成运行验收。

## A100 的 v9 权重

2026-11-10 只读 SSH 核查 A100：第 41 轮 KP 权重 `/home/nbustu/v4finetune/v9_20261101/scratch-kp-v9/best.safetensors` 存在，SHA256 `60fc6e318343985b3aac61de12dfd9696f7116d95803f77be7a344e981f5ffbe`。合并模型 `/home/nbustu/v4finetune/v9_20261101/r6-split-003-v9-20261101/weights.safetensors` 存在，SHA256 `7f3a261175e121535496c1689b85d4b6bd1a044cce70d1bfb20c9c7c7f2ec87a`；历史 `protocol_verification.json` 记载关键点分支与合并模型一致。`merge_v9.py:8` 显示合并模型沿用 `scratch-mask-v3v6-20260924/best.safetensors`，其 SHA256 `bf4ec95ae1a90f3a490fed97773dca3047553100d28e08c89ab038062241d1fd` 与 L3 NAS 上 r6 的 mask 文件记录相同；它不是 v9 新训练的 mask。

A100 `v4finetune/run_r4_eval_v2.py` 有视频、种子、水池输入的逐帧追踪候选实现，但包含自适应面积、速度与重定位门控；缺池时会默认套用旧实验几何，接入时必须禁止这种猜测。尚无证据证明该 runner 与 v9 合并权重在 L3 端到端跑通。A100 环境与 L3 现有 Python 包版本不同，兼容性尚未验证；本次未执行模型，A100 到 L3 的权重复制尚未执行。

后续决策写回现有产品规格、术语表及必要的 ADR；本记录保留事实依据，不作为另一份产品规格。
