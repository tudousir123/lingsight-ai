#!/usr/bin/env bash

set -e
set -x

mypy app scripts
ty check app scripts
ruff check app scripts
ruff format app scripts --check
