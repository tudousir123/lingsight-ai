#!/usr/bin/env bash

set -e
set -x

# 容器跑检查会留下 root 属主缓存，宿主再跑会误报（mypy INTERNAL ERROR /
# ruff 权限错误，2026-11-10 实测）。缓存不可写时换到临时目录。
if [ -d .mypy_cache ] && [ ! -w .mypy_cache ]; then
  export MYPY_CACHE_DIR="${TMPDIR:-/tmp}/lingsight-mypy-cache"
fi
if [ -d .ruff_cache ] && [ ! -w .ruff_cache ]; then
  export RUFF_CACHE_DIR="${TMPDIR:-/tmp}/lingsight-ruff-cache"
fi

mypy app scripts
ty check app scripts
ruff check app scripts
ruff format app scripts --check
