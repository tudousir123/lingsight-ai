# Independent pre-merge review — 2026-11-11

## Standards

Independent fresh-context subagent: PASS, 0 open findings after fixes. Retired the obsolete developer-.env wizard, made both synthetic marketing sections visibly labelled in English and Chinese, corrected contact wording to mask-based contact, and made language/theme selection usable when browser storage throws. Fowler baseline heuristics found no material residual concern. Original wizard source is preserved outside Git in the task workspace.

## Spec

Independent fresh-context subagent: PASS, 1 finding resolved, 0 open findings. Published centroid now preserves the exact mask-pixel centroid from keypoints.json, matching the v9 crop and frozen-heading source. Tracking contour moments are not a fallback; missing/malformed centroids reject 422. Tracking contour area and all frozen algorithm parameters remain unchanged.

Summary: Standards 0 open; Spec 0 open. Deployment and real-video researcher acceptance remain #45 work.

## Execution evidence

- Before fix: `cd backend && bash scripts/test-local.sh tests/api/routes/test_publish.py -k 'mask_pixel_centroid or malformed_scientific_contract' -q` reproduced 5 failures: distinct centroid precision and four malformed values (`centroid-before.txt`).
- After fix: `cd backend && AGENT_CONTRACT_REPOSITORY=<current lingsight-agent checkout> bash scripts/test-local.sh -q`: 241 passed / 6 research-live skipped, coverage 91% (`backend-after.txt`). Uses disposable MySQL and real HTTP Agent contract, never the developer DB.
- `cd frontend && PLAYWRIGHT_BASE_URL=http://127.0.0.1:5188 node ../node_modules/@playwright/test/cli.js test landing-navigation.spec.ts onboarding.spec.ts --project=chromium --no-deps --workers=2 --reporter=line` with isolated `bun run dev --host 127.0.0.1 --port 5188 --strictPort`: 20 passed, including blocked-storage and bilingual synthetic captions (`browser-after.txt`).
- Complete source combination before these narrow review fixes: full disposable Compose suite 102 passed; see ../closeout-20261111/full-stack-final.txt. A new local Docker rebuild stalled downloading Bun dependencies and was cancelled before tests; this is not recorded as a pass. The current commit must pass GitHub Compose/browser CI before merge.
- Current Agent PR https://github.com/tudousir123/lingsight-agent/pull/2 passed GitHub production pinned-runner build and full Docker suite at fb3f1b3 (runs 43043656420 and 43043649084), then merged as a40c23f. This resolves the production-image-build validation limitation of earlier cache-image evidence; runtime deployment is still separate.
- Inference docs PR https://github.com/tudousir123/lingsight-inference/pull/2 passed both CI test runs and merged as 6635283; no frozen algorithm changes.
