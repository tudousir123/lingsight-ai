#!/usr/bin/env bash
# Retained entry point for the retired root-.env E2E setup wizard.
set -euo pipefail
cat <<'NOTICE'
E2E 配置向导已停用：本地端到端测试现在自动生成独立的合成配置，
不需要根目录 .env，也不读取现役开发容器的凭据。

请在仓库根目录运行：
  bash scripts/e2e-local.sh

隔离与清理规则见 docs/agents/local-e2e.md。
NOTICE
