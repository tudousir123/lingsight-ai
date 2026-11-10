# 水迷宫文献前端素材

10 份素材来自 3 篇本地论文：8 张完整图，以及从同一热图另裁出的 2 个阶段面板。09 为轨迹后处理的方法效果图。打开 `index.html` 可预览并下载，`contact-sheet.jpg` 是总览。

## 前端引用

```tsx
<figure>
  <img
    src="/assets/literature/water-maze/02-acquisition-heatmaps.webp"
    alt="文献示例：学习阶段空间占据热图，Cooke et al. (2020), Figure 5"
    style={{ width: '100%', height: 'auto', objectFit: 'contain' }}
  />
  <figcaption>
    文献示例 · <a href="https://doi.org/10.12688/f1000research.20352.2">Cooke et al. (2020), Fig. 5</a>
    {' · '}<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> · 原图裁剪
  </figcaption>
</figure>
```

推荐用 WebP 加载，PNG 用于设计工具。每对 PNG/WebP 像素一致；原始 PDF 按 216 dpi 渲染，不增加源图实际细节。保持比例，避免用 `object-fit: cover` 裁掉色标或坐标。两张横向热图适合展示卡；完整图适合报告预览或详情。

## 来源与可追溯性

`manifest.json` 记录作者、题目、DOI、PDF 页码、图号、裁剪矩形、尺寸、许可所在页和原 PDF 的 SHA-256。PDF 页码从 1 开始；裁剪坐标单位为 PDF point，原点左上角。Pathfinder 使用 2020 年修订的 version 2，虽本地文件名写 2019；Sánchez PDF 有额外封面。

三篇原 PDF 均标注 CC BY 4.0。展示时保留来源署名、论文和许可链接及“原图裁剪”说明。素材中的实验分组、数值和显著性属于对应论文，不能作为 LingSight 自有实验结果或性能证据。原文图注及实验细节见链接论文。没有修改原图数据、颜色、图例、坐标或显著性标记。

首页 `/welcome` 已使用 02（热图）、06（学习曲线）、07（象限统计）、08（搜索策略）四份 WebP，页面不展示署名与来源链接，完整来源保留在本目录。选中素材另放于 `frontend/src/features/marketing/assets/literature/`，经 Vite import 打包；项目关闭了 public 目录自动复制，因此业务页面不直接引用本目录。提取脚本保存在仓库本地忽略目录 `local-data/literature-figures/extract.py`；在有本地原论文、PyMuPDF 和 Pillow 的环境运行 `python3 local-data/literature-figures/extract.py` 可重新导出。
