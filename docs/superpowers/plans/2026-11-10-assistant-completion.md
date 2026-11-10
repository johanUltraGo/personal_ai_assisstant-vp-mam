# Vice Principal AI Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the gaps in the Vice Principal assistant (sending, evening planning, morning reply, explain, calendar alerts, Drive reading, phone notifications, Google accounts, access PIN, crash fix) behind one Claude assistant.

**Architecture:** Existing Express + Prisma (SQLite) server in `server/`, vanilla-JS page in `server/public/`. New services follow the existing pattern (one service file per concern, thin zod-validated routes, injectable clients for tests). The assistant is a manual Claude tool loop whose tools call the same services the routes use.

**Tech Stack:** Node 24, TypeScript 5.9, Express 5, Prisma 5.22 (SQLite), zod 3, luxon, `@anthropic-ai/sdk` ^1.7.0, `web-push` 3.6.7, vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-11-10-assistant-completion-design.md` (with the original spec txt and `planning.md`).

## Global Constraints
- Model default `claude-opus-5-5` (`ANTHROPIC_MODEL` overrides); never `temperature`/`top_p`/`top_k`; never forced `tool_choice`.
- Nothing leaves the system except via `POST /api/messaging/pending/:id/send`.
- No code path marks a task COMPLETED except an explicit principal action (route or `complete_task` tool on her words).
- Reminders are created only on request.
- All dates computed in `SCHOOL_TIMEZONE` (default `Asia/Kolkata`).
- Every new table is added to `tests/setup.ts` cleanup in FK-safe order.
- Commit after each task on branch `feature/complete-assistant`; push at the end of each part.

## Review Focus
1. A request with an unknown id (task, reminder, pending message, event) → 404, server keeps running. (Task 1)
2. Pressing Send twice / after 30 min → second attempt refused, nothing sent twice. (Task 4)
3. Claude returns a tool call with bad input or a refusal → no tool runs with bad data, turn ends politely. (Task 7)
4. Calendar alerts after a missed 09:00 run → still asked once, never twice. (Task 11)
5. Phone not reachable from the API without PIN when deployed. (Task 2)

---

## Part A — Foundations

### Task 1: Express 5 + central error handling (crash fix)
**Files:** Modify `server/package.json`, `src/app.ts`, all `src/routes/*.ts` (drop try/catch that only re-maps errors); Create `src/http/errors.ts`; Modify `server/.gitignore` (+`uploads/`); Test `tests/errors.test.ts`.
**Interfaces — Produces:** `class NotFoundError extends Error`, `class BadRequestError extends Error`, `errorHandler(err, req, res, next)` mapping: Prisma `P2025` / NotFoundError → 404, ZodError / BadRequestError / `InvalidTransitionError` / body-parse errors → 400, else 500 `{error:"Something went wrong"}` (logged).
- [ ] Test: `POST /api/reminders/nope/snooze {minutes:5}` → 404; then `GET /health` → 200. `POST /api/tasks/nope/complete` → 404. Malformed JSON body → 400.
- [ ] Run → fails (crash/500).
- [ ] `npm i express@^5.2.1 @types/express@^5.0.6`; add `errorHandler` last in `createApp`.
- [ ] `npm test` + `npm run typecheck` pass. Commit.

### Task 2: Access PIN
**Files:** Create `src/http/auth.ts`, `src/routes/auth.ts`; Modify `src/app.ts`; Test `tests/auth.test.ts`.
**Produces:** `requireAccess` middleware; routes `POST /api/auth/login {pin}`, `POST /api/auth/logout`, `GET /api/auth/status → {pinRequired, signedIn}`. Cookie `vp_session` = base64url HMAC-SHA256(key=PIN, "vp-session-v1"), HttpOnly, SameSite=Lax, Secure when `req.secure || COOKIE_SECURE==="true"`. No PIN: allow only loopback without `x-forwarded-for`. 5 failures / 15 min / IP → 429.
- [ ] Tests: with `APP_ACCESS_PIN=123456`: `GET /api/tasks` → 401; wrong pin → 401; right pin → cookie, then 200; 6th wrong attempt → 429. Without PIN: request with `X-Forwarded-For` → 401; plain → 200.
- [ ] Implement, pass, commit.

### Task 3: Activity log
**Files:** prisma `ActivityLog {id, at, kind, summary, refType?, refId?}` + migration; Create `src/services/activityService.ts`, `src/routes/activity.ts`; wire calls into reminderService (fired/failed), morningListService (built, carried N), messaging (Task 4). Test `tests/activityService.test.ts`.
**Produces:** `logActivity(kind: string, summary: string, ref?: {type: string; id: string}): Promise<void>` (never throws), `recentActivity(limit = 20)`; `GET /api/activity?limit=`.
- [ ] Test: firing a due reminder writes kind `reminder.sent`; failing 3× writes `reminder.failed`; `buildMorningList` writes `morning_list.built` with task count.
- [ ] Implement, pass, commit.

## Part B — Sending

### Task 4: Server-enforced Send? + contacts kinds + WhatsApp hand-off
**Files:** prisma `Contact.kind` (default `PERSON`), `PendingMessage {id, channel, contactId, recipientName, recipientAddress?, subject?, body, fromAccountId?, calendarEventId?, createdAt, expiresAt, usedAt?}`, `MessageSent +pendingMessageId?, fromAccount?, handoffUrl?`; Modify `src/services/messagingService.ts`, `src/routes/messaging.ts`, `src/routes/calendar.ts`, `src/connectors/gmailConnector.ts`, `src/connectors/whatsappConnector.ts`; Tests update `messagingService.test.ts`, `messagingApi.test.ts`.
**Produces:**
- `prepareMessage({contactId, channel, subject?, body, calendarEventId?}): Promise<PendingMessage>` — EMAIL needs contact email; WHATSAPP always allowed (group → no address).
- `sendPending(id, connectors): Promise<{status:"SENT"|"FAILED"|"BLOCKED"|"HANDED_OFF"; handoffUrl?: string; record: MessageSent}>` — atomically claims (`usedAt` null and `expiresAt > now`, else BadRequestError "already sent or expired"); WhatsApp uses Business API only for PERSON with number and configured client; otherwise `handoffUrl`; on SENT/HANDED_OFF with `calendarEventId` → event `notifiedAt`, `decision="APPROVED"`.
- `cancelPending(id)`, `listSent(limit)`.
- `whatsappHandoffUrl(number: string | null, body: string): string`.
- Routes: `POST /prepare`, `POST /pending/:id/send`, `POST /pending/:id/cancel`, `GET /sent`, contacts `POST/GET/DELETE` with `kind`. Remove `/confirm-send`.
- Gmail: subject RFC 2047 encoded; `\r`/`\n` in to/subject → BadRequestError. WhatsApp API error code 131047 → FAILED with explanation + `handoffUrl`.
- [ ] Tests: send twice → second 400 and connector called once; expired → 400; group WhatsApp → `HANDED_OFF` with `https://wa.me/?text=` url; person WhatsApp without API → `https://wa.me/919876543210?text=Hello`; Tamil subject encoded `=?UTF-8?B?`; calendar-linked pending send marks event notified.
- [ ] Implement, pass, commit.

### Task 5: Google accounts (multi-account sign-in)
**Files:** prisma `GoogleAccount {id, email @unique, label?, scopes, refreshTokenEnc, isDefault, createdAt, lastUsedAt?}`; Create `src/google/crypto.ts`, `src/google/oauth.ts`, `src/google/accounts.ts`, `src/routes/google.ts`; Modify gmail/drive connectors, `src/routes/connectors.ts`; Test `tests/google.test.ts` (fake `fetch`).
**Produces:** `encrypt(text)/decrypt(blob)` (AES-256-GCM, `TOKEN_ENCRYPTION_KEY` base64 32 bytes, format `v1:iv:tag:data`); `authUrl(label)`; `handleCallback(code, state)`; `accessTokenFor(accountId)` (cached until expiry−60 s); `gmailFromAccounts()`, `driveFromAccounts()` (default first, then others, legacy `GOOGLE_ACCESS_TOKEN` fallback). Scopes `openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/drive.readonly`. Routes `GET /api/google/connect`, `GET /api/google/oauth/callback`, `GET /api/google/accounts`, `POST /api/google/accounts/:id/default`, `DELETE /api/google/accounts/:id`.
- [ ] Tests: encrypt/decrypt round-trip and tamper → throws; callback with unknown state → 400; callback stores email from id_token and encrypted token (not plaintext in DB); refresh called once for two sends; health lists each account.
- [ ] Implement, pass, commit, push Part A+B.

## Part C — Assistant

### Task 6: Claude client wrapper + SDK upgrade
**Files:** `npm i @anthropic-ai/sdk@^1.7.0`; Create `src/ai/claude.ts`; Modify/retire `src/services/aiTaskParser.ts` (removed in Task 15 with its route/tests); Test `tests/claude.test.ts`.
**Produces:** `type ClaudeLike = { beta: { messages: { create(p: any): Promise<any> } } }`; `getClaude(): ClaudeLike` (throws `MissingApiKeyError` without `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`); `callClaude(client, {system, tools, messages, effort}): Promise<BetaMessage>` sets model, `max_tokens: 16000`, `output_config.effort`, `cache_control: {type:"ephemeral"}`, `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`.
- [ ] Test with fake client: request has model `claude-opus-5-5`, effort, fallbacks, no temperature.
- [ ] Implement, typecheck, pass, commit.

### Task 7: Conversations + agent loop + core tools
**Files:** prisma `Conversation {id, kind, createdAt, updatedAt}`, `ConversationMessage {id, conversationId, role, contentJson, createdAt}`, `DayPlanConfirmation {date @id, confirmedAt, via}`, task status `CANCELLED`; Create `src/assistant/prompt.ts` (static system prompt incl. "How I work"), `src/assistant/tools.ts` (definitions + zod + handlers), `src/assistant/agent.ts`, `src/routes/assistant.ts`; Modify `taskService` (+`updateTask`, `cancelTask`), `morningListService` (+`confirmDay`, `confirmedAt` in list; skip CANCELLED), `src/routes/tasks.ts` (`PATCH /:id`, `POST /:id/cancel`), `src/routes/morningList.ts` (`POST /confirm`); Tests `tests/agent.test.ts`, `tests/taskService.test.ts`.
**Produces:** `runTurn(conversationId, text, inputMode, client?): Promise<{reply: string; cards: Card[]}>`; `Card = {type:"send"; pending: PendingMessage} | {type:"plan"; proposalId: string} | {type:"changed"; summary: string}`. Tools per design §3.3. Loop: ≤8 calls; stop on `end_turn`; on `refusal` reply "I can't help with that one." and run nothing; on `max_tokens` run nothing; every tool input zod-validated, failures → `is_error` result. Each user turn = `<context>now, mode, today's list</context>` + her text. History stored verbatim, append-only.
- [ ] Tests (scripted fake client): "remind me at 4" → `set_reminder` runs, reminder exists, reply returned; `prepare_message` → card `send`, nothing sent; bad tool input → `is_error` result sent back, no reminder; refusal → no tools run; second turn replays prior messages unchanged; `complete_task` logs changedBy `principal`; cancel excluded from morning list and carry-over.
- [ ] Implement, pass, commit.

### Task 8: Evening planning
**Files:** prisma `DayPlanProposal {id, conversationId?, planDate, itemsJson, status, createdAt, savedAt?}`; Create `src/services/planService.ts`, `src/routes/plans.ts`; add `propose_day_plan` tool; Test `tests/planService.test.ts`.
**Produces:** `proposePlan(conversationId, date, items)`, `savePlan(id, editedItems)` → tasks DRAFTED→SCHEDULED (source VOICE), status SAVED, older drafts for same conversation DISCARDED; `discardPlan(id)`; routes `GET /api/plans/:id`, `POST /api/plans/:id/save`, `POST /api/plans/:id/discard`.
- [ ] Tests: save creates N tasks with both history rows; saving twice → 400; end ≤ start item → 400; edited items override proposal.
- [ ] Implement, pass, commit.

### Task 9: Drive document reading
**Files:** Modify `src/connectors/driveConnector.ts` (`DriveFile = {name, mimeType, kind:"text"|"pdf"|"image", text?, base64?}`; Google Docs/Slides → text/plain export, Sheets → text/csv; PDF/image ≤10 MB → base64; text >400k chars or other types → BadRequestError); `driveFileIdFrom(urlOrId)`; `read_drive_document` tool returns text or a document/image block; remove `readAndSummarize`. Test `tests/drive.test.ts`.
- [ ] Tests: URL `https://docs.google.com/document/d/ABC123/edit` → `ABC123`; PDF becomes document block; oversize → error result.
- [ ] Implement, pass, commit, push Part C.

## Part D — Calendar, leave, notifications, attachments

### Task 10: Holiday-aware leave
**Files:** Modify `src/services/leaveLetterService.ts`, `src/routes/leave.ts`; `draft_leave_letter` tool; Test `tests/leaveLetterService.test.ts`.
**Produces:** `workingDays(from, to, holidays: Map<isoDate,string>) → {days: string[]; skipped: {date; reason}[]}`; `draftLeaveLetter({audience, names, fromDate, toDate?, reason?, schoolName?})` (async, reads HOLIDAY events) → `{subject, body, workingDays, skipped}`.
- [ ] Tests: Fri 13 Nov–Mon 16 Nov 2026 → 2 days, Sat/Sun skipped; holiday in range skipped with its name; only weekend → 400; >2 students → 400.
- [ ] Implement, pass, commit.

### Task 11: Calendar import, scheduled sync, alerts
**Files:** prisma `CalendarEvent +decision?, decidedAt?`; Modify `src/services/calendarService.ts` (CSV parsing, `importCalendar(text)`, `syncFromDrive()` using `SCHOOL_CALENDAR_FILE_ID`, `raiseDuePrompts(now)`, `pendingPrompts()`, `respond(id, approved)` → draft notice), `src/routes/calendar.ts` (`POST /import`, `POST /sync`, `GET /prompts`, `GET /events?from&to`, `POST /events/:id/respond`); Create `src/scheduler/dailyJobs.ts` (08:55 sync, 09:00 list+prompts, startup); `get_school_calendar` tool; Test `tests/calendarService.test.ts`.
- [ ] Tests: CSV `Date,Event,Type\n12/11/2026,Diwali,Holiday` → HOLIDAY on 12 Nov; re-import creates no duplicates; prompts for events in (today, today+2] once only; outside 09–18 startup → none; respond(no) → DECLINED; respond(yes) → draft mentions event name and date.
- [ ] Implement, pass, commit.

### Task 12: Web Push notifications
**Files:** `npm i web-push@3.6.7 @types/web-push`; prisma `PushSubscription {id, endpoint @unique, p256dh, auth, createdAt, lastSuccessAt?}`; Create `src/notifiers/webPushNotifier.ts`, `src/routes/push.ts`, `public/sw.js`; Modify `notifier.ts` (`notifierFromEnvironment()`, `confirmsDelivery` flag), reminderService (SENT then DELIVERED via `markDelivered(id)`), schedulers; route `POST /api/reminders/:id/delivered`; Test `tests/push.test.ts`.
- [ ] Tests (fake sender): no subscriptions → send fails → retries → FAILED; 410 → subscription deleted; push reminder → SENT, then delivered call → DELIVERED + log; console notifier → DELIVERED immediately (unchanged behaviour).
- [ ] Implement, pass, commit.

### Task 13: Attachments
**Files:** prisma `Attachment.storedName?`, `+driveFileId?`; Modify `attachmentService.ts`, `routes/attachments.ts` (`GET /:id/file`, `POST /drive-link`); Test `tests/attachmentService.test.ts`.
- [ ] Tests: download returns bytes and content-type; drive link stores id, no file; unknown id → 404.
- [ ] Implement, pass, commit, push Part D.

## Part E — Screen and docs

### Task 14: Page
**Files:** `public/index.html`, `public/style.css`, split `public/app.js` into `public/js/{api,assistant,today,messages,calendar,settings,tasks}.js` (ES modules).
Sections: assistant (conversation, mic with listening state, "Plan tomorrow", Send?/plan cards), Today (Looks good / Change…), Alerts (event Yes/No, failed reminders), Messages (contacts incl. groups, compose → Send?, history, WhatsApp hand-off opens link), Leave (range → prepare), Calendar (import/sync/upcoming), Connections (Google accounts, notifications enable, WhatsApp), Activity, Tasks/Reminders (existing + cancel/reschedule), Attachments (multi-select + list), PIN prompt on 401.
- [ ] `node --check` every file; server smoke: page and `/js/*.js` served 200; headless Edge `--dump-dom` shows sections.
- [ ] Remove `/api/ai/parse-task`, `aiTaskParser.ts` and their tests. Commit.

### Task 15: Docs
**Files:** `planning.md` (status table), `server/README.md` (setup: PIN, Anthropic key, Google OAuth client + redirect URI, `TOKEN_ENCRYPTION_KEY`, VAPID keys, WhatsApp, calendar file id), `server/.env.example`.
- [ ] Full `npm test` + typecheck green. Commit, push branch.
