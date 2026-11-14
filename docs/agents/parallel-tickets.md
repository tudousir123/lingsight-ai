# 并行工单：git worktree 配方

当 frontier 上有多张互不阻塞的工单且改动面基本不相交时，用独立 worktree + 独立 agent 会话并行实现，主会话负责合并收口。2026-10-13 用此配方并行交付了 #4 与 #5。

## 步骤

1. **建 worktree**（每票一个，从 main HEAD 切分支）：
   `git worktree add ../lingsight-ai-tN -b ticket/N-slug`
2. **补齐 worktree 缺的未跟踪文件**（git 不带过去）：
   - `cp .env ../lingsight-ai-tN/.env`，并把其中 `DATABASE_URL` 的库名改成隔离库（如 `app_tN`）；需要真库/LLM 的票，把 `LINGSIGHT_RO_PASSWORD`、`LLM_*` 行也带上。
   - `mkdir -p ../lingsight-ai-tN/backend/app/frontend && printf '<!doctype html><title>stub</title>\n' > …/index.html`（模板测试导入 app.main 需要该目录，已 gitignore）。
3. **建隔离测试库**（两票的模板测试都跑 conftest 的 autouse db fixture，共库会互删数据）：
   `docker exec lingsight-ai-db-1 sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS app_tN; GRANT ALL ON app_tN.* TO \"app\"@\"%\";"'`
4. **派 agent**：任务书自包含（票号 + worktree 路径 + 只读主树参考文档的绝对路径 + 测试/静态检查命令 + 禁改清单：progress.md、semantic 层（除非票就是它）、依赖（除非票需要）、不 push 不动 tracker）。
5. **合并收口**（主会话）：先 `git diff --name-only` 查两票文件交集；顺序 merge；合并后全量 pytest + ruff + mypy；把 worktree `.env` 里的新凭据变量并回主 `.env` 再删 worktree/分支/临时库。
6. **推送后看 CI 再收口**：本地合并不开 PR 的分支在推送 main 前没有任何 CI——批次推送后、写验收/closeout 之前，先确认 GitHub Actions 全绿（2026-10-13 的 33 提交大推送一次踩爆两个潜伏工作流 bug，均到推送后才暴露）。

## 分叉合并预演（两条线都已存在时）

不是从 main 切的并行票，而是两条线各自前进了（2026-11-10 实例：`codex/infer` 与 `codex/backend-convergence-review` 分叉 10 小时、都携带网关副本）。合并前先列冲突清单：

`git merge-tree --write-tree --name-only <A> <B>`

- 清单全是文档/配置 → 直接合，逐块按「叙述取更新的、事实取更具体的」解（实测 9 个冲突全中、代码层零意外）。
- 出现代码文件 → 先 `git diff A B -- <file>` 比两版再定（实例：agent.py 两线内容一致，只是都改过周围文件）。
- 离开一条未合并的工作线时：当天并回，或开 issue 记「分支名 / 基线 / 未完事项」——无名分叉是下一次考古的账单（squash 历史的仓库里 `git log` 帮不上忙，progress.md 是唯一史源）。

## 什么时候不用

- 两票都要改同一批文件（如都动 semantic_layer.yaml）。
- 票本身很小（顺序做完比写任务书便宜）。
- 需要 user 在环的票（人机协作类）。
