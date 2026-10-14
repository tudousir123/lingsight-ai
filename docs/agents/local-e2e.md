# 本机全栈 Playwright（trial-flow 等 compose spec）

CI 里这些测试跑在每 shard `docker compose down -v` 的全新栈上；本机复跑的差异都在这份文件里。三个坑都实际咬过（2026-10-13/14 #18 会话）。

## 1. 夹具 env 必须走 `.env`，不能 shell 前缀

CI 栈没有研究库，backend 靠 `TRIALS_FIXTURE_DIR` 切换到合成夹具（`backend/app/trials/fixtures/`）。compose.override.yml 把它声明为 `${TRIALS_FIXTURE_DIR:-}`，而 **`docker compose run`（playwright 的 depends_on 链）会用当前 shell 重新展开 backend 的这个插值**：只在命令前缀注入的值会在下一次 `compose run` 时被静默抹成空，backend 落回研究库模式（本地容器连不上 → 全部 503）。

更阴的是 `docker compose exec` / `docker inspect` 这时仍显示"有值"（它们各自重新求值 compose 文件）。排查要看进程真实环境：

```bash
docker exec lingsight-ai-backend-1 sh -c 'tr "\0" "\n" < /proc/1/environ | grep TRIALS'
```

正确做法：把 `TRIALS_FIXTURE_DIR=/app/backend/app/trials/fixtures` 写进根 `.env`（本机做真实数据联调时注释掉）。trial-flow.spec 的第一个测试就是这道 fail-fast：夹具实验不在目录里会直接点名这个原因。

## 2. 本机重跑前清 `trial_review`

trial-flow 的确认/草稿用例假设干净库（CI 每 shard 重建）。上一次本机跑留下的 confirmed 记录会让下一次跑的主流程假失败（页面直接进入已确认态）。`scripts/e2e-local.sh` 已把清理串进流程；手动等价：

```bash
docker exec lingsight-ai-db-1 sh -c 'mysql -uapp -p"$MYSQL_PASSWORD" app -e "delete from trial_review;"'
```

## 5. 改了 spec/前端代码之后必须 rebuild playwright 镜像

**镜像拓扑**：被测应用（后端代码 + 构建好的前端 SPA）烤在 **backend 镜像**里；测试 spec 烤在 **playwright 镜像**里（都只挂载报告目录）。改了 spec 或页面代码不 rebuild 就跑，跑的是旧代码（症状：改动"不生效"、断言莫名对不上）。`scripts/e2e-local.sh` 已把两个镜像的 build 都串进流程（backend 那步是 2026-10-14 retro 补的——当天 SSE 端点和 /qa 页接连 404，都是旧 backend 镜像）；手动等价：

```bash
docker compose build backend playwright
```

## 4. 跑过后端 pytest 之后，app 库用户被清空（超管自动重建，手工账号会丢）

`backend/tests/conftest.py` 的 autouse session fixture 在 teardown 执行
`delete(Item)` + `delete(User)`（模板设计，CI 每 shard 全新库无害），而本地测试
engine 指向的就是 compose 栈的 `app` 库——**任何一次 `uv run pytest`（哪怕单
文件）都会清空 dev 栈用户**。2026-10-14 retro 起 teardown 会紧接着用 `init_db`
**自动重建 FIRST_SUPERUSER**，本地 admin 登录不再被悄悄废掉；但**其他手工创建
的账号仍会丢失**。需要完整重建时：`docker compose run --rm backend bash scripts/prestart.sh`。
注意 trial_review 不在 teardown 清单里，那是第 2 节的另一个坑。

## 3. 本机没有 bun 时别用 `npm run lint`

前端锁的是 bun.lock（biome 2.5.14）；`npm install` 会装出 caret 范围内的新版本（实测 2.5.15），schema 版本校验报警，且 `npm run lint` 是全仓 `--write --unsafe`——CI 从不这么跑（CI 走 pre-commit 的 prek **增量**检查），全仓 unsafe 会把 #19 合入的单行风格文件重排出几百行无关噪音。本机想对齐 CI：装 bun，或只对改动文件跑 `uv run prek run --files <files>`。

## 6. 服务端 env 必须在 compose.override.yml 透传（2026-10-14 retro）

**症状**：宿主直跑 `uv run python scripts/demo_query.py` 全通，但走 http://localhost 的 web API 报
`ProviderError: LLM_BASE_URL is not configured` 或 500——根 `.env` 里明明有值。

**原因**：pydantic settings 的 `env_file="../.env"` 只在宿主跑时命中；容器里那份 .env 没挂载，
compose.yml 的 `environment:` 清单也没透传 `LLM_*` / `LINGSIGHT_RO_PASSWORD` / `RESEARCH_DB_*`。
settings 加新 env 时**没有人会提醒你同步 compose**，这是隐形耦合。

**模式**（compose.override.yml backend.environment 已有完整例子）：

```yaml
      LLM_BASE_URL: ${LLM_BASE_URL:-}          # 空值安全：settings 有 env_ignore_empty
      LINGSIGHT_RO_PASSWORD: ${LINGSIGHT_RO_PASSWORD:-}
      RESEARCH_DB_HOST: ${RESEARCH_DB_HOST:-host.docker.internal}  # 回连宿主 MySQL
    extra_hosts:
      - "host.docker.internal:host-gateway"    # Linux 必需
```

**排查命令**（看进程真实环境，别信 `docker compose config` 的展开）：

```bash
docker exec lingsight-ai-backend-1 sh -c 'tr "\0" "\n" < /proc/1/environ | grep LLM_'
```

## 7. curl 探 SPA 深链接 404 是正常行为，必须带 Accept: text/html

FastAPI 的 `app.frontend()` 按 Accept 头分流：浏览器导航（`Accept: text/html`）
才回退到 index.html；curl 默认 `Accept: */*` 会被当成资产请求返回 404。曾据此
误判「页面坏了」（2026-10-14）。正确探活：

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Accept: text/html" http://localhost/qa
```
