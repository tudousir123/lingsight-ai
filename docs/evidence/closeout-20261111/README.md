# 并行收尾与最终整合验收 · 2026-11-11

本轮由三个独立 subagent 完成项目/CI、推理结果发布、Agent 项目数据消费，主 agent 整合和独立复审。平台原有未提交首页中英切换、中文引导和相关测试已叠入最终测试；原始 patch 与未跟踪文件另有工作区备份。

## 代码交付

- #42：服务端项目实体、侧栏归组、旧 localStorage 导入；外观入口、旧测试契约、welcome 滚动恢复与独立 E2E 栈收口。
- #43：并发重放与跨项目冲突、UUID 路径、产物与冻结参数校验；数据库回读显式刷新 identity map，验证真实持久化科学载荷，覆盖跨 2000 行分段。
- #44：Agent 固化 project_id、结构化只读应用源、最新版本选择、来源快照和报告；真实 MySQL/DBHub 的列级权限及 source_id 已验证。独立仓 27 个改动文件已哈希核对并同步回原仓，保持未提交，见 agent-sync.json。
- 平台桥接：项目内分析入口、网关项目归属与创建前能力检查；旧 Agent 或未配置项目源时 503 且不发送创建 POST。异常范围响应尝试停止 Run，保留输入。ADR-0018 记录跨版本取舍。
- 原有中文引导叠加后，补齐遗漏的中文按钮断言、动画标题无障碍断言与中英切换/刷新恢复验证；中文标点获得与英文一致的停顿，打字测试冻结时钟避免加载时间进入断言预算。

## 最终验证

| 验证面 | 结果 | 证据 |
|---|---|---|
| 平台隔离 MySQL + 真实 Node HTTP 契约 | 236 passed / 6 research-live skipped，退出 0 | backend-tests-final.txt |
| 平台 mypy / ty / ruff | 全通过 | backend-lint.txt |
| 桌面项目原路径 TypeScript / Vite 构建 | 退出 0，已刷新本机前端构建产物 | frontend-build-final.txt |
| 最终组合代码的完整 Compose / Playwright | 102 passed，2.3 分钟，退出 0；无 flaky，已清理自建卷/网络/镜像 | full-stack-final.txt |
| 独立 Agent Docker 全量测试 | 27 passed / 0 skipped | Agent 仓 docs/evidence/project-data/docker-tests.txt |
| 新应用源真实协议与权限 | 临时 MySQL 8.4 + 平台 Alembic + DBHub 1.5.1 通过 | Agent 仓 docs/evidence/project-data/mysql-dbhub.json |
| 独立推理仓 | 21 passed，未运行 GPU | inference-verification.json |

平台全量测试命令（在 backend/）：

```bash
AGENT_CONTRACT_REPOSITORY=/path/to/lingsight-agent bash scripts/test-local.sh -q
uv run bash scripts/lint.sh
```

完整前端与后端镜像构建、真实登录/设置及浏览器回归（仓库根目录）：

```bash
LINGSIGHT_E2E_BUILD_NETWORK=host LINGSIGHT_E2E_HTTP_PROXY="$HTTP_PROXY" bash scripts/e2e-local.sh
```

该 runner 生成独立随机 Compose project、临时 MySQL 与合成账号，无宿主端口，不读开发 .env，退出只清理自身资源。本机镜像下载需要代理；测试服务仍在独立网络。

## 失败与修正记录

capability-before.txt 保存了修复前 6 个旧服务 fail-open 场景的实际失败。full-stack-before-wip-test-alignment.txt 是发现未翻译按钮断言后主动中止的运行；full-stack-before-locale-regressions.txt 为随后 100 passed / 2 failed（无障碍标题拼接与中文打字时序）。最终 full-stack-final.txt 覆盖全部 102 项且干净退出。locale-regressions.txt 保留修复前回归输出；这些旧记录不作为通过证据。

CI subagent 的 95 项测试曾在浏览器通过后，因运行期间修改 shell 脚本出现尾部读取残片；原始记录见 closeout-project-ci。最终 102 项使用稳定脚本重跑并退出 0，消除了这个验收缺口。远端 GitHub 工单与 PR 未更新。

## 运行与发布边界

本轮未部署或修改现役数据库/DBHub/GPU 服务，也没有调用真实模型或代替研究人员确认结果。deployment-prerequisites.json 只记录无密钥的配置存在性和只读探测事实。

正式启用仍需：恢复平台私有运行配置；按 Agent 仓的列级 GRANT/DBHub 模板配置新的应用只读源；构建并核验生产固定依赖分析镜像；确认 L3 HTTP 通路；执行正式数据库迁移与容器切换；由用户在正式主站走真实视频闭环并核验结论（#45）。

Agent 的本轮 Docker 运行验证使用独立缓存镜像，numpy/pandas 版本与生产 Dockerfile 固定版本不同；它证明任务隔离、工具执行与来源链路，不能替代生产固定依赖镜像的构建验证。详见独立仓 project-data/README.md。
