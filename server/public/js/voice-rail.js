import { api, el, fmtTime } from "./api.js";

// The voice page's side rail: today's schedule, the school calendar and the
// parents' group. Read-only views of the same endpoints the full app uses; the
// only action here is "sync school calendar" (POST /api/calendar/sync).
// Every list has four states: loading (skeleton rows), empty, error, full.

const $ = (id) => document.getElementById(id);
const DONE = new Set(["COMPLETED", "CANCELLED"]);
const SENT_STATUS = { SENT: "sent", HANDED_OFF: "opened on phone", BLOCKED: "not sent", FAILED: "failed", PENDING: "waiting" };
const humanise = (status) => String(status || "").toLowerCase().replaceAll("_", " ");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const shortDay = (v) => new Date(v).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

function fill(list, items, emptyText) {
  list.removeAttribute("aria-busy");
  list.dataset.state = items.length ? "full" : "empty";
  list.replaceChildren(...(items.length ? items : [el("li", { class: "row-note" }, emptyText)]));
}

function fail(list, err, retry) {
  list.removeAttribute("aria-busy");
  list.dataset.state = "error";
  list.replaceChildren(
    el("li", { class: "row-note row-error" }, `${err.message} `, el("button", { type: "button", class: "link-button", onclick: retry }, "try again"))
  );
}

async function loadSchedule() {
  const list = $("schedule-list");
  try {
    const day = await api("/api/morning-list/today");
    const now = Date.now();
    const rows = day.tasks.map((t) => {
      const live = !DONE.has(t.status) && new Date(t.timeWindowStart) <= now && now < new Date(t.timeWindowEnd);
      return el(
        "li",
        { class: `row slot${live ? " is-now" : ""}`, "data-status": t.status },
        el("span", { class: "row-time num" }, `${fmtTime(t.timeWindowStart)}–${fmtTime(t.timeWindowEnd)}`),
        el("span", { class: "row-title" }, t.title),
        el("span", { class: "row-status" }, live ? "now" : humanise(t.status))
      );
    });
    fill(list, rows, "Nothing scheduled for today.");
    $("schedule-count").textContent = plural(day.tasks.length, "item", "items");
    $("schedule-confirmed").hidden = !day.confirmedAt;
  } catch (err) {
    $("schedule-count").textContent = "";
    fail(list, err, loadSchedule);
  }
}

async function loadEvents() {
  const list = $("events-list");
  try {
    const events = await api("/api/calendar/events");
    fill(
      list,
      events.slice(0, 4).map((e) =>
        el(
          "li",
          { class: "row" },
          el("span", { class: "row-time num" }, shortDay(e.eventDate)),
          el("span", { class: "row-title" }, e.eventName),
          el("span", { class: "row-status" }, e.type === "HOLIDAY" ? "holiday" : "")
        )
      ),
      "No events in the next 60 days."
    );
  } catch (err) {
    fail(list, err, loadEvents);
  }
}

async function loadNotices() {
  const list = $("notice-list");
  try {
    const prompts = await api("/api/calendar/prompts");
    fill(
      list,
      prompts.map(({ event }) =>
        el(
          "li",
          { class: "row notice" },
          el("span", { class: "row-time num" }, shortDay(event.eventDate)),
          el("span", { class: "row-title" }, event.eventName),
          el("a", { class: "row-action", href: "/" }, "answer in the full app")
        )
      ),
      "No notices waiting for your answer."
    );
    $("parents-count").textContent = prompts.length ? plural(prompts.length, "waiting", "waiting") : "";
  } catch (err) {
    $("parents-count").textContent = "";
    fail(list, err, loadNotices);
  }
}

async function loadSent() {
  const list = $("sent-recent");
  try {
    const sent = await api("/api/messaging/sent?limit=5");
    fill(
      list,
      sent.map((m) =>
        el(
          "li",
          { class: "row", "data-status": m.status },
          el("span", { class: "row-time num" }, m.confirmedAt ? shortDay(m.confirmedAt) : ""),
          el("span", { class: "row-title" }, `${m.recipient}, by ${m.channel === "EMAIL" ? "email" : "WhatsApp"}`),
          el("span", { class: "row-status" }, SENT_STATUS[m.status] || humanise(m.status))
        )
      ),
      "Nothing sent yet."
    );
  } catch (err) {
    fail(list, err, loadSent);
  }
}

export function loadRail() {
  return Promise.all([loadSchedule(), loadEvents(), loadNotices(), loadSent()]);
}

export function initRail() {
  // Wide screens show both panels open; phones start them folded above the conversation.
  const wide = window.matchMedia("(min-width: 60rem)");
  const panels = document.querySelectorAll(".rail .panel");
  const fit = () => panels.forEach((panel) => (panel.open = wide.matches));
  fit();
  wide.addEventListener("change", fit);

  const syncButton = $("sync-calendar");
  syncButton.addEventListener("click", async () => {
    const status = $("sync-status");
    syncButton.disabled = true;
    syncButton.dataset.busy = "";
    status.textContent = "checking the school calendar";
    try {
      const result = await api("/api/calendar/sync", { json: {} });
      status.textContent = `Checked "${result.fileName}": ${plural(result.imported, "entry", "entries")}, ${result.created} new.`;
      await Promise.all([loadEvents(), loadSchedule(), loadNotices()]);
    } catch (err) {
      status.textContent = err.message;
    } finally {
      syncButton.disabled = false;
      delete syncButton.dataset.busy;
    }
  });
}
