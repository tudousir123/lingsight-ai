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

playwright 服务只挂载 blob-report/test-results，**测试与前端源码是烤进镜像的**——改了
spec 或页面代码不 `docker compose build playwright` 就跑，跑的是旧代码（症状：改动"不
生效"、断言莫名对不上）。`scripts/e2e-local.sh` 已把 build 串进流程（有 layer cache，
秒级）。

## 4. 跑过后端 pytest 之后，dev 栈用户会全部消失

`backend/tests/conftest.py` 的 autouse session fixture 在 teardown 执行
`delete(Item)` + `delete(User)`（模板设计，CI 每 shard 全新库无害），而本地测试
engine 指向的就是 compose 栈的 `app` 库——**任何一次 `uv run pytest` 结束都会
清空 dev 栈的全部用户**，随后的 Playwright auth 会以 400 假失败（2026-10-14
两次实锤，user 表 Update_time 与 pytest 会话结束时刻一致）。`scripts/e2e-local.sh`
已把 prestart 重建串进流程；手动恢复：`docker compose run --rm backend bash scripts/prestart.sh`。
注意 trial_review 不在 teardown 清单里，那是第 2 节的另一个坑。

## 3. 本机没有 bun 时别用 `npm run lint`

前端锁的是 bun.lock（biome 2.5.14）；`npm install` 会装出 caret 范围内的新版本（实测 2.5.15），schema 版本校验报警，且 `npm run lint` 是全仓 `--write --unsafe`——CI 从不这么跑（CI 走 pre-commit 的 prek **增量**检查），全仓 unsafe 会把 #19 合入的单行风格文件重排出几百行无关噪音。本机想对齐 CI：装 bun，或只对改动文件跑 `uv run prek run --files <files>`。
