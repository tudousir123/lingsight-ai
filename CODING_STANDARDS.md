# CODING_STANDARDS.md — 评审用判断型规则

双轴 code-review 的 Standards 轴以此为准。只收录自动化检查（`backend/scripts/lint.sh` 的 mypy/ty/ruff、pre-commit、CI）无法机械判定的规则；机械规则一律做成检查，不写在这里。规则来源是 M1-T9 双轴评审实际执行过的裁决（docs/evidence/m1-t9/）。

## 单一来源

常量、口径、黄金基准值只允许存在一处，跨模块 `import` 引用。同一事实的第二份字面量拷贝——即使值相同——即违规（实例：permission reason-code 家族、`ALGO_VERSION`、`REL_TOL`、黄金 group×day 矩阵）。

## 双类型检查器

mypy(strict) 与 ty 同时在跑，二者方言不同。类型问题先找真实守卫：None 检查、类型收窄、PEP 484 显式 re-export。`# type: ignore` 是最后手段，且必须确认两个检查器都接受——满足 mypy 的 ignore 可能被 ty 拒绝，反之亦然；留到过期的 ignore 同样算违规（strict 的 `warn_unused_ignores` 会炸，见 efa3e21 修复记录）。

## env 门控测试

依赖真实研究库或真实 LLM 端点的测试必须标 `pytest.mark.env_gated`，并且门控**探活**——对依赖做一次廉价的真实请求（DB：`SELECT 1`；LLM：`provider.probe()`），失败路径是带原因的 `pytest.skip`。只查配置存在性不合格：已配置但宕机的依赖必须 skip，不能以代码失败的形态红掉（见 test_eval_execution.py 的两个 fixture）。

## 证据纪律

声称"测试通过 / 已运行 / 已验证"必须附可重放命令与输出（docs/evidence/、提交信息或工单），无证据的声称按未发生处理。
