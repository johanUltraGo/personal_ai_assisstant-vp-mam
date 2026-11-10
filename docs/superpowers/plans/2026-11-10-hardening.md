# Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the `npm audit` findings and protect her data with daily backups before she relies on the assistant.

**Architecture:** Same server. Upgrade three libraries in place; add one backup service run by the daily jobs.

**Tech Stack:** zod 4, node-cron 4, vitest 5, Node `fs` + SQLite `VACUUM INTO`.

**Spec:** `docs/superpowers/specs/2026-11-10-assistant-completion-design.md` (plus the safety review in the 10 Nov conversation: audit showed zod high, node-cron/uuid moderate, vitest chain critical; data is one SQLite file with no backup).

## Global Constraints
- All 107 existing tests stay green; `npm run typecheck` clean.
- `npm audit` reports 0 high/critical after Part 1.
- Backups never overwrite the live database and never leave `server/`'s git-ignored areas.

## Review Focus
1. Zod 4 changed error shapes: routes that return `err.flatten()` must still give the page readable 400s. (Task 1)
2. node-cron 4 API changes (`schedule` options, `ScheduledTask`): jobs must still register with the school timezone. (Task 2)
3. Backup while the server writes: copy must be a consistent snapshot, not a half-written file. (Task 3)
4. Backup folder growing forever. (Task 3)

---

### Task 1: zod 4
**Files:** `server/package.json`; any `src/**` using zod APIs removed in v4 (`.flatten()` still exists via `z.flattenError`/`error.flatten()`; `z.string().email()/url()/datetime()` deprecated but present); `src/http/errors.ts`.
- [ ] `npm i zod@^4.6.7`; run `npx tsc --noEmit` and `npx vitest run`. Expected: list of breaks (or none).
- [ ] Fix each break with the v4 equivalent; keep 400 bodies `{ error: <readable> }`.
- [ ] Test: `tests/errors.test.ts` add "zod validation error returns 400 with field errors" — `POST /api/tasks {}` → 400 and `body.error` is an object or string mentioning `title`.
- [ ] Suite + typecheck green. Commit.

### Task 2: node-cron 4 and vitest 5
**Files:** `server/package.json`, `src/scheduler/*.ts`, `vitest.config.ts` if options moved.
- [ ] `npm i node-cron@^4.6.0` and `npm i -D vitest@^5.1.0`; drop `@types/node-cron` if v4 ships types.
- [ ] Fix scheduler typings/options; test: `tests/scheduler.test.ts` — "daily jobs register in the school timezone": `startDailyJobs()` returns 2 tasks; stop them after.
- [ ] Suite + typecheck green; `npm audit` → 0 high/critical. Commit.

### Task 3: Daily database backup
**Files:** Create `src/services/backupService.ts`; modify `src/scheduler/dailyJobs.ts` (02:00 daily); `.env.example` (`BACKUP_DIR`, `BACKUP_KEEP_DAYS`, default `server/backups`, 14); `server/.gitignore` (+`backups/`); README section. Test `tests/backupService.test.ts`.
**Produces:** `backupDatabase(now = new Date()): Promise<{ file: string; removed: string[] } | null>` — SQLite only (`DATABASE_URL` starts with `file:`), snapshot via `VACUUM INTO '<dir>/vp-YYYY-MM-DD.db'` (consistent while running), replaces a same-day file, deletes `vp-*.db` older than keep-days; returns null for non-SQLite.
- [ ] Tests: creates `vp-2026-11-10.db` that opens and contains the tasks table; a file dated 20 days earlier is removed with keep 14; non-file DATABASE_URL → null.
- [ ] Implement; suite green. Commit and push.
