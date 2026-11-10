import { api, el, button, fmtDay, fmtDateTime } from "./api.js";

// Calendar, connections (Google accounts, WhatsApp), phone notifications,
// activity log and the PIN sign-in.

export async function loadCalendar() {
  const events = await api("/api/calendar/events");
  document.getElementById("calendar-list").replaceChildren(
    ...(events.length
      ? events.map((e) => el("li", {}, `${fmtDay(e.eventDate)} — ${e.eventName}${e.type === "HOLIDAY" ? " (holiday)" : ""}${e.notifiedAt ? " · parents told" : ""}`))
      : [el("li", { class: "hint" }, "No upcoming events. Upload the calendar or check the Drive calendar.")])
  );
}

export async function loadConnections() {
  const [health, accounts] = await Promise.all([api("/api/connectors/health"), api("/api/google/accounts")]);
  document.getElementById("connections-list").replaceChildren(
    ...health.map((c) => el("li", { class: c.configured ? "connection-ready" : "connection-not-ready" }, `${c.type}: ${c.detail}`))
  );
  document.getElementById("google-accounts").replaceChildren(
    ...(accounts.length
      ? accounts.map((a) =>
          el(
            "li",
            {},
            `${a.email}${a.label ? ` (${a.label})` : ""}${a.isDefault ? " — sends email" : ""} `,
            a.isDefault ? null : button("Use for email", async () => {
              await api(`/api/google/accounts/${a.id}/default`, { method: "POST" });
              await loadConnections();
            }, "secondary"),
            button("Disconnect", async () => {
              if (!confirm(`Disconnect ${a.email}?`)) return;
              await api(`/api/google/accounts/${a.id}`, { method: "DELETE" });
              await loadConnections();
            }, "secondary")
          )
        )
      : [el("li", { class: "hint" }, "No Google account connected yet.")])
  );
}

export async function loadActivity() {
  const entries = await api("/api/activity?limit=30");
  document.getElementById("activity-list").replaceChildren(...entries.map((a) => el("li", {}, `${fmtDateTime(a.at)} — ${a.summary}`)));
}

function base64UrlToBytes(value) {
  const padded = (value + "=".repeat((4 - (value.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function enableNotifications() {
  const status = document.getElementById("notification-status");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    status.textContent = "This browser cannot receive notifications. On Android use Chrome, opened over https.";
    return;
  }
  const { publicKey } = await api("/api/push/public-key");
  if (!publicKey) {
    status.textContent = "Notifications are not set up on the server yet (VAPID keys missing — see server/README.md).";
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    status.textContent = "Notifications were not allowed. You can allow them in the browser's site settings.";
    return;
  }
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) }));
  await api("/api/push/subscribe", { json: subscription.toJSON() });
  status.textContent = "Notifications are on for this phone.";
}

function showGoogleResult() {
  const params = new URLSearchParams(location.search);
  const result = params.get("google");
  if (!result) return;
  const messages = {
    connected: `Connected ${params.get("email") || "the Google account"}.`,
    cancelled: "Google sign-in was cancelled.",
    error: `Google sign-in failed: ${params.get("message") || "unknown error"}`,
  };
  alert(messages[result] || "");
  history.replaceState(null, "", location.pathname + location.hash);
}

export function showLogin() {
  document.getElementById("login-overlay").hidden = false;
  document.getElementById("login-pin").focus();
}

export function initSettings(onSignedIn) {
  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = document.getElementById("login-error");
    try {
      await api("/api/auth/login", { json: { pin: document.getElementById("login-pin").value } });
      document.getElementById("login-overlay").hidden = true;
      error.textContent = "";
      onSignedIn();
    } catch (err) {
      error.textContent = err.message;
    }
  });

  document.getElementById("calendar-sync-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("calendar-status");
    status.textContent = "Reading the calendar…";
    try {
      const link = document.getElementById("calendar-drive-link").value.trim();
      const result = await api("/api/calendar/sync", { json: link ? { fileId: link } : {} });
      status.textContent = `Read ${result.imported} entries, ${result.created} new.`;
      await loadCalendar();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById("calendar-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    const status = document.getElementById("calendar-status");
    if (!file) return;
    try {
      const res = await fetch("/api/calendar/import", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "text/plain" }, body: await file.text() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not read that file.");
      status.textContent = `Imported ${body.imported} entries, ${body.created} new.`;
      e.target.value = "";
      await loadCalendar();
    } catch (err) {
      status.textContent = err.message;
    }
  });

  document.getElementById("google-connect-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const label = document.getElementById("google-label").value.trim();
    location.href = `/api/google/connect${label ? `?label=${encodeURIComponent(label)}` : ""}`;
  });

  document.getElementById("enable-notifications").addEventListener("click", () =>
    enableNotifications().catch((err) => (document.getElementById("notification-status").textContent = err.message))
  );
  document.getElementById("refresh-activity").addEventListener("click", loadActivity);
  showGoogleResult();
}
