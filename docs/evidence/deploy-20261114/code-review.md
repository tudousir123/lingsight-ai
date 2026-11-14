# 双轴自审（#56，初审记录）

固定点：`860ebb4bc0b584d6ad43c3a5a19765ca71adc634`；在 `/tmp/lingsight-503-review` 执行 `git diff 860ebb4bc0b584d6ad43c3a5a19765ca71adc634...HEAD`，确认非空。

评审代码提交：`1e9dcf8 fix: gate formal deployment on research database readiness (#56)`；证据修正提交：`fa3b509 docs: record reproducible preflight validation evidence (#56)`。两个评审使用独立、全新上下文；工单依据为创建 #56 时保存的正文 `/home/x/mattdev-503/issue.md`，初审时 GitHub 网络受限，未声称当时重新抓取过工单。

## Standards

Standards 轴：0 项未关闭问题。

`fa3b509` 已在 `preflight-tdd.md` 补齐 mypy、ty 的执行目录、完整命令和输出，原证据缺口已关闭。未发现其他规范违反或值得提出的 baseline smell。完整隔离库成功路径及 CI 尚未执行，文档已如实披露。

## Spec

Spec 轴：未发现可确认的代码缺陷或范围扩张；仍有 2 项交付缺口。

1. **成功路径尚未验证（环境限制）**。规格要求：“通过 TDD 为正式部署 preflight 增加配置缺失、连接失败的明确非零退出及脱敏错误”。代码和测试已覆盖缺失、空白、非法端口、连接失败及 Compose 错误脱敏；真实隔离库成功测试已编写，但 Docker daemon 被沙箱禁止，尚未执行。不能用上轮正式站 API/UI 验收替代新命令的成功路径验证。
2. **PR 与 CI 尚未交付（环境限制）**。规格要求：“独立 worktree 实施、双轴自审、CI 通过；PR 关联本 issue，不自动合并”。本轮双轴审查已完成；GitHub 网络被沙箱禁止，因此 PR 与本次 CI 尚未完成。现有证据如实标注未完成，应继续保留该状态。

其余要求与 diff 相符：正式 Compose 显式透传五项配置，环境示例使用 13306，runbook 给出 preflight 和仅重建 backend 的命令；探针执行认证后的只读 `SELECT 1`，未引入业务数据写入。只读账号授权、原镜像重建与 API/Playwright 验收属于上轮运行证据，本次仅检查记录的一致性，未独立重验。

总计：Standards 初审 1 项证据问题，复核后剩余 0 项；Spec 代码问题 0 项、交付缺口 2 项，最严重的是 PR/CI 尚未交付。

## 后续补验

权限恢复后，已通过 `gh issue view 56 --repo tudousir123/lingsight-ai --json number,title,body` 重新核对工单；同一代码已同步回用户指定的 `/home/x/mattdev-503/wt`。`bash scripts/test-local.sh` 结果为 264 passed、7 skipped，17 项新增测试全通过，真实隔离库成功路径的交付缺口已关闭；完整命令与输出见 [preflight-tdd.md](preflight-tdd.md)。PR/CI 的最终状态以 GitHub 同一 head SHA 的 checks 和本机最终报告为准；本节不将提交前检查冒充远端 CI。
