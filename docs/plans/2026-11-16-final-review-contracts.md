# Platform support contract single source Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve STD-02 without conflating platform compatibility support with independently deployed Agent advertisements or runtime health.

**Architecture:** Extend existing backend/app/contracts.py → backend/scripts/export_frontend_routes.py → frontend/src/lib/upstreamRoutes.gen.ts path. Import the platform support constants in gateway, UI, derived TS types and supported fixtures. Keep exact fail-closed validation and disabled-generation read/management behavior.

**Tech Stack:** Python/FastAPI, React/TypeScript/Vite, pytest, Playwright.

---

### Task 1: export red and drift tripwire
- Extend `backend/tests/scripts/test_export_frontend_routes.py` to require exports for execution/personal/environment/files/memory support.
- Run explicit current-source pytest under existing same-lock venv with PYTHONPATH and UV_NO_SYNC; record missing-export RED.
- Add support declarations to `backend/app/contracts.py`, extend `backend/scripts/export_frontend_routes.py`. Run current-generation drift test RED before regenerating `frontend/src/lib/upstreamRoutes.gen.ts`; then rerun GREEN.

### Task 2: consumers
- Modify `backend/app/api/routes/agent.py` to import all new support declarations. Keep bool `is True` and browser negative flags, no enabled shortcuts for protocol or management.
- Modify `frontend/src/features/agent/{Execution,PersonalAgent,MemoryPanel,Workspace}.tsx`, `api.ts`, and shared/tests capability fixtures to import generated values; derive exact TS types via typeof and display supported engine version from the same value.
- Parameterize gateway and UI missing/obsolete/wrong-boolean negatives; retain disabled history and management positives.

### Task 3: current-source validation and handoff
- Run gateway/exporter tests and backend lint with explicit PYTHONPATH, UV_NO_SYNC and same-lock environment; prove module imports resolve this worktree.
- Reuse dependencies without creating frontend volumes. Check affected files, typecheck and build with envDir:false and notes-local outDir/cache; require df >=3GiB before build. Run affected UI specs via local isolated preview and browser-check actual interface.
- Commit explicit paths with unique Made-with trailer and immediately ordinary push. Merge latest integration into this owned branch only and verify remote/clean HEAD. Parent fresh merger owns final integration and tracker/PR state.
- Record evidence and source hashes in shared `notes/final-fixes/{REPORT,CONTRACT}.md`.
