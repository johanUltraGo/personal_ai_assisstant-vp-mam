# Vice Principal AI — Planning Document

**Status:** Draft for review — planning only, no implementation yet.
**Source material analysed:** `Vice Principal AI Assistant Specs.txt` (dated 23 October 2026, sourced from the "10 Layer Design Workbook"). This is the only uploaded reference file found in the project directory; no other documents, code, or prior project artifacts exist in `c:\VICE PRINCIPAL AI` at the time of writing.
**Legend used throughout:** 🔵 = stated in the uploaded spec · 🟢 = proposed improvement/addition by this planning pass (not in the spec) · ❓ = unresolved, carried from the spec or newly identified.

---

## 1. Project Overview and Vision

Vice Principal AI is a personal planning and reminder assistant for one person — Principal Uma Maheshwari — built to remove the daily cognitive load of planning her day and remembering to act on time. 🔵

Every evening, the assistant reviews the next day's tasks with her, proposes a schedule, and — once she approves it — manages timed reminders (an early warning and a final warning) for each task, across her phone and desktop. 🔵 The Principal remains the sole authority over her own schedule: the assistant never marks anything done, never contacts anyone outside her own devices, and defers to her whenever something is ambiguous or fails. 🔵

**Vision statement (🟢, synthesized from the spec's goals):** a quiet, trustworthy second brain that plans with her each evening and never lets a commitment slip — without ever acting behind her back or exposing school data beyond her own devices.

This is explicitly a **single-user personal productivity tool**, not a school-wide administrative system. It does not manage student records, does not communicate with parents/staff automatically, and does not (yet) have confirmed multi-user support. 🔵

---

## 2. Analysis of Uploaded Reference Materials

### 2.1 What the spec clearly establishes
- Problem: Principal loses time planning and remembering daily work. 🔵
- Primary success measures: zero missed reminders, tracked on-time completion rate, less time spent planning. 🔵
- One primary user (Principal), one setup/admin role (developer Johan), indirect beneficiaries (school community/parents) who have **no direct interaction** with the system. 🔵
- A full task lifecycle with timestamped history. 🔵
- A two-stage reminder model (−60 min, −10 min) delivered to phone and desktop. 🔵
- A human-approval-first philosophy: the assistant proposes, Principal disposes. 🔵
- A proposed (not finalized) tech direction: Python backend, Supabase, PWA, Web Push. 🔵
- Four proposed build phases, each gated by Principal's own testing. 🔵
- An explicit out-of-scope list protecting students and other staff from automated contact. 🔵

### 2.2 Ambiguities and internal conflicts found in the spec
These are flagged, not resolved — see §17 for the full unresolved-questions register.

| # | Conflict / Ambiguity | Where it appears |
|---|---|---|
| 1 | §7 states "Desktop app and phone app use one local API" (implying both are in scope for v1), but §12 separately asks "Should the first version be a phone app, desktop app, or both?" — the system design assumes an answer the open questions haven't settled. | §7 vs §12 |
| 2 | §6 says history is kept as "official records" that are deleted only via a manual, Principal-approved step — but also notes the workbook contains **both** "keep official records" and "delete audit log" as source statements, and asks which applies. | §6 |
| 3 | Food quality/wastage checks are listed as a category in §3 but flagged "(confirm food checks are in scope)" in the same line, and re-asked in §12. | §3 vs §12 |
| 4 | §5 reminder rules are described as fixed (−60/−10) but immediately marked "(proposed)" for being user-configurable — it's unclear if configurability is a v1 requirement or a later idea. | §5 |
| 5 | Scheduler polling interval, alert deduplication keys, and retry logic are all marked "(proposed)" — these read as the document author's own suggestions layered onto the workbook, not confirmed requirements. | §5 |

### 2.3 Missing information (not invented — see §17)
- No information on device types/OS the Principal actually uses.
- No information on data volume (tasks/day), school size, or term structure.
- No confirmation of what "school portal" and "timetable" systems technically are, or whether IT/leadership has approved read access to them.
- No mention of budget, timeline, or who maintains the system after Johan's initial setup.
- No voice-note language/accent considerations.

---

## 3. Project Goals and Success Criteria

| Goal | Source | Success Criterion |
|---|---|---|
| Eliminate missed reminders | 🔵 §1 | 0 missed stage-1/stage-2 alerts in a 2-week trial 🔵 §9 |
| Reduce planning/remembering effort | 🔵 §1 | Evening plan review takes ≤10 minutes 🔵 §9 |
| Track completion reliably | 🔵 §1, §3 | Weekly on-time completion rate reported 🔵 §1 |
| Keep school data contained | 🔵 §6 | No student data leaves the school system; nothing auto-sent externally 🔵 §9 |
| Timely delivery | 🔵 §9 | Notifications arrive within 60 seconds of schedule 🔵 §9 |
| Graceful handling of busy days | 🔵 §9 | Overlapping tasks produce no missed alert 🔵 §9 |
| 🟢 Build trust incrementally | 🟢 proposed | Each phase independently tested and signed off by Principal before the next starts 🔵 §10 |

---

## 4. Target Users and Their Responsibilities

| Role | Who | Responsibilities | Source |
|---|---|---|---|
| **Primary user** | Principal, Uma Maheshwari | Creates/dictates tasks, reviews & approves the evening plan, confirms completion, responds to clarification prompts, can snooze/delay/reschedule/clear any reminder | 🔵 §2, §3, §8 |
| **Setup admin** | Developer, Johan | Initial setup of timetable, categories, preferences; (🟢 proposed: also responsible for knowledge-base refresh cadence, system monitoring, and applying school approvals for data access) | 🔵 §2 + 🟢 extension |
| **Indirect beneficiaries** | School community, parents | Benefit from the Principal being better organized; **no direct access, no automated contact** | 🔵 §2, §11 |
| 🟢 **Future role (unconfirmed)** | Other staff? | Open question — spec explicitly asks whether anyone besides the Principal will use the assistant (§12); treat as **not in scope** until answered | ❓ §12, carried to §17 |

---

## 5. Functional Requirements

Numbering follows the task lifecycle in the spec (§3–§5, §8).

1. **FR-1 Task capture** — accept a task via typed text or a voice note; a voice note produces a *draft* task requiring review, not an immediately scheduled one. 🔵
2. **FR-2 Evening planning session** — each evening, propose the next day's schedule from pending/incomplete tasks + calendar/timetable; Principal can approve as-is or edit before it's finalized. 🔵
3. **FR-3 Two-stage reminders** — fire a stage-1 alert 60 minutes before a task's start, and a stage-2 alert 10 minutes before, to both phone and desktop. 🔵
4. **FR-4 Task lifecycle & overdue detection** — enforce the state machine in §4 below; flag a task "Overdue" once its time passes without completion, and raise that as its own alert. 🔵
5. **FR-5 Reminder control** — allow snooze, delay, reschedule, and clear on any pending reminder, at any time, by the Principal only. 🔵
6. **FR-6 Categorization** — tag tasks with one of: teaching, academic/admin, exam duties, events, and (❓ unconfirmed) food quality checks. 🔵
7. **FR-7 Manual completion only** — only the Principal can mark a task Completed/Achieved; the system never does this automatically. 🔵
8. **FR-8 Reporting** — produce a daily and a weekly summary of done/pending/overdue tasks. 🔵
9. **FR-9 Full audit trail** — every state transition is written to task history with a timestamp. 🔵
10. **FR-10 Human-in-the-loop escalation** — the assistant must stop and ask the Principal when input is unclear, a database/sync error occurs, or a change needs her confirmation. 🔵
11. **FR-11 Learning from correction** — corrections the Principal makes to proposed plans are retained and influence future plans. 🔵
12. 🟢 **FR-12 (proposed) Preference configuration** — let the Principal (or Johan, for initial defaults) adjust alert offsets away from the −60/−10 default, since the spec marks this as a live proposal rather than a settled requirement.
13. 🟢 **FR-13 (proposed) Failure visibility** — surface failed notification deliveries on the desktop app after retries are exhausted, so a silent failure never becomes a missed reminder (addresses the "zero missed reminders" goal more robustly than retries alone).

---

## 6. Proposed Feature List, Grouped by Priority

| Priority | Feature | Why |
|---|---|---|
| **P0** | Task CRUD (create/edit/delete) with categories, due time, notes | Nothing else works without a task store 🔵 |
| **P0** | Task state machine + timestamped history log | Required for overdue detection, audit, and the "on-time completion" success metric 🔵 |
| **P0** | Stage-1 (−60min) and Stage-2 (−10min) alert scheduling | Directly the stated core value proposition 🔵 |
| **P0** | Manual completion confirmation by Principal | Core trust boundary — the assistant must never self-mark done 🔵 |
| **P0** | Desktop notification delivery | Simplest, most reliable initial channel (no app-store/mobile-push setup) 🟢 |
| **P1** | Phone push notification delivery | Explicitly required eventually (§3, §7), but can follow desktop in sequencing 🔵 |
| **P1** | Evening planning session UI/flow | High-value but depends on task store + scheduling existing first 🔵 |
| **P1** | Snooze / delay / reschedule / clear controls | Needed for real-world day flexibility 🔵 |
| **P1** | Daily & weekly summaries | Supports the "less time remembering" goal; reporting layer, not core transaction path 🔵 |
| **P1** | Voice note capture → draft task | High convenience, but depends on a transcription-location decision first (❓ open) 🔵 |
| **P1** | Alert delivery log (sent/delivered status, retries) | Needed to actually prove "zero missed reminders" 🔵 |
| **P2** | Preferences UI for adjustable alert offsets | Marked "(proposed)" in source; nice-to-have once defaults are proven 🔵/🟢 |
| **P2** | School timetable / academic calendar sync | High value but carries the largest integration + approval risk (❓ open) 🔵 |
| **P2** | School portal data sync | Same as above; depends on unresolved school-system access approval 🔵 |
| **P2** | Preference learning from corrections (beyond simple logging) | Valuable but an AI-judgment feature that should only be built on proven manual data first 🔵 |
| **P2** | 🟢 Food quality/wastage check workflow | Not confirmed as in-scope; build only after §12 question is answered |
| **P2** | 🟢 Configurable retry policy / admin dashboard for Johan | Operational nicety, not needed for Principal's day-to-day value |

---

## 7. Detailed User Workflows

### 7.1 Evening Planning Session 🔵
1. At a fixed evening time (❓ exact trigger time not specified), the assistant compiles tomorrow's known tasks (scheduled items, carried-over overdue items, calendar/timetable entries).
2. Assistant presents a proposed schedule with times for each task.
3. Principal reviews: approves as-is, edits times/order, adds, removes, or re-categorizes tasks.
4. On approval, all tasks move to **Scheduled** and alert times are calculated and stored.
5. 🔵 Target: this entire review takes ≤10 minutes (§9 acceptance criterion).

### 7.2 Task Capture (Typed) 🔵
1. Principal types a task (text) at any time, not only during the evening session.
2. Assistant validates required fields (what, when, category).
3. If anything is ambiguous, assistant asks for clarification (FR-10) rather than guessing.
4. Valid task enters **New/Drafted**, then **Scheduled** once alert times are computed.

### 7.3 Task Capture (Voice) 🔵
1. Principal records a voice note.
2. Voice note is transcribed (❓ location: on-device vs. cloud — unresolved, privacy-sensitive) into a **draft** task.
3. Draft is *not* auto-scheduled — it waits for Principal review/approval, same as any ambiguous input (FR-10).

### 7.4 Reminder Lifecycle 🔵
1. Scheduler identifies due alerts (🔵 proposed: checked every minute).
2. Stage-1 alert fires at T−60 min on phone + desktop.
3. Stage-2 alert fires at T−10 min on phone + desktop ("transition warning").
4. Each alert is logged with sent/delivered status; failed sends retry up to 3 times, then surface on desktop (🔵 proposed).
5. Principal may snooze, delay, reschedule, or clear at any point — each action is logged (§5).
6. If task time passes with no completion confirmed, state becomes **Overdue** and a dedicated overdue alert fires.

### 7.5 Completion 🔵
1. Principal explicitly confirms a task as done (in-app action).
2. State moves to **Completed/Achieved**, timestamped.
3. The assistant never performs this step automatically, regardless of time elapsed or other signals.

### 7.6 Daily/Weekly Review 🔵
1. At day/week end, assistant compiles counts of done, pending, and overdue tasks.
2. Summary is shown to Principal (channel/format: ❓ not specified — proposed: in-app view, §9 UX section).

### 7.7 🟢 Error/Escalation Workflow (proposed elaboration of FR-10)
1. On a DB write failure, sync failure, or ambiguous input, assistant halts the automated action.
2. Assistant surfaces a clear, specific prompt to the Principal (what failed, what it needs from her).
3. No silent retries beyond the logged retry policy — every escalation is itself logged to history for traceability.

---

## 8. AI Capabilities and Limitations

### 8.1 What the AI is expected to do 🔵
- Parse free-text and voice input into structured task fields (what, when, category).
- Propose a next-day schedule, balancing new tasks against calendar/timetable entries.
- Calculate and track alert timing.
- Detect schedule conflicts (overlapping tasks) and overdue conditions.
- Adapt future proposals based on the Principal's past corrections.

### 8.2 Hard limitations — the AI must NOT 🔵
- Mark any task complete on its own (§3, §8).
- Contact parents, staff, or anyone outside the Principal's own phone/desktop, automatically (§6, §8, §11).
- Store or process student personal data (§6).
- Edit student records (§11).
- Act on an ambiguous input without asking first (§8).
- Sync with other users/devices beyond the Principal's own (§11 — no multi-user sync for now).

### 8.3 🟢 Proposed guardrails (not in spec, recommended)
- Every AI-generated schedule proposal should be clearly marked as a *proposal*, visually distinct from Principal-approved/locked items, so she never mistakes a suggestion for a commitment.
- Log a confidence/ambiguity flag on parsed voice/text tasks so low-confidence parses are *always* routed to clarification (FR-10), not just occasionally.
- Preference "learning" (FR-11) should start as simple rule logging (e.g., "Principal always moves exam-duty tasks earlier") rather than an opaque model, so Johan and the Principal can audit *why* a proposal changed.

---

## 9. UI/UX and Dashboard Planning

🔵 = screens implied directly by spec; 🟢 = proposed to fulfill those requirements, since no mockups/wireframes were supplied.

| Screen/Surface | Purpose | Priority |
|---|---|---|
| Task list (desktop) | View/add/edit tasks, see state at a glance | P0 🔵 |
| Evening planning review | Approve/edit tomorrow's proposed schedule | P1 🔵 |
| Notification (phone + desktop) | Stage-1, stage-2, overdue alerts; snooze/delay/reschedule/clear actions inline | P0/P1 🔵 |
| Daily summary view | Done/pending/overdue counts for today | P1 🔵 |
| Weekly summary view | Same, rolled up over a week | P1 🔵 |
| Voice capture control | Record a voice note → draft task | P1 🔵 |
| Clarification prompt | Surfaced whenever FR-10 triggers | P0 🔵 |
| 🟢 Preferences/settings | Alert offsets, categories (admin-entry by Johan initially) | P2 |
| 🟢 Task history/audit view | Read-only log of all state transitions, for trust/debugging | P1 (supports FR-9) |

**🟢 UX principle (proposed):** every surface that shows an AI-proposed change should make the "accept vs. edit" choice equally easy — the point of the product is trust, and a UI that nudges toward blind acceptance undermines §8's human-approval rules.

No visual mockups exist yet; recommend a short follow-up mockup/wireframe pass before UI implementation begins (see §20).

---

## 10. Data Model and Information Management Requirements

🔵 Proposed tables per the spec (§6): `tasks`, `alerts`, `categories`, `preferences`, `history log`. Below is an elaboration consistent with that proposal — field-level detail is 🟢 (not specified in the source) and should be validated with Johan before building.

| Table | Key Fields (🟢 proposed detail) | Notes |
|---|---|---|
| `tasks` | id, title, description, category_id, start_time, created_via (text/voice), state, created_at, updated_at | State enum per §4 lifecycle |
| `task_history` | id, task_id, from_state, to_state, changed_at, changed_by | Append-only; satisfies FR-9 audit requirement 🔵 |
| `alerts` | id, task_id, stage (1/2/overdue), scheduled_at, sent_at, delivered_at, status, retry_count | Unique key per alert to prevent duplicate sends 🔵 (proposed in spec) |
| `categories` | id, name, active | Seeded by Johan at setup 🔵 |
| `preferences` | key, value, scope (global/Principal) | Houses alert-offset overrides if FR-12 is built 🟢 |
| `knowledge_base_entries` | id, source (timetable/portal/calendar), payload, valid_from, valid_to, synced_at | Refresh cadence: termly or monthly 🔵 |
| 🟢 `voice_drafts` | id, audio_ref or transcript, status, linked_task_id | Keeps raw voice input separate from committed task data until reviewed |
| 🟢 `sync_errors` | id, source, error, occurred_at, resolved | Supports FR-10 escalation traceability |

**Retention:** ❓ unresolved — the spec is internally inconsistent about whether history is permanently kept (official record) or deletable by the Principal (§6, §12). **Do not build automatic deletion until this is resolved** — default to retain indefinitely, matching the "official records" framing, until told otherwise.

**No student PII anywhere in this model** — this is a hard constraint carried through every table above. 🔵

---

## 11. Authentication, Permissions, Privacy, and Security

| Area | Requirement | Source |
|---|---|---|
| Who can log in | Principal (full use); Johan (setup/admin) | 🔵 §2 |
| Data residency | Local Supabase instance — not cloud-hosted multi-tenant | 🔵 §6 |
| Student data | None stored, none processed | 🔵 §6 |
| External communication | None automated, to anyone, ever, in this version | 🔵 §6, §8, §11 |
| Confidentiality | Timetable and alert protocols are confidential | 🔵 §6 |
| Multi-user / sync | Explicitly out of scope | 🔵 §11 |
| 🟢 Device auth | Recommend PIN/biometric lock on phone+desktop app, since the data is confidential and devices could be shared/lost | Proposed |
| 🟢 Transport security | Local API between desktop/phone and backend should still use TLS/local-network encryption, not plaintext | Proposed |
| 🟢 Admin scope limits | Johan's setup access should be scoped to timetable/categories/preferences configuration — not blanket access to the Principal's task content, consistent with "confidential" framing | Proposed |
| ❓ Voice data handling | Unresolved — on-device vs. cloud transcription has direct privacy implications | Carried from §12 |

---

## 12. Integrations and Technical Requirements

🔵 Proposed stack per spec (§7): Python backend, Supabase, PWA (phone + desktop), Web Push notifications. Treated as a *direction*, not a locked decision — see §14 for the architecture recommendation and justification.

Required integrations:
- **School timetable** — read access, unconfirmed approval (❓ §12). P2.
- **School portal** — read access, unconfirmed approval and unconfirmed technical surface (API? export file? unknown). P2.
- **Academic calendar** — same caveats. P2.
- **Voice transcription service** — on-device vs. cloud undecided (❓). P1 (blocks voice capture feature).
- **Web Push** — for desktop/phone notification delivery. P0/P1.

No integration should be built against a live school system until the open question "has the school approved this access" (§12) is answered — this is a compliance/authorization gate, not just a technical one.

---

## 13. Edge Cases, Risks, and Challenges

| Edge Case / Risk | Why it matters | Mitigation direction |
|---|---|---|
| Overlapping tasks | Spec explicitly requires no missed alert even when tasks overlap (§9) | Scheduler must handle concurrent due alerts, not assume one-at-a-time |
| Notification delivery failure (device offline, push service down) | Directly threatens the "zero missed reminders" goal | Retry policy (🔵 proposed) + desktop fallback display + delivered-status logging |
| Ambiguous voice transcription | Could silently create a wrong task | Route low-confidence parses to clarification (FR-10), never auto-commit |
| Principal ignores evening planning entirely one day | Tasks still need reminders | Define a fallback behavior (❓ not specified — needs a decision: carry forward automatically? flag as unplanned?) |
| Duplicate/near-duplicate tasks from repeated voice notes | Clutters task list, risks conflicting reminders | 🟢 proposed: surface a "similar task exists" check before committing a draft |
| History deletion requested before retention policy is settled | Could destroy "official records" irreversibly | Block deletion entirely until §17-Q3 is resolved |
| School timetable/portal sync conflicts with a manually scheduled task | Two sources of truth for the same time slot | 🟢 proposed: manual Principal edits always take precedence over synced data |
| Timezone/DST transitions affecting −60/−10 offset math | Silent miscalculation of alert times | Store all times with explicit timezone; test across a DST boundary |
| Johan (admin) misconfigures categories/preferences | Breaks the Principal's daily flow | 🟢 proposed: admin changes should be visible/reviewable by Principal, not silent |
| Scope creep into multi-user or auto-messaging | Spec explicitly excludes this (§11) | Treat §11 as a hard boundary in every phase review, not just phase 1 |

---

## 14. Recommended Technology Architecture, with Justification

No existing code or conventions exist in this project to preserve — this is a greenfield recommendation built on top of the spec's own proposed direction (§7), not a replacement of it.

**Recommended stack (🟢 justification added; base direction 🔵 from spec):**

- **Backend:** Python (e.g., FastAPI) — matches the spec's own proposal (§7); FastAPI specifically gives a lightweight REST API, async support (useful for the once-a-minute scheduler and push delivery), and is easy for a solo developer (Johan) to maintain.
- **Database:** Supabase (Postgres), run locally — matches §6/§7 directly; Postgres gives reliable transactional writes for the state machine + audit log (FR-9), and Supabase's built-in auth/row-level security can later enforce the Principal/Johan permission split (§11) without hand-rolling auth.
- **Scheduler:** a lightweight polling worker (e.g., APScheduler or a simple cron-style loop) checking due alerts every minute, as proposed in §5 — simple, inspectable, and easy for a non-specialist (Johan) to debug compared to a distributed task queue, which would be over-engineering for a single-user system.
- **Frontend:** a single installable PWA codebase serving both desktop and phone, per §7 — avoids maintaining separate native apps for a one-person user base; Web Push covers both notification channels from one implementation.
- **Notifications:** Web Push (phone + desktop) as proposed in §7, with the desktop app itself as the fallback display channel on repeated failure (🔵 proposed in §5).

**Why not alternatives:**
- A native mobile app (Swift/Kotlin) would double the maintenance surface for a single user — not justified here.
- A distributed task queue (Celery/Redis, etc.) is unnecessary complexity for one person's daily task volume; a once-a-minute poll against Postgres is sufficient and far easier to operate.
- A cloud-hosted multi-tenant database would conflict directly with the "local Supabase," confidentiality, and no-student-data-leaves-the-school requirements (§6).

**🟢 Proposed addition not in spec:** a minimal internal admin view (even a simple script or restricted page) for Johan to manage categories/preferences/timetable seeding, separate from the Principal's daily-use surfaces — avoids giving setup access through the same UI surface the Principal relies on for trust-sensitive daily use.

---

## 15. Development Phases and Implementation Roadmap

Base phase order is 🔵 from spec §10; sub-steps and dependency notes are 🟢 proposed detail.

| Phase | Scope (🔵 from spec) | Key dependencies | Gate |
|---|---|---|---|
| **Phase 1** | Database, task states, manual task entry, desktop task list | None — foundational | Principal tests manual task tracking end-to-end 🔵 |
| **Phase 2** | Stage-1/stage-2 reminders, phone notifications, alert log | Requires Phase 1's task store + state machine | Principal confirms reminders fire reliably on both channels 🔵 |
| **Phase 3** | Evening planning, voice capture, categories, weekly summary | Requires Phase 2's reminder engine (planning sets the alerts it relies on) | Principal runs a full evening-planning cycle for at least a week 🔵 |
| **Phase 4** | School timetable/portal sync, knowledge-base updates | Requires Phase 3 (planning must exist before external data feeds into it) **and** resolution of the school-system access approval question (❓ §12/§17) | Principal confirms synced data behaves correctly alongside manual entries 🔵 |

🟢 **Proposed sequencing notes:**
- Resolve the "phone, desktop, or both for v1" open question (§17-Q1) *before* Phase 2 — it directly changes Phase 2's scope.
- Resolve the voice transcription location question (§17-Q2) before starting the voice-capture slice of Phase 3.
- Resolve the history retention conflict (§17-Q3) before any deletion UI is built — it can be deferred past Phase 4 if needed, since retain-by-default is a safe interim behavior.
- Do not start Phase 4 integration work until school IT/leadership approval for timetable/portal access is confirmed (§17-Q4) — this is a go/no-go gate, not a technical task.

---

## 16. Testing and Quality Assurance Strategy

🟢 Proposed, grounded in the spec's own acceptance criteria (§9) and phase-gating philosophy (§10).

- **Unit tests** — task state machine transitions (every edge in §4), alert time calculation (−60/−10 and edge cases like midnight rollover/DST).
- **Scheduler simulation tests** — simulate the once-a-minute check against a controlled clock to verify no due alert is ever skipped, including overlapping-task scenarios (§9 requirement).
- **Delivery tests** — mock push/desktop delivery to verify retry-then-fallback behavior and sent/delivered logging.
- **Audit log tests** — verify every state transition produces exactly one history row with correct timestamp (FR-9).
- **Manual UAT per phase** — the spec already requires Principal to test and sign off each phase before the next begins (§10); treat this as the primary acceptance gate, not just a nice-to-have.
- **2-week live acceptance test** — directly per §9: track 100% on-time stage-1/stage-2 delivery, <60s delivery latency, zero missed alerts under overlapping tasks, ≤10-minute evening review time.
- **Privacy/security check** — explicit verification that no student data is stored (grep schema/data for PII fields) and that no outbound message to parents/staff is technically possible, before each phase sign-off.

---

## 17. Unresolved Questions and Assumptions

These are carried directly from the spec (§12) plus additional conflicts found during this analysis (§2.2). **None are answered here — they require your decision**, not an assumption, before the related feature is built.

| # | Question | Source | Blocks |
|---|---|---|---|
| Q1 | Should v1 be phone, desktop, or both? | 🔵 spec §12 (conflicts with §7's "both" assumption) | Phase 2 scope |
| Q2 | Should voice transcription happen on-device or via a cloud service? | 🔵 spec §12 | Phase 3 voice capture |
| Q3 | Should task history be permanent, or can it be deleted? (spec's own source material conflicts here) | 🔵 spec §6, §12 | History/audit retention design |
| Q4 | Which school systems can the assistant read, and has the school formally approved this? | 🔵 spec §12 | Phase 4 integration go/no-go |
| Q5 | Is food quality/wastage checking actually in scope? | 🔵 spec §3, §12 | Categories list, Phase 3 |
| Q6 | Will anyone besides the Principal use the assistant? | 🔵 spec §12 | Permissions model, multi-user scoping |
| Q7 | Does this share code/infrastructure with a "Birthday AI Agent" project, or is it fully separate? | 🔵 spec §12 | Architecture reuse decisions — **no such project was found on this machine during this review; cannot confirm either way** |
| Q8 | What exact time does the "evening planning" trigger each day — fixed clock time, or Principal-initiated? | 🟢 identified gap | Evening planning workflow (§7.1) design |
| Q9 | What happens if the Principal skips the evening planning session entirely for a day? | 🟢 identified gap | Fallback/overdue-carry-forward behavior |
| Q10 | Is alert-offset configurability (−60/−10 adjustable) a v1 requirement or a later idea? | 🔵 spec §5 marks this "(proposed)" ambiguously | FR-12 priority (currently placed at P2) |
| Q11 | What devices/OS does the Principal actually use (iOS/Android, Windows/Mac)? | 🟢 identified gap | PWA/Web Push feasibility confirmation |

**Working assumptions used in this document until answered (all 🟢, all reversible):**
- Both phone and desktop are being planned for, since §7's system design assumes both — but Q1 should be confirmed before Phase 2 work starts.
- History defaults to permanent retention (no deletion UI built) until Q3 is resolved.
- Food quality checks are listed as a candidate category but excluded from any committed roadmap item until Q5 is resolved.
- No assumption is made about Q7 — it is left fully open.

---

## 18. Brainstorming Ideas and Future Enhancements

All items in this section are 🟢 proposed by this planning pass — none are in the uploaded spec. They are explicitly **not** part of the P0–P2 roadmap above unless promoted later.

- **Weekly retrospective nudge:** at the weekly summary, surface a one-line pattern observation (e.g., "exam-duty tasks were rescheduled 3 times this week") to help the Principal notice friction points — purely observational, never prescriptive.
- **Category-level reminder tuning:** allow different alert offsets per category (e.g., exam duties might warrant earlier warnings than routine admin) — only after basic configurability (FR-12) is proven.
- **"Quiet hours" setting:** suppress or batch non-urgent reminders during known unavailable periods (e.g., in a meeting), surfaced on return — would need careful design so it never causes a missed on-time task.
- **Lightweight voice command shortcuts:** "snooze," "done," "move to tomorrow" as spoken commands during an active alert — convenience layer on top of existing snooze/delay/clear controls.
- **Trend dashboard for Johan:** read-only operational view (delivery latency, retry rates) to support the reliability goals in §9, separate from the Principal's own daily-use views.
- **Export/backup of task history:** a manual, Principal-approved export for her own records — consistent with "deleting history is a manual, approved step" (§6) by extension.

None of these should be scheduled into a phase until the P0/P1 roadmap in §15 is delivered and validated.

---

## 19. Acceptance Criteria for Major Features

| Feature | Acceptance Criteria | Source |
|---|---|---|
| Stage-1/Stage-2 reminders | 100% delivered on time over a 2-week trial; arrive within 60s of scheduled time, on both phone and desktop | 🔵 §9 |
| Overlapping task handling | No missed alert when two or more tasks' windows overlap | 🔵 §9 |
| Evening planning session | Principal can complete review (approve/edit) in ≤10 minutes | 🔵 §9 |
| Data containment | Zero student data present anywhere in the system; zero automated outbound messages to anyone outside Principal's own devices | 🔵 §9, §6 |
| Task state integrity | Every state transition has exactly one corresponding history row with a timestamp; no transition occurs without a logged cause | 🔵 §4 |
| Manual completion | No task can reach "Completed/Achieved" without an explicit Principal action | 🔵 §3, §8 |
| Alert reliability | Failed sends retry up to 3 times, then visibly surface on desktop; every attempt's sent/delivered status is logged | 🔵 §5 |
| Phase sign-off (any phase) | Principal personally tests the phase's scope and approves before the next phase begins | 🔵 §10 |

---

## 20. Final Recommendations and Next Steps

**Recommendations:**
1. Resolve the seven spec-native open questions (§17, Q1–Q7) before locking Phase 2–4 scope — several of them (Q1, Q4) change what "done" even means for those phases.
2. Treat the internal conflicts found in §2.2 (history retention, food-quality scope, API-assumes-both-platforms) as decisions needed from you, not gaps to fill by inference.
3. Build in the phase order already specified (§10/§15) — it is sound: foundation → reminders → planning/voice → external sync — and keep the Principal's hands-on test as the real gate at each step, not just a formality.
4. Treat Phase 4 (school system integration) as conditional on formal school approval (Q4), not merely a technical milestone — recommend getting that approval process started early, in parallel with Phases 1–3, since it is likely the slowest-moving dependency.
5. Before any UI implementation, do a short, focused wireframe/mockup pass (§9) — none exist yet, and the trust-sensitive "proposal vs. approved" distinction (§8.3) is easier to get right visually than to retrofit.

**Next steps (no implementation yet, per your instruction):**
1. Review this document and the unresolved-questions register (§17) with Uma Maheshwari and Johan.
2. Get explicit answers to Q1–Q7 at minimum (Q8–Q11 can be deferred but should not be forgotten).
3. Once answered, this document can be updated and used directly as the input to a formal implementation plan (e.g., via a `writing-plans`-style process) for Phase 1.
4. No code, dependencies, or scaffolding should be created until you've reviewed and approved this plan.
