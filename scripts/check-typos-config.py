#!/usr/bin/env python3
"""Keep spelling configuration in the root pyproject.toml."""

import argparse
import os
import subprocess
import sys
from pathlib import Path

import tomllib

SHADOW_CONFIGS = ("_typos.toml", ".typos.toml", "typos.toml")
GLOBAL_CONFIGS = {
    "pyproject.toml",
    ".pre-commit-config.yaml",
    "scripts/check-typos-config.py",
    *SHADOW_CONFIGS,
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scan", action="store_true", help="run the hook environment's pinned typos"
    )
    parser.add_argument("files", nargs="*")
    args = parser.parse_args()
    root = Path(
        subprocess.check_output(
            ["git", "-C", str(Path.cwd()), "rev-parse", "--show-toplevel"], text=True
        ).strip()
    )
    shadows = [
        name
        for name in SHADOW_CONFIGS
        if (root / name).exists() or (root / name).is_symlink()
    ]
    if shadows:
        print(
            f"Typos config must live in pyproject.toml [tool.typos]; remove root shadows: {', '.join(shadows)}",
            file=sys.stderr,
        )
        return 1
    try:
        with (root / "pyproject.toml").open("rb") as stream:
            config = tomllib.load(stream)
    except (OSError, tomllib.TOMLDecodeError) as error:
        print(f"Cannot read canonical pyproject.toml: {error}", file=sys.stderr)
        return 1
    if not isinstance(config.get("tool", {}).get("typos"), dict):
        print("Missing canonical pyproject.toml [tool.typos] table", file=sys.stderr)
        return 1
    if not args.scan:
        return 0

    # Never let typos fall back to a recursive '.' walk (including private .env).
    tracked = [
        os.fsdecode(name)
        for name in subprocess.check_output(
            ["git", "-C", str(root), "ls-files", "-z", "--cached"]
        ).split(b"\0")
        if name
    ]
    broad = any(
        name in GLOBAL_CONFIGS or name.startswith(".github/workflows/")
        for name in args.files
    )
    requested = set(args.files)
    paths = [
        f"./{name}"
        for name in dict.fromkeys(tracked)
        if (broad or name in requested)
        and (root / name).is_file()
        and not (root / name).is_symlink()
    ]
    # Bound argv size; all paths remain independent arguments, including newlines.
    status = 0
    for start in range(0, len(paths), 100):
        result = subprocess.run(
            ["typos", "--force-exclude", "--", *paths[start : start + 100]],
            cwd=root,
            check=False,
        )
        if result.returncode and not status:
            status = result.returncode
    return status


if __name__ == "__main__":
    sys.exit(main())
