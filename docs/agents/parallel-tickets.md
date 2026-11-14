# 并行工单：受保护的 worktree 配方

用于 frontier 上阻塞已解除、改动面基本不相交的工单。每票独立 worktree／分支，主会话负责集成；有共享文件或强顺序依赖时先拆清边界，再决定是否并行。

## 1. 固定路径和基线

创建前记录主树 HEAD、分支和未提交状态；任务只在新建 worktree 中修改，主树 WIP 留在原处。使用明确绝对路径，示例中的路径和分支须替换：

```bash
repo=/absolute/path/to/lingsight-ai
wt=/absolute/path/to/lingsight-ai-tN
branch=ticket/N-slug
git -C "$repo" fetch origin main
git -C "$repo" worktree add "$wt" -b "$branch" origin/main
guard="$repo/scripts/wt-exec.sh"
```

UI 的 worktree 绑定和 shell 的工作目录是不同状态。之后对任务分支执行命令，走 `scripts/wt-exec.sh`：

```bash
bash "$guard" "$wt" "$branch" -- git status --short
bash "$guard" "$wt" "$branch" -- git merge --no-ff another-reviewed-branch
```

入口核验绝对顶层目录、实际分支和 Git 的仓库局部环境变量，拒绝 main/master、detached HEAD、子目录或分支不符。命令参数作为 argv 原样传递，不经 eval。目标任务的 WIP 可以保留，不会自动 stash、reset、clean 或切换分支。

这是执行入口保护，**不是命令沙箱**：裸 Git、后续命令自行切目录或显式操作其他仓库不在其隔离保证内。main 的快进或其他受保护操作须走单独明确授权的流程，不能拿任务入口绕过。

## 2. 使用已有隔离测试入口

测试配置由既有入口合成；worktree 默认不带私有配置，也不需要真实科研凭据。按 [本机全栈与隔离测试](local-e2e.md) 选择测试、安装依赖和处理受控环境；不要在这里复制一份会过期的数据库／端口／清理流程。

```bash
# 后端一次性数据库；脚本 backend/scripts/test-local.sh 自行定位 backend。
bash "$guard" "$wt" "$branch" -- bash backend/scripts/test-local.sh
# 全栈一次性 Compose 项目；可追加特定 spec 或分片。
bash "$guard" "$wt" "$branch" -- bash scripts/e2e-local.sh
```

需要真实科研服务的验收单独确认范围和授权，不属于默认并行测试。服务不随临时 worktree 自动部署。

## 3. 派发自包含任务

任务书写明票号、固定基线、预期绝对 worktree／分支、可写文件、共享文件禁改清单、公开测试接口、检查命令与交付证据。子会话只处理分配范围，不继续委派；是否允许 commit、push 和 tracker 操作按父任务明确授权。新增提交沿用项目的提交标识要求。

收集实现的提交与 red／green 输出；父会话通过等待屏障收敛必要子任务，不把“已启动”当完成。过期快照按其记录时点理解，完成状态与当轮证据分开保存。

## 4. 集成、预检和评审

1. 为集成分支建立单独 worktree，记录实际基线 SHA。
2. 对各分支用 `git diff --name-only <base>...<branch>` 列出交集，再用 `git merge-tree --write-tree --name-only <A> <B>` 预演。代码冲突必须比对实际行为；文档冲突依据当前有效规则、用户决定和事实证据协调，不能按文件新旧取舍。
3. 在受保护入口中顺序整合，按改动面运行相关测试。配置或依赖会改变其他分支的运行结果，联合后再测相关入口。
4. 任务分支已提交且干净后，执行同范围预检：

   ```bash
   bash "$guard" "$wt" "$branch" -- bash scripts/pr-preflight.sh origin/main
   ```

   预检不会替你提交、推送或自动清理。若 formatter 修改了任务文件，检查差异、正常提交后再跑；不能把“有警告但退出 0”的单独工具结果当作整套 hook 通过。
5. 对固定基线到最终提交运行独立 Standards／Spec 评审；修复后按改动补验，记录精确 HEAD、命令与结果。PR 按项目已有工单流程收尾。

## 5. 收尾与保留

推送后等待**实际最新 head** 的 CI，再合并或关闭工单。检查聚合绿灯是否允许跳过，不能只看 job 名称；合并后按任务要求验证主线。历史上大批次推送曾暴露组合工作流缺陷，因此本地成功不替代远端结果。

核验主树原有 HEAD／未提交内容只发生了明确授权的变化。临时容器、网络和卷由各隔离脚本只清理自己的 project；保留工作分支、worktree 和恢复材料以便追溯，其他资源清理单独确认。私有运行配置按既有安全流程维护，不作为分支集成产物。
