# Vice Principal AI — server

Node + TypeScript + Express 5 + Prisma (SQLite). Serves the API and the web page in `public/`.
Design: `docs/superpowers/specs/2026-11-10-assistant-completion-design.md`. Status: `planning.md`.

## Run it

```bash
cd server
npm install
cp .env.example .env          # ONLY if .env does not exist yet - never over an existing one
npx prisma migrate deploy     # creates prisma/dev.db
npm run dev                   # http://localhost:4000 (stops when you close the window)
npm test                      # 141 tests on a separate test.db, no network or keys needed
npm run typecheck
```

### Keep it running (Windows)

Reminders, the 9:00 list and calendar alerts only happen while the server runs.

```bash
npm run service:install       # build, start now, and start again at every Windows log-in
npm run service:restart       # after editing .env or updating the code
npm run service:stop          # stop it (until the next log-in)
npm run service:uninstall     # remove the startup task
```

It runs as the scheduled task **VP Assistant**. If the server ever stops, it is restarted within 5 seconds. The log is `server/logs/server.log`. While the service runs, don't also start `npm run dev`, because both use port 4000.

> **If `npm` does nothing in PowerShell:** a stray empty file `C:\Windows\System32\npm` can shadow the real command. Use `npm.cmd` instead, or delete that file from an administrator PowerShell: `Remove-Item C:\Windows\System32\npm`.

### https address (needed for her phone)

1. Set `APP_ACCESS_PIN` and run `npm.cmd run service:restart`. The tunnel refuses to start without a PIN.
2. Install Cloudflare's tunnel tool once: `winget install --id Cloudflare.cloudflared`.
3. **Quick test:** `npm.cmd run tunnel` prints an `https://….trycloudflare.com` address. It works while that window stays open, and the address changes every time.
4. **Permanent address** (needs a free Cloudflare account and a domain): `cloudflared tunnel login`, `cloudflared tunnel create vp`, `cloudflared tunnel route dns vp vp.yourschool.org`, then `cloudflared service install` with a config pointing to `http://localhost:4000`. In `.env` set `PUBLIC_ORIGIN=https://vp.yourschool.org`, `COOKIE_SECURE=true`, and change `GOOGLE_OAUTH_REDIRECT_URI` (and the one registered in Google Cloud) to `https://vp.yourschool.org/api/google/oauth/callback`.

### Check the assistant (after adding the Claude key)

`npm.cmd run eval` runs 16 real requests in Tamil, English and mixed (`evals/assistant-cases.json`) against the live assistant on a throwaway database, and reports which behaved correctly. This includes safety cases, such as asking when a name matches two people. It costs a few cents. Add a case whenever she says something it gets wrong.

### On her phone

Open the https address in Chrome, then menu → **Install app** (or **Add to Home screen**). She gets a "VP Assistant" icon that opens full-screen; a long press on it offers **Talk** and **Today**. Then Connections → *Turn on notifications on this phone*.

Everything works without any keys except: the assistant (needs `ANTHROPIC_API_KEY`), real email/Drive (Google sign-in), and phone notifications (VAPID keys). Without them the page says what is missing.

## Setup, item by item

**1. Access PIN (do this before her phone uses it).** Set `APP_ACCESS_PIN` (6+ digits). The page asks for it once per browser; 5 wrong tries lock out for 15 minutes. Without a PIN the API only answers this same computer.

**2. Assistant.** Put an Anthropic API key in `ANTHROPIC_API_KEY`. Default model `claude-opus-5-5` (override with `ANTHROPIC_MODEL`). Requests use the server-side refusal fallback beta (`fallbacks: "default"`) and prompt caching.

**3. Google accounts (Gmail + Drive).**
1. In Google Cloud Console create a project, enable the **Gmail API** and **Google Drive API**.
2. OAuth consent screen: if the school uses Google Workspace, choose **Internal** (no verification, tokens don't expire weekly). Otherwise External, and add her addresses as test users — note unverified External apps get refresh tokens that expire after 7 days.
3. Credentials → OAuth client ID → *Web application*; add the redirect URI from `GOOGLE_OAUTH_REDIRECT_URI` (e.g. `https://your-host/api/google/oauth/callback`).
4. Fill `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` and `TOKEN_ENCRYPTION_KEY`.
5. On the page: Connections → *Connect Google account*, once per account (personal, school). Scopes requested: `gmail.send` and `drive.readonly` only. The first account sends email; change it with *Use for email*.

**4. School calendar.** Put the Drive link of the calendar in `SCHOOL_CALENDAR_FILE_ID`. It is read on startup and every day at 08:55; event alerts go out at 09:01 (and on startup between 9 AM and 6 PM). Formats: Google Sheet / CSV with *Date, Event, Type* columns (dates `DD/MM/YYYY` or `YYYY-MM-DD`; a row is a holiday when Type or the name says "holiday"), `.ics`, or a JSON list. You can also upload the file on the Calendar section.

**5. Phone notifications.** The keys are already generated in `.env` (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`; to make new ones run `npx web-push generate-vapid-keys`). Set `VAPID_SUBJECT` to your own `mailto:` address. The site must be served over **https** (or localhost). On her phone open the page in Chrome → Connections → *Turn on notifications on this phone*. Reminders become DELIVERED when the phone confirms it showed them.

**6. WhatsApp.** Works without setup: after *Send*, WhatsApp opens with the message typed and she taps send (for groups she picks the group). Optional Meta Business Cloud API (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) sends automatically to individuals — but only free text within 24 hours of their last message; otherwise the app offers the hand-off link.

**7. Backups.** Every day at 02:00 the server saves a consistent copy of the database as `backups/vp-YYYY-MM-DD.db` (change the folder with `BACKUP_DIR`, how many days to keep with `BACKUP_KEEP_DAYS`, default 14). Point `BACKUP_DIR` at another disk or a synced folder (e.g. Google Drive for desktop). To restore: stop the server, copy a backup over `prisma/dev.db`, start again.

**8. Privacy: old chats.** Set `CONVERSATION_RETENTION_DAYS` (e.g. `30`) to delete assistant chats idle that long, every night at 02:00. Empty keeps them. Tasks, reminders and the sent-message record are never deleted.

**9. Contacts.** Add people and groups (e.g. "Parents group – Class 8", "Teachers group") under Messages → Contacts. The assistant only sends to contacts that exist here.

## Safety rules built into the code
- Only `POST /api/messaging/pending/:id/send` can send, and only a preview the server stored and showed, once, within 30 minutes. The assistant has no send tool.
- Only her tap or her explicit words to the assistant complete a task; cancelled tasks keep their history.
- Reminders exist only when she asks.
- Google refresh tokens are encrypted; access tokens stay in memory.

## Layout
- `src/assistant/` — system prompt, tools, agent loop (Claude tool use).
- `src/ai/claude.ts` — model, effort, fallback and caching settings.
- `src/services/` — tasks, reminders, morning list, plans, messaging, calendar, leave, attachments, activity.
- `src/connectors/` — Gmail, Drive, WhatsApp, plus `registry.ts` choosing accounts.
- `src/google/` — sign-in flow and token encryption.
- `src/scheduler/` — every-minute reminders, 9:00 list, daily calendar jobs.
- `public/` — the page (`js/*.js` modules) and the notification service worker `sw.js`.
