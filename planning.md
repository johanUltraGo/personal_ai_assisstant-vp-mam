# Vice Principal AI — Planning Document

**Status:** Draft for review — brainstorming and planning only, no implementation yet.
**Source material analysed:** `Vice Principal AI Assistant Spec (Principal Version).txt`, dated 30 October 2026. This is the only uploaded reference file in the project directory at the time of writing.
**Note on prior work:** an earlier `planning.md` and a Phase 1 implementation plan existed in this repo (commit `2243b33`, 29 Oct 2026), based on an older, now-superseded spec file (`Vice Principal AI Assistant Specs.txt`, 23 Oct 2026, sourced from a "10 Layer Design Workbook"). That source file is no longer present in the project, and the new spec differs substantially — different reminder model, added voice/Tamil-English requirements, added messaging/connector scope, added power-button/platform constraints, and an explicit Claude-based reasoning requirement. This document replaces the old planning.md on the strength of the new spec; it does not assume anything from the old draft that isn't also stated or implied here.
**Legend used throughout:** 🔵 = stated in the uploaded spec · 🟢 = proposed addition/analysis by this planning pass (not in the spec) · ❓ = unresolved — either carried from the spec's own open-questions list or newly identified during this analysis.

---

## Implementation Status (updated 30 Oct 2026 — after building the Phase 1–4 foundation)

Code now exists in `server/` (Node.js + TypeScript + Express + Prisma, SQLite for local dev). Full details, test results, and blockers are in the implementation final report delivered alongside this update; the summary below exists so this document stays the accurate source of truth for what's actually built versus still planned.

| Phase | Status | What's real and tested | What's blocked, and by what |
|---|---|---|---|
| 1 — Foundation | **Built & tested** | Task state machine, timestamped history, manual task entry, carry-forward of unfinished tasks, 9:00 AM morning list generation + on-demand fetch, minimal working web UI. | Native Android client not built (not needed until Phase 4's power-button goal). |
| 2 — Reminders | **Built & tested** | On-demand reminders (incl. up to a week ahead), per-minute due-check, retry-up-to-3-then-surface-as-failed, sent/delivered logging, snooze/delay/reschedule, repeat (daily/weekly). | Real phone push (Firebase Cloud Messaging) not wired — reminders currently "deliver" via a console notifier standing in for it; no Firebase project/credentials exist yet. |
| 3 — Voice/Tamil-English/messaging | **Partially built & tested** | Claude tool-calling task parser (code-complete, unit-tested with a mocked client); plug-in connector interface; Gmail/Drive connector logic and the read-then-summarize ordering (unit-tested against mocked clients); send-by-name contact resolution with disambiguation; the single "Send?" confirm-before-send flow with a permanent audit log. | **Live Claude calls** need `ANTHROPIC_API_KEY` (not set). **Live Gmail/Drive** need Google OAuth client credentials + per-account consent (not available). **Voice capture and Tamil-English STT** not attempted — no STT vendor evaluated yet (planning.md §11.2 #12). **WhatsApp** not implemented at all — no compliant sending path confirmed (§11.2 #14). |
| 4 — School integration & launch | **Partially built & tested** | CalendarEvent model and the exact "two days before, ask, send-only-on-yes" decision logic (unit-tested) — operates on manually-seeded events, reusing the same confirm-send audit path as Phase 3. | **Drive calendar sync** blocked (same Google OAuth gap as above). **Innovate School / Sola connectors**: not started — neither app's API/export surface has been confirmed to exist at all (§11.2 #10). **Leave letters, teacher/student leave messaging**: the send mechanics exist (messagingService) but actually drafting these is not built, and sending them is blocked by the same Gmail/WhatsApp gaps. **Power-button/native Android launch**: not attempted — needs a native Android project and her physical device, neither available in this environment (§11.2 #15). |

The step-by-step roadmap in §12 below is unchanged as a plan, but steps 5–8 ("Build Phase N... she tests it") now have real, running code behind them for everything not listed as blocked above — her testing pass is the next step for those parts, not further planning.

---

## 1. Project Overview and Objectives

Vice Principal AI is a voice-first personal assistant for one person — Vice Principal Uma Maheshwari — built to remove the daily load of planning her day and remembering what she needs done. 🔵

The core loop is a daily rhythm, not a to-do list she has to open and manage herself: each evening she talks through the day with the assistant and plans tomorrow in time windows (not fixed clock times, since her hours vary); each morning at 9:00 AM the assistant pushes her the full work list it built from that conversation, and she confirms or adjusts it in one reply. 🔵 Reminders exist only when she explicitly asks for one, at a time she sets — there is no automatic reminder for every task. 🔵

**Objectives, as stated in the spec (§1):**
- She is reminded of every task she asks to be reminded of. 🔵
- She sees her full work list every morning without having to ask. 🔵
- Less time goes into planning and remembering. 🔵

**Framing for this plan (🟢):** this is a single-executive productivity and communications assistant, not a school-wide administrative system. It is explicitly scoped to her use, with later phases adding the ability — always under her explicit instruction and confirmation — to reach school stakeholders (parents' group, teachers' group, named students) through email and (pending confirmation) WhatsApp. It is not a records system, does not auto-contact anyone, and does not yet have confirmed multi-user support (❓ spec §14).

---

## 2. Complete Feature List

Grouped by the spec's own sections, each tagged with its implementation phase per §12.

### 2.1 Daily planning loop (Phase 1 / Phase 3)
- Evening planning conversation (~30 min): assistant discusses today and plans tomorrow with her; converts the conversation into a schedule of time windows + tasks; she edits before saving. 🔵 (Phase 3 for the voice/conversational version; Phase 1 covers manual task entry as the non-conversational precursor.)
- Morning work list (9:00 AM, daily): full list for the day built from the prior evening's time windows, pushed to her automatically; she confirms or changes it in one reply. 🔵 (Phase 1)
- Unfinished tasks automatically carry over into the next day's plan. 🔵 (Phase 1/2)

### 2.2 Task and reminder management (Phase 1 / Phase 2)
- Manual task entry, with category and time window. 🔵 (Phase 1)
- Task state machine: drafted → scheduled → reminder sent → in progress → completed → overdue, each transition timestamped. 🔵 (Phase 1)
- She — never the assistant — marks a task completed. 🔵 (Phase 1)
- On-demand reminders: fire only when she asks, at a time she gives, including up to a week ahead. 🔵 (Phase 2)
- Due-reminder check every minute. 🔵 (Phase 2)
- Each reminder fires once; repeats only if she explicitly sets them. 🔵 (Phase 2)
- Failed sends retry up to 3 times, then surface in the app. 🔵 (Phase 2)
- Reminder log: sent/delivered status per reminder. 🔵 (Phase 2)
- Snooze, delay, and reschedule actions, each logged. 🔵 (Phase 2)
- Phone notifications for reminders. 🔵 (Phase 2)

### 2.3 Voice, language, and input (Phase 3)
- Voice-first interaction, screen secondary (shows morning list + confirmations). 🔵
- Automatic Tamil/English detection, including mixed-language sentences, with no manual language switch required. 🔵
- Typing as an alternative input (tap to type). 🔵
- Attachments from phone storage or Google Drive (file, photo, document). 🔵
- Photo upload flow: tap "+", select one or more photos, tap the tick, photos attach immediately to the chosen task or document. 🔵
- Launch by button press or a user-chosen wake word; Siri-style visual "listening" effect on activation. 🔵

### 2.4 Messaging and documents (Phase 3 / Phase 4)
- Send-by-name contact resolution; if multiple contacts match, the assistant asks which one. 🔵 (Phase 3)
- Exactly one confirmation ("Send?") before any message leaves — no other confirmation step. 🔵 (Phase 3)
- Gmail sending, multiple accounts. 🔵 (Phase 3)
- WhatsApp sending — **desired, not confirmed feasible.** 🔵 Must be verified (legal/technical path) before it is built or promised. (❓, see §11 Risks)
- Drive document handling: assistant reads the whole file, summarizes its contents to her, then sends whatever message she dictates to the named recipient. 🔵 (Phase 3)
- Leave letters: drafted and sent on her instruction. 🔵 (Phase 4, since it depends on calendar/holiday awareness and group messaging)

### 2.5 School calendar and stakeholder alerts (Phase 4)
- School calendar read from a file in the school's Google Drive; checked on every run. 🔵
- Upcoming-event prompts: two days before a calendar event (e.g., Diwali), the assistant asks "Shall I send a notification to the parents' group?" — sends only on her yes. 🔵
- Weekends and calendar holidays are factored into leave planning. 🔵
- Document summaries/corrections sent to the parents' group on her request. 🔵
- Teacher leave: assistant drafts the letter and sends it to the teachers' WhatsApp group on her instruction. 🔵 (depends on WhatsApp feasibility, ❓)
- Student leave: for one or two named students, assistant sends the notice on her instruction. 🔵

### 2.6 Connectors and school apps (Phase 4, with Gmail/Drive pulled forward to Phase 3)
- Gmail — multiple accounts, full access. 🔵 (Phase 3)
- Google Drive — multiple accounts, full access, including the school Drive. 🔵 (Phase 3)
- Innovate School app connector — required from the first prototype onward per her instruction, to track updates and payments. 🔵 (Phase 4; "from the first prototype" conflicts with the phase ordering in §12 — see §11 Risks)
- Sola app connector — same treatment as Innovate School. 🔵 (Phase 4, same caveat)
- Google Calendar — read access; to be confirmed whether this is in addition to the school Drive calendar file. 🔵 ❓ (Phase 4)
- All-day monitoring of school apps (who has paid, what's updated, who uploaded what), active 9:00 AM–6:00 PM. 🔵 (Phase 4)
- Plug-in connector architecture so new services can be added without rewriting the core. 🔵 (architectural requirement, applies from Phase 1 onward)

### 2.7 Platform and launch (Phase 4)
- Power-button (or system-shortcut) launch, like a phone's built-in assistant. 🔵 — requires investigation; not guaranteed possible (❓, see §11 Risks).
- Phone-first; desktop explicitly out of scope for now. 🔵

### 2.8 Explainability (cross-cutting, from Phase 1 onward)
- The assistant must be able to explain what it is doing and what each part of the system does, whenever she asks. 🔵

---

## 3. User Workflows and System Behaviour

### 3.1 Evening planning session 🔵
1. At a time of her choosing (~30 minutes), she talks with the assistant about today.
2. She and the assistant discuss tomorrow; the assistant proposes time windows and tasks from the conversation.
3. She edits the proposal — add, remove, re-time, re-categorize.
4. She saves it. This becomes the source for tomorrow's 9:00 AM list.

### 3.2 Morning work list 🔵
1. At 9:00 AM daily, the assistant sends her the day's full work list, built from last night's saved plan plus any tasks carried over from yesterday as unfinished.
2. She replies once: confirm as-is, or request changes.
3. The assistant applies her changes and the day's plan is locked in for tracking purposes (task states begin moving from scheduled → in progress as the day proceeds).

### 3.3 On-demand reminder 🔵
1. At any time, she asks for a reminder on a task or an arbitrary note, giving a specific time (which may be up to a week out).
2. The assistant schedules it; no reminder exists unless she asked for it.
3. A background check runs every minute for due reminders.
4. At the due time, the reminder fires once (phone notification). If delivery fails, it retries up to 3 times, then shows as failed in the app for her attention.
5. She can snooze, delay, or reschedule the reminder; each action is timestamped and logged.

### 3.4 Task capture (typed or voice) 🔵
1. She speaks or types a task description, in Tamil, English, or a mix of both, at any time (not only during the evening session).
2. The assistant parses it into a structured task (what, category, time window) and, if anything is ambiguous, asks rather than guessing (🟢 inferred from the "one confirmation only" messaging principle and the general human-in-the-loop posture of the spec — not explicitly stated for task capture, flagged as a design assumption, not a confirmed requirement).
3. The task enters the **drafted** state, later becoming **scheduled** once it has a confirmed time window.

### 3.5 Send a message by name 🔵
1. She says or types a contact's name and her message (or dictates it after the assistant reads a Drive document aloud/summarized to her).
2. The assistant resolves the name to an address; if several contacts match, it asks which one.
3. The assistant shows the composed message exactly once and asks "Send?" — this is the only confirmation step.
4. On her yes, it sends (Gmail now; WhatsApp pending feasibility confirmation).

### 3.6 Calendar-driven stakeholder notification 🔵
1. On every run, the assistant checks the school calendar file in Drive.
2. Two days before any listed event, it proactively asks her: "This event is coming up. Shall I send a notification to the parents' group?"
3. Only on her yes does it draft and send the notification.

### 3.7 Teacher / student leave 🔵
1. **Teacher leave:** she instructs the assistant; it drafts a leave letter and sends it to the teachers' WhatsApp group (pending WhatsApp feasibility).
2. **Student leave:** she names one or two students; the assistant sends the notice on her instruction (exact channel/recipient for student notices is not specified in the spec — ❓).

### 3.8 Photo/document attachment 🔵
1. She taps "+", selects one or more photos (from phone or Drive), taps the tick.
2. The photos attach immediately to whichever task or document she had open/selected.

### 3.9 Explain-yourself request 🔵
1. At any point, she can ask the assistant what it is doing, or what any part of the system does.
2. The assistant answers in plain language, tied to the actual current state/action (🟢 — the spec requires this capability but does not specify depth or format; treated as an always-available, on-demand explanation, not a persistent log view).

---

## 4. Proposed Architecture and Technology Stack

🟢 Everything in this section is a proposal for discussion — the spec confirms the reasoning engine (Claude) and the datastore (Supabase) only; it does not mandate any other part of the stack.

### 4.1 High-level shape
- **Client:** Android app (native). A web app or PWA cannot register as the phone's default assistant or intercept the power button (🔵 spec §8 states this directly: "A web app cannot do this"), so native Android is a hard constraint from the moment power-button launch is pursued (Phase 4) — not from day one. Phases 1–3 could in principle be delivered via a simpler client (even a basic mobile-web or Flutter shell) since they don't need OS-level assistant registration, but building on native Android from the start avoids a platform rewrite before Phase 4. 🟢 Recommendation: start native Android (Kotlin) from Phase 1, even though Phase 1's own feature set doesn't strictly require it, specifically to avoid rebuilding the client when Phase 4 arrives.
- **Backend/orchestration layer:** a service that owns the task/reminder scheduler (minute-granularity due-check), the plug-in connector registry, and the calls out to Claude for anything requiring reasoning (parsing voice/text into tasks, building the evening plan, summarizing a Drive document, drafting a leave letter, resolving an ambiguous contact, deciding what the assistant's self-explanation says). This can run as Supabase Edge Functions plus a scheduled job (Supabase supports `pg_cron`-style scheduling and scheduled Edge Functions at minute granularity, which matches the spec's "check every minute" requirement) or as a small always-on worker service if finer control over retries/connector polling is needed. 🟢 ❓ — the right split between "runs in Supabase" and "runs in a separate always-on service" is an implementation decision to make once Phase 1 is scoped in detail, not now.
- **AI reasoning:** Anthropic Claude models, used via the Claude API with tool-calling/function-calling so the model's actions (create task, schedule reminder, draft message, summarize document, answer "what are you doing") are explicit, auditable function calls rather than free-form text side effects. 🔵 (model choice mandated) 🟢 (tool-calling architecture is this plan's proposal for meeting the explainability requirement in §2.8 — every action the assistant takes should trace back to a named tool call that can be shown to her on request.)
- **Speech-to-text:** not yet chosen. Needs an engine that handles Tamil-English code-switching within a single utterance, which is a materially harder requirement than "supports Tamil" and "supports English" as separate settings. This must be evaluated against real sample audio from her before being locked in (see §11 Risks). 🟢 ❓
- **Push notifications:** Firebase Cloud Messaging is the standard mechanism for Android phone notifications and fits the Phase 2 requirement. 🟢
- **Connector plug-in framework:** a common interface (e.g., `authenticate()`, `fetch()`, `send()`, `health()`) that each integration (Gmail, Drive, Google Calendar, Innovate School, Sola, and anything added later) implements, so the core scheduler/orchestrator never has service-specific code in it. 🔵 (plug-in requirement is explicit in the spec) 🟢 (this specific interface shape is a proposal)

### 4.2 Why this shape, and what's deliberately not decided yet
- The backend language/framework (Python, Node, Deno/Supabase Edge Functions, etc.) is left open — it should be picked once Phase 1's exact scope is finalized, not pre-committed here.
- No desktop component is planned, matching the explicit out-of-scope item. 🔵
- No decision is made yet on whether voice transcription happens on-device or in the cloud — this is an explicit open question in the spec itself (§14) with real privacy and latency implications, and it affects the STT engine choice above. 🔵 ❓

---

## 5. Database Planning

🟢 Proposed schema sketch for Supabase (Postgres). This is a planning-stage sketch, not a final schema — field types and constraints should be finalized when Phase 1 implementation starts.

| Table | Purpose | Key fields (sketch) |
|---|---|---|
| `tasks` | Core task record | id, title, description, category, time_window_start, time_window_end, status (drafted/scheduled/reminder_sent/in_progress/completed/overdue), source (voice/typed), created_at, updated_at |
| `task_history` | Timestamped state-transition audit trail 🔵 (explicit requirement) | id, task_id, from_state, to_state, changed_at, changed_by |
| `reminders` | Standalone or task-linked reminders | id, task_id (nullable — she can remind herself of something that isn't a task), fire_at, status (pending/sent/delivered/failed), retry_count, repeat_rule (nullable) |
| `reminder_log` | Sent/delivered status + snooze/delay/reschedule actions 🔵 | id, reminder_id, event_type, event_at, details |
| `evening_plans` | Saved result of each evening planning session | id, plan_date, raw_conversation_ref, approved_at |
| `contacts` | Cache for send-by-name resolution | id, display_name, email, whatsapp_number (nullable), source |
| `messages_sent` | Audit of every message actually sent (email/WhatsApp) | id, channel, recipient, body, confirmed_at, status |
| `calendar_events` | Synced from the school Drive calendar file | id, event_name, event_date, type (holiday/event), notified_at (nullable) |
| `connectors` | Plug-in registry/health | id, type, account_label, auth_ref, status, last_checked_at |
| `school_app_snapshots` | Polled Innovate School / Sola data (payments, updates, uploads) | id, connector_id, snapshot_at, payload — **pending confirmation that these apps expose any readable interface at all (❓, §11)** |
| `attachments` | Files/photos attached to tasks or messages | id, parent_type, parent_id, drive_file_id (nullable), storage_path (nullable), uploaded_at |

**Hosting location:** explicitly marked "to be confirmed before the build" in the spec. 🔵 ❓ 🟢 Recommendation: confirm a Supabase project region before any data is written, since migrating a live project between regions later is disruptive; a region close to her (lower latency for voice interactions) and consistent with any school data-handling expectations should both factor into that choice.

**Student data constraint:** the spec states the assistant does not hold student personal data. 🔵 This directly affects the `school_app_snapshots` design — payment/update tracking from Innovate School and Sola will very likely surface student-linked information (a payment record is naturally tied to a student). This is a real tension between "track who has paid" (§7) and "no student personal data" (§11) that the schema cannot resolve on its own — flagged in §11 Risks as a decision she needs to make (e.g., store only aggregate counts/status flags, not per-student identifying detail, unless she and the school explicitly approve storing named student data for this purpose).

---

## 6. AI, Voice, Tamil-English, and Messaging Requirements

- **Reasoning engine:** Claude models (Anthropic), mandated. 🔵 Proposed use via tool-calling so every autonomous action is a discrete, nameable function call — this both implements the explainability requirement (§2.8) and gives a natural audit boundary (every tool call can be logged to `task_history`/`reminder_log`/`messages_sent`).
- **Language handling:** automatic Tamil/English detection, including mid-sentence code-switching, with no manual language toggle. 🔵 This is a genuinely hard requirement — most commercial STT and NLU systems are tuned for either monolingual input or a pre-declared bilingual mode, not silent code-switch detection within one utterance. 🟢 This needs a dedicated evaluation spike against her actual speech before any STT vendor is chosen (see §11 Risks) — it should not be assumed solved by picking "a Tamil-capable engine."
- **Voice-first interaction:** voice is the primary modality; screen is secondary, used for the morning list and confirmations. 🔵 Typing is a supported fallback. 🔵
- **Wake word:** user-chosen; triggers a Siri-style visual listening indicator. 🔵 🟢 Custom wake-word detection on Android typically needs a dedicated on-device wake-word engine (the OS-level wake words are reserved for the phone's built-in assistant) — this is a build detail to resolve during Phase 4 planning, not blocking for earlier phases since button-press launch can ship first.
- **Messaging:** a single, uniform confirmation pattern ("Send?") across every outbound channel, with contact resolution by name (and disambiguation when multiple matches exist) handled before that confirmation is shown. 🔵 This same pattern should extend to Gmail, WhatsApp (once/if confirmed), and group messages (parents'/teachers' groups) so she only ever sees one shape of confirmation regardless of channel. 🟢
- **Document-aware messaging:** when a Drive document is involved, the assistant reads the entire file and summarizes it to her before she dictates what to send — the send step is entirely separate from and after the read/summarize step. 🔵
- **WhatsApp — not yet a confirmed capability.** 🔵 See §11 Risks for the specific technical/legal paths and why none can be assumed without a deliberate decision.

---

## 7. Gmail, Google Drive, School Apps, Calendar, and Android Integration Considerations

- **Gmail:** multiple accounts, full access, confirmed requirement. 🔵 Standard OAuth 2.0 user-consent flow per account; store/refresh tokens securely.
- **Google Drive:** multiple accounts, full access, including the school Drive, confirmed requirement. 🔵 Same OAuth model as Gmail; the school Drive account/permissions need to be confirmed as something she (or the school) can actually grant access to for this purpose — not just a technical API question but a permissions question (see §8).
- **Google Calendar:** read access, explicitly marked "to be confirmed" in the spec. 🔵 ❓ Also unclear whether this is the same thing as "the school calendar is a file in the school's Drive" (§6 of the spec) or a separate, personal Google Calendar — these are two different data sources with different access models and should not be assumed to be the same integration.
- **Innovate School app / Sola app:** both required, and required "from the first prototype" per her instruction (§7 of the spec), even though the phase plan (§12) places school-app connectors in Phase 4. 🔵 This is an internal tension in the spec worth surfacing to her directly (see §11 Risks) rather than silently resolving it either way. More fundamentally: **it is not yet established that either app exposes any API, export, or webhook an outside assistant could read from at all.** 🟢 ❓ Nothing about these two connectors should be assumed buildable until that is checked — if neither offers a programmatic interface, the "track payments/updates/uploads" requirement (§7) may need a different approach entirely (e.g., manual/periodic export, or a scoped integration request to the app vendors).
- **Power-button / default-assistant launch on Android:** Android has a real mechanism for this — an app can declare itself as a candidate "default digital assistant app," which the user then selects in system settings — but it is gated by the OS and often further restricted or re-skinned by phone manufacturers (e.g., some OEMs bind their hardware assistant key to their own assistant and don't allow override). 🟢 Whether her specific phone model and Android version permit this is unverified and must be checked on her actual device, not assumed. The spec itself flags this as open ("check whether her phone supports this"). 🔵 ❓
- **Gemini side panel:** the spec asks whether Gemini's side panel could do the same job. 🔵 ❓ 🟢 This is a Google first-party system surface; there is no general mechanism for a third-party assistant to extend or replace it, so this should be treated as "almost certainly not viable as an integration point" unless something specific is found that says otherwise — it is listed here as unverified, not as a live option to design around.
- **Alert polling window:** connectors are checked all day, with alerts running 9:00 AM–6:00 PM. 🔵 This implies a scheduled polling job per connector type, each independently configurable (some connectors may need more/less frequent polling than others, e.g., Gmail/Drive vs. a school app).

---

## 8. Security, Privacy, and Permissions

- **No student personal data held**, and **nothing is sent to parents or staff automatically** — every outbound message needs her explicit confirmation. 🔵 This is the single most load-bearing privacy rule in the whole system and should be enforced structurally (e.g., every send path requires a logged confirmation record), not just by convention.
- **Confidentiality:** the timetable and alert protocols are explicitly confidential. 🔵 Access to these within the system should be restricted accordingly (e.g., not surfaced through any shared/debug views, not included verbatim in logs beyond what's needed for the audit trail).
- **Task history / audit retention — unresolved internal conflict.** 🔵 ❓ The spec states official records are kept, that deleting history needs her approval, and separately notes the source material contains both "keep official records" and "delete audit log" as instructions needing reconciliation. This needs a direct decision from her before the history/audit schema is finalized, since "permanent official record" and "deletable audit log" imply different retention and access-control designs.
- **Voice note transcription location (device vs. cloud) — unresolved.** 🔵 ❓ This is a privacy-relevant decision (cloud transcription means raw voice audio leaves her device) as well as a technical one (affects which STT engines are even candidates, per §6).
- **Credential storage:** Gmail/Drive OAuth tokens (multiple accounts each), and whatever auth Innovate School/Sola turn out to require, need secure storage (encrypted at rest) and a clear refresh/revocation path — "full access" as stated in the spec (§7) is a broad grant that increases the blast radius of any credential leak, so secure storage matters more here, not less. 🟢
- **Hosting location:** Supabase hosting region is explicitly unconfirmed and should be settled before any real data is written. 🔵 ❓
- **Her approval gates:** every message send (one confirmation, no exceptions elsewhere), and every history deletion. 🔵 These two approval gates are the only ones the spec defines — the system should not invent additional confirmation steps beyond what's specified, since the spec explicitly says "no other confirmations are asked" for messaging. 🔵
- **Setup/admin access:** Johan sets up connectors, categories, and preferences — his role has broader configuration access than her day-to-day usage needs, and that access boundary should be designed deliberately (e.g., a separate admin surface) rather than left implicit. 🟢

---

## 9. Implementation Phases and Dependencies

The four phases are specified directly in the spec (§12); this section adds the technical dependencies between them and flags where the stated phase boundaries are in tension with other requirements.

**Phase 1 — Foundation** 🔵
- Database (Supabase), task state machine, manual task entry, morning work list delivery at 9:00 AM.
- Dependencies: none external — this is the base the rest of the system is built on.
- 🟢 Recommended addition: even though not required until Phase 4, starting the client as a native Android app now (rather than a web/PWA shell) avoids a platform rewrite later, since Phase 4's power-button goal is only reachable natively.

**Phase 2 — Reminders** 🔵
- On-demand reminders, phone notifications, reminder log (sent/delivered, retries, snooze/delay/reschedule).
- Dependencies: Phase 1's task/state infrastructure; Firebase Cloud Messaging (or equivalent) for phone push.

**Phase 3 — Voice and messaging** 🔵
- Evening planning conversation, voice capture, Tamil/English handling, Gmail and Drive connectors, messaging with the "Send?" step.
- Dependencies: Phase 1 (tasks to plan around) and Phase 2 (the reminder infrastructure the evening plan feeds into); a resolved STT approach (device vs. cloud, and verified Tamil-English code-switch handling — both currently open); Google OAuth setup for Gmail/Drive.
- 🟢 Note: Gmail/Drive "full access" to multiple accounts, including the school Drive, needs the relevant account owners (her, and whoever administers the school Drive) to actually grant that access — this is a permissions/organizational step, not just an engineering one, and should be sequenced before this phase's connector work starts.

**Phase 4 — School integration and launch** 🔵
- School calendar, Innovate School and Sola connectors, parent/teacher group messaging, leave letters, power-button launch.
- Dependencies: Phase 3's messaging/confirmation pattern (reused for calendar alerts and leave letters); WhatsApp feasibility decision (blocks teacher-leave-letter delivery and parent/teacher group messaging as currently described, since both are specified as going to WhatsApp groups); confirmed Innovate School/Sola interface (or an alternative data-access approach if neither has one); Android power-button/default-assistant feasibility check on her actual device.
- 🟢 **Flagged tension:** §7 of the spec says Innovate School and Sola "should be connected from the first prototype," which is Phase 1, while §12 places those connectors in Phase 4. This plan does not resolve that silently — it is listed as a question for her in §11, since resolving it either way changes Phase 1's scope materially.

**Cross-cutting, not tied to a single phase:**
- Plug-in connector architecture 🔵 — should exist from Phase 1 even if only Gmail/Drive-style connectors are built early, so later connectors (Innovate School, Sola, anything else) don't require core rework.
- Explainability ("what are you doing") 🔵 — should be designed in from Phase 1, since retrofitting an audit/explanation layer onto an already-built system is harder than building it in from the start.

**Each phase ends only when she has tested it.** 🔵 This is an explicit, non-negotiable gate in the spec — no phase should be considered complete, nor should the next phase begin in earnest, without her sign-off.

---

## 10. Testing Strategy and Success Criteria

The spec itself defines the testing gate (her own testing, phase by phase) 🔵 and the top-level success measures (§1) 🔵. This section proposes concrete, phase-level acceptance checks against those.

| Phase | Proposed acceptance check (🟢) | Tied to success criterion |
|---|---|---|
| 1 | Over a multi-day trial, the 9:00 AM list arrives every day, unprompted, and accurately reflects manually entered tasks and correct carry-over of unfinished ones; task state transitions are all timestamped. | "Full work list every morning without asking" 🔵 |
| 2 | Reminders set at arbitrary times (including a week out) fire exactly once, at the right time, with correct sent/delivered logging; a simulated delivery failure retries 3 times then surfaces in-app; snooze/delay/reschedule all log correctly. | "Reminded of every task she asks to be reminded of" 🔵 |
| 3 | Real evening planning sessions in natural mixed Tamil-English speech produce an accurate schedule; Gmail sends (including Drive-document-informed ones) always show the single "Send?" confirmation and never send without it; ambiguous contact names are correctly disambiguated. | "Less time into planning and remembering" 🔵 + messaging trust |
| 4 | A real upcoming calendar event correctly triggers the two-days-before prompt; a leave letter is correctly drafted and only sent on her go-ahead; Innovate School/Sola data in the app matches what's actually in those apps; power-button launch is confirmed working (or confirmed not possible) on her real device. | Full feature completeness per §12 |

**Overall success measures (🔵, from the spec, carried through every phase):**
- Zero reminders missed that she actually asked for.
- The morning list appears daily without her having to request it.
- A subjective but trackable reduction in time she spends planning/remembering (🟢 — proposed as a simple before/after self-report at the end of Phase 3 or 4, since the spec doesn't define a specific metric for this).

---

## 11. Risks, Limitations, and Unresolved Questions

### 11.1 Carried directly from the spec's own open-questions list (§14) 🔵
1. Voice notes: transcribed on-device or in the cloud?
2. Is task history permanent, or can it be deleted (and under what approval)?
3. Which school systems can the assistant actually read, and has the school approved it?
4. Is food-quality/wastage checking in scope?
5. Will anyone besides the Vice Principal use the system?
6. Does this share code with the "Birthday AI Agent" project (unknown to this analysis — no information about that project exists in this repo)?
7. Can the power button or a system shortcut actually open this app on her phone? Can Gemini's side panel do the same job?
8. Should Google Calendar access be read-only?
9. Can WhatsApp sending be done legally and reliably?

### 11.2 Additional risks and tensions identified in this analysis (🟢)
10. **Innovate School / Sola feasibility is completely unverified.** Neither app is confirmed to expose any API, export, or webhook. Until checked, there is no way to know if the "track payments/updates/uploads" requirement is buildable as described at all, or needs a fundamentally different approach (manual export, a vendor integration request, etc.). This should be checked before Phase 4 is planned in technical detail.
11. **"From the first prototype" vs. Phase 4 placement.** §7 says Innovate School/Sola should be connected starting with the first prototype; §12 places those connectors in Phase 4. These two statements conflict and should be resolved with her directly rather than guessed at — it changes what Phase 1 actually needs to include.
12. **Tamil-English code-switch recognition is a harder problem than "Tamil support."** Detecting and correctly transcribing a language switch mid-sentence, with no explicit signal from her, is a real technical risk that should be spiked/tested against her actual speech before any STT vendor or on-device/cloud decision is finalized.
13. **"No student personal data" vs. "see who has paid" is in tension.** Payment and update tracking from Innovate School/Sola will likely be inherently student-linked data. The system cannot satisfy both "track who has paid" and "hold no student personal data" without a specific design decision (e.g., aggregate-only status, explicit scoped approval for named data, or excluding student-identifying fields from whatever is stored/shown).
14. **WhatsApp automation carries real legal/technical risk if done unofficially.** There is no general, officially-sanctioned way for a third-party assistant to send messages from a personal WhatsApp account; the only compliant path is the WhatsApp Business Platform (via an approved provider, with its own costs, templates, and opt-in rules), and anything else (e.g., automating WhatsApp Web) risks violating WhatsApp's Terms of Service and the account being banned. This must be explicitly decided, not defaulted into, before any teacher/parent group messaging work in Phase 4 depends on it.
15. **Power-button/default-assistant registration is phone- and OEM-dependent.** Android provides a real mechanism (declaring the app as a default digital assistant candidate), but manufacturers frequently restrict or re-bind hardware assistant keys to their own assistant. This must be verified on her actual device model before being promised as a deliverable.
16. **Gemini's side panel is not a viable integration point for a third-party assistant** under any mechanism currently known — this question in the spec should be treated as very likely "no" pending any specific finding otherwise, not left open as if it were a live design option.
17. **Google Calendar vs. school calendar Drive file — possibly two different data sources being conflated.** The spec references "the school calendar" as a Drive file (§6) and separately lists "Calendar: read access, to be confirmed" as a connector (§7). These may be the same thing described twice, or two genuinely different calendars (e.g., a personal Google Calendar alongside the school's Drive-based one). This should be clarified before calendar integration work starts.
18. **Data residency/hosting location is unresolved** and should be settled before any real (even test) data is written to Supabase, since migrating a live project's region later is disruptive.
19. **Johan's admin/setup access boundary is implicit, not designed.** The spec gives him responsibility for connectors, categories, and preferences, but doesn't define what access that requires versus her day-to-day usage — worth deciding deliberately given the "full access" Gmail/Drive grants involved.

---

## 12. Step-by-Step Roadmap for Future Development

This roadmap assumes this planning document is approved first, per the brainstorming/approval gate requested. Nothing below should begin until that approval is given.

1. **Resolve the blocking open questions with her** (§11.1 and the highest-impact items in §11.2 — specifically items 2, 3, 5, 6, 8, 9, 11, 13, 17), since several of them change what Phase 1 or Phase 3 actually need to include.
2. **Run feasibility spikes before committing designs to them**, specifically:
   - Check whether Innovate School and Sola expose any programmatic interface at all.
   - Check whether her specific Android phone/OEM supports default-assistant/power-button registration.
   - Evaluate at least one STT approach against real Tamil-English mixed speech samples from her.
   - Determine the realistic WhatsApp path (official Business Platform vs. not building it yet) and get her decision.
3. **Confirm the Supabase hosting region** and finalize the Phase 1 schema (§5) in light of decisions from steps 1–2.
4. **Decide the admin/permissions boundary** for Johan's setup role versus her day-to-day use.
5. **Build Phase 1** (database, task states, manual entry, 9:00 AM morning list) on a native Android client; she tests it before moving on. 🔵
6. **Build Phase 2** (on-demand reminders, phone notifications, reminder log) on top of Phase 1; she tests it. 🔵
7. **Build Phase 3** (evening planning conversation, voice capture, Tamil/English, Gmail + Drive, "Send?" messaging) using the STT and OAuth decisions from steps 1–3; she tests it. 🔵
8. **Build Phase 4** (school calendar, Innovate School/Sola connectors if confirmed feasible, parent/teacher group messaging, leave letters, power-button launch if confirmed feasible) with whatever fallback approach is needed for any item that step 2's spikes ruled out; she tests it. 🔵
9. **Post-Phase-4 candidates**, only if later confirmed in scope: desktop version (currently explicitly out of scope 🔵), support for additional users beyond her (❓), a food-quality/wastage-checking workflow (❓), and any integration with the "Birthday AI Agent" project (❓, pending information about what that project is).

---

## Summary of what still needs her decision before implementation starts

The items in §11.1 and §11.2 are the actual blockers. The single highest-leverage set to resolve first, because they each reshape phase scope rather than just adding detail, are: the Innovate-School/Sola phase-placement conflict (#11), the WhatsApp path decision (#9/#14), the power-button feasibility check (#7/#15), and the task-history retention conflict (#2). Everything else in this document can proceed to a written implementation plan once those are settled.
