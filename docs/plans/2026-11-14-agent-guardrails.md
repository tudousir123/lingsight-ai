# Agent Guardrails Implementation Plan

> **For implementers:** Follow the installed `implement`, `tdd` and `code-review` skills; execute the following tasks in this session with independent worktrees for parallel components.

**Goal:** Implement all five accepted retro candidates without touching existing user WIP, production services or scientific data.

**Architecture:** Public CLI seams, real temporary Git repositories, standard-library unit tests and fake external executables make the guards deterministic and offline-testable. Reuse existing prek/CI and isolated test scripts; keep typos in the existing pyproject table. No new model/API services or automatic local hook installation.

**Tech Stack:** Bash, Python 3 standard library (CI Python 3.14), Git, Bun 1.3.12, existing Docker/prek/Biome.

**Fixed review point:** `18a384fdd3b5de3b72029453d5c481a7a4b4808b`.
**Spec source:** accepted `retro/复盘与护栏建议.md` in this session workbench; this plan records the concrete interfaces.

## Agreed seams and verification

The user approved the retro acceptance criteria with “落地”. Tests stay at those public seams: CLI exit/result in synthetic repositories; command/argument boundaries to fake Docker and fake prek; root configuration validation via CLI. They do not touch real databases, GPU, production or private `.env`. Fake Docker tests validate argument construction and isolation, not actual image/network behavior; separately run a real Docker smoke/build where available.

### Task 1: Fail-closed worktree execution

Files: create `scripts/wt-exec.sh`, `scripts/tests/test_wt_exec.py`; update `docs/agents/parallel-tickets.md`.

Interface:

```bash
bash scripts/wt-exec.sh /absolute/worktree expected-branch -- command arg...
```

1. Add a test in a temporary Git repo plus linked worktree. Start the CLI from the main checkout and ask it to write a marker; initially the missing CLI must fail.
2. Implement explicit canonical path resolution, require actual repository top-level and exact symbolic branch; reject detached HEAD, nested paths, invalid paths and protected main/master. Never infer the expected worktree from current cwd. `exec` only the supplied argument vector after `cd` into verified target.
3. Run that test green, then grow separate red→green slices for wrong branch/path, main, detached HEAD, exit code and arguments containing spaces/metacharacters. Denied commands must leave main HEAD/index/WIP and marker absent.
4. Document that callers must use the wrapper; it cannot intercept raw Git commands. Normal target WIP is allowed, because task worktrees may contain the user's implementation; this is not an implicit clean/reset command.

Run: `python3 -m unittest discover -s scripts/tests -p 'test_wt_exec.py' -v`.

### Task 2: Retire unsafe parallel-test recipe

Files: update `docs/agents/parallel-tickets.md`; use existing `docs/agents/local-e2e.md` as canonical test reference.

1. Replace `.env`/private-credential copying, fixed production/development DB container operations and unconditional cleanup with pointers to the existing isolated backend and full-stack runners.
2. Keep useful worktree creation, file-intersection and merge-preview instructions. Show the protected execution CLI for worktree commands. Preserve worktree and branch by default; remove only task-owned disposable resources.
3. Resolve the stale advice to choose conflicting text by recency: reconcile actual project rules and evidence, not mtime.
4. Add a targeted regression check that this navigated recipe no longer instructs copying private `.env`, manipulating the fixed existing DB container, or merging credentials back. Keep existing AGENTS.md untouched (it contains user WIP and already routes to this document).

### Task 3: CI-equivalent local preflight and SDK triggers

Files: create `scripts/pr-preflight.sh`, `scripts/tests/test_preflight.py`; modify `.pre-commit-config.yaml`; update `docs/agents/local-e2e.md`.

Interface:

```bash
bash scripts/pr-preflight.sh <fixed-base-ref>
```

1. TDD at CLI boundary in temporary Git repos with a fake `uv`: reject bad refs, main/detached HEAD and dirty tracked/index/untracked work without running a formatter. Resolve and print exact base/HEAD, use the same from-ref/to-ref scope as CI.
2. Reuse `uv run prek run --from-ref BASE --to-ref HEAD --show-diff-on-failure`; do not stage, commit, push, reset or silently stash. Fail if hooks return nonzero or mutate tracked/untracked/index state. Recheck branch/HEAD if execution changes them. Initial cleanliness is deliberately strict for this committed-head preflight.
3. Extend the existing SDK hook trigger to root `package.json`, `bun.lock`, `frontend/package.json` in addition to current inputs. Keep existing frozen installation and generated SDK drift CI gates.
4. Wire the standard-library guard test discovery into existing prek so the checks protect future changes; avoid duplicated test workflow definitions.

Run `python3 -m unittest discover -s scripts/tests -p 'test_preflight.py' -v`, then actual pinned-Bun install and `uv run prek run --from-ref <fixed-base> --to-ref HEAD --show-diff-on-failure` on the final clean integration branch.

### Task 4: Typos single-source guard

Files: create `scripts/check-typos-config.py`, `scripts/tests/test_typos_config.py`; modify `.pre-commit-config.yaml`.

1. TDD the public Python CLI: existing `[tool.typos]` plus root `_typos.toml`, `.typos.toml` or `typos.toml` must fail with paths and no source writes; only canonical pyproject config passes. Use standard library TOML parsing.
2. When canonical/global spelling configuration changes, run typos on Git-tracked files (NUL-safe path handling and existing `--force-exclude` rules), not a recursive walk over private untracked files. Reuse the installed hook environment's pinned `typos` binary, or provide an explicitly tested available path; do not assume a global host binary exists.
3. Preserve existing `alls`, `onSeeked`, ignore regex and generated/lock exclusions. Wire guard and broad configuration-change scan through existing prek. Test external command exit propagation and tracked paths containing spaces/metacharacters.

Run `python3 -m unittest discover -s scripts/tests -p 'test_typos_config.py' -v`.

### Task 5: Deterministic frontend helper

Files: modify `scripts/fe.sh`; create `scripts/tests/test_fe_helper.py`.

1. TDD through a fake Docker executable, then real Docker smoke: fixed Bun 1.3.12, `bun ci`, no lock drift, and scoped build/check/fix behavior.
2. Isolate dependency volume names by canonical worktree and lock fingerprint, including separate root/frontend dependency mount targets. Two worktrees with different locks must not share mutable dependency volumes. Do not remove user volumes.
3. Forward filenames/arguments as an argv array, never interpolate input into executable `sh -c` text. Preserve spaces and shell metacharacters as data. Missing files/unsupported commands fail before Docker; check/fix must not become repo-wide writes.
4. Test consistency with the existing CI/Playwright Bun pin; do not add a third independently floating version.

Run `python3 -m unittest discover -s scripts/tests -p 'test_fe_helper.py' -v`; real pinned Docker `build`/targeted check on final integration tree where available.

## Integration and delivery

1. Implement the independent helper and check components in dedicated linked worktrees, each with explicit `cd`/`git -C`. Commit only their named files with unique `Made-with: Proma` trailers. No sub-delegation, push, tracker edits or deployment.
2. Main implementer owns worktree CLI, parallel recipe and this plan; merge component branches normally. Do not add or replace AGENTS.md, `.agents/`, `skills-lock.json`, local credentials or existing user changes.
3. Run shell syntax checks, Python guard test discovery, scoped formatter/type checks and actual final preflight. Validate real frontend Docker invocation separately from fake-executable tests. Backend/app UI source is unchanged: do not rerun expensive full-stack/GPU tests merely as ritual.
4. Run independent Standards and Spec review against the fixed base, fix blockers, rerun relevant checks. Record what was tested versus simulated.
5. Leave the reviewed result committed on the dedicated branch; “落地” authorizes implementation, not a fresh production deploy or automatic merge to main. Report commit, tests, remaining boundaries and how to run the new guards. Preserve the user's original 113 WIP files and patch byte-for-byte.
