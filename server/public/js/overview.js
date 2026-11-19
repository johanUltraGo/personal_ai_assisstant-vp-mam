import { api } from "./api.js";

// The top of the desk: a greeting, today's date and four figures taken from
// her own data (nothing invented). Refreshed every minute.

const $ = (id) => document.getElementById(id);
const DONE = new Set(["COMPLETED", "CANCELLED"]);

function greet() {
  const now = new Date();
  const hour = now.getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  $("greeting").textContent = `${part}, Ma’am`;
  $("today-date").textContent = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

async function figure(id, load) {
  try {
    $(id).textContent = await load();
  } catch {
    $(id).textContent = "not available";
  }
}

async function refresh() {
  greet();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  await Promise.all([
    figure("ov-tasks", async () => (await api("/api/morning-list/today")).tasks.filter((t) => !DONE.has(t.status)).length),
    figure("ov-answers", async () => {
      const [prompts, reminders] = await Promise.all([api("/api/calendar/prompts"), api("/api/reminders")]);
      return prompts.length + reminders.filter((r) => r.status === "FAILED").length;
    }),
    figure("ov-reminders", async () =>
      (await api("/api/reminders")).filter((r) => r.status === "PENDING" && new Date(r.fireAt) <= endOfDay).length
    ),
    figure("ov-next", async () => {
      const events = await api("/api/calendar/events");
      const next = events[0];
      if (!next) return "None in the next 60 days";
      const day = new Date(next.eventDate).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      return `${next.eventName}, ${day}`;
    }),
  ]);
}

refresh();
setInterval(refresh, 60_000);
