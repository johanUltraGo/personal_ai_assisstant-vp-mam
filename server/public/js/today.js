import { api, el, button, emit, on, fmtDateTime, fmtTime, fmtDay } from "./api.js";
import { replyToMorningList } from "./assistant.js";
import { sendCard } from "./cards.js";
import { contactPicker } from "./messages.js";

// Today's list, alerts, tasks, reminders and attachments.

export async function loadMorningList() {
  const list = await api("/api/morning-list/today");
  const ul = document.getElementById("morning-list");
  ul.replaceChildren(
    ...(list.tasks.length
      ? list.tasks.map((t) => el("li", {}, `${fmtTime(t.timeWindowStart)}–${fmtTime(t.timeWindowEnd)} — ${t.title} `, el("span", { class: `status-${t.status}` }, `[${t.status}]`)))
      : [el("li", {}, "Nothing scheduled for today.")])
  );
  document.getElementById("confirmed-badge").hidden = !list.confirmedAt;
}

export async function loadAlerts() {
  const box = document.getElementById("alerts");
  const [prompts, reminders] = await Promise.all([api("/api/calendar/prompts"), api("/api/reminders")]);
  const failed = reminders.filter((r) => r.status === "FAILED");
  const items = [];
  for (const { event, draft } of prompts) {
    const area = el("div");
    items.push(
      el(
        "div",
        { class: "card" },
        el("h4", {}, `${event.eventName} — ${fmtDay(event.eventDate)}`),
        el("p", {}, "This event is coming up. Shall I send a notification to the parents' group?"),
        el(
          "div",
          { class: "button-row" },
          button("Yes, prepare it", async () => area.replaceChildren(eventNoticeForm(event, draft, area)), "primary"),
          button("No", async () => {
            await api(`/api/calendar/events/${event.id}/respond`, { json: { approved: false } });
            await loadAlerts();
          }, "secondary")
        ),
        area
      )
    );
  }
  for (const r of failed) {
    items.push(el("div", { class: "card" }, el("h4", {}, "A reminder could not reach your phone"), el("p", {}, `${r.label} — ${fmtDateTime(r.fireAt)}`), button("Try again in 1 minute", async () => {
      await api(`/api/reminders/${r.id}/reschedule`, { json: { fireAt: new Date(Date.now() + 60_000).toISOString() } });
      await loadAlerts();
      emit("reminders-changed");
    })));
  }
  box.replaceChildren(...(items.length ? items : [el("p", { class: "hint" }, "Nothing needs your answer right now.")]));
}

function eventNoticeForm(event, draft, area) {
  const picker = contactPicker("parents");
  const channel = el("select", {}, el("option", { value: "EMAIL" }, "Email"), el("option", { value: "WHATSAPP" }, "WhatsApp"));
  const subject = el("input", { type: "text", value: draft.subject });
  const body = el("textarea", { rows: "6" });
  body.value = draft.body;
  return el(
    "form",
    {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          const contactId = picker.selectedId();
          if (!contactId) throw new Error("Choose who to send it to (add the parents' group under Messages → Contacts).");
          const result = await api(`/api/calendar/events/${event.id}/respond`, { json: { approved: true, contactId, channel: channel.value, subject: subject.value, body: body.value } });
          area.replaceChildren(sendCard(result.pending));
        } catch (err) {
          alert(err.message);
        }
      },
    },
    el("label", {}, "To ", picker.input),
    el("label", {}, "Send by ", channel),
    el("label", {}, "Subject ", subject),
    el("label", {}, "Message ", body),
    el("button", { type: "submit" }, "Prepare")
  );
}

export async function loadTasks() {
  const tasks = await api("/api/tasks");
  const tbody = document.querySelector("#tasks-table tbody");
  tbody.replaceChildren(
    ...tasks.map((t) => {
      const open = !["COMPLETED", "CANCELLED"].includes(t.status);
      const actions = el("td");
      if (["SCHEDULED", "REMINDER_SENT", "OVERDUE"].includes(t.status)) actions.append(button("Start", () => change(`/api/tasks/${t.id}/start`)));
      // The ONLY place on screen that marks a task done — always her tap (spec §10).
      if (open) actions.append(button("Complete", () => change(`/api/tasks/${t.id}/complete`)));
      if (open) actions.append(button("Cancel", async () => {
        if (confirm(`Cancel "${t.title}"? Its history is kept.`)) await change(`/api/tasks/${t.id}/cancel`);
      }, "secondary"));
      actions.append(button("Attach", async () => selectForAttachment(t)));
      return el(
        "tr",
        {},
        el("td", {}, t.title),
        el("td", {}, t.category || ""),
        el("td", {}, `${fmtDateTime(t.timeWindowStart)} – ${fmtTime(t.timeWindowEnd)}`),
        el("td", { class: `status-${t.status}` }, t.status),
        actions
      );
    })
  );
}

async function change(url) {
  await api(url, { method: "POST" });
  emit("tasks-changed");
}

export async function loadReminders() {
  const reminders = await api("/api/reminders");
  const tbody = document.querySelector("#reminders-table tbody");
  tbody.replaceChildren(
    ...reminders.map((r) => {
      const actions = el("td");
      if (r.status === "PENDING") {
        actions.append(button("Snooze 10m", async () => {
          await api(`/api/reminders/${r.id}/snooze`, { json: { minutes: 10 } });
          await loadReminders();
        }));
        actions.append(button("Delay 1h", async () => {
          await api(`/api/reminders/${r.id}/delay`, { json: { minutes: 60 } });
          await loadReminders();
        }, "secondary"));
      }
      return el("tr", {}, el("td", {}, fmtDateTime(r.fireAt)), el("td", {}, r.label), el("td", { class: `status-${r.status}` }, r.status), actions);
    })
  );
}

function selectForAttachment(task) {
  document.getElementById("attachment-task-id").value = task.id;
  document.getElementById("attachment-task-title").value = task.title;
  document.getElementById("attachment-section").scrollIntoView({ behavior: "smooth" });
  return loadAttachments(task.id);
}

async function loadAttachments(taskId) {
  const list = await api(`/api/attachments?taskId=${encodeURIComponent(taskId)}`);
  document.getElementById("attachment-list").replaceChildren(
    ...list.map((a) =>
      el("li", {}, a.storedName
        ? el("a", { href: `/api/attachments/${a.id}/file`, target: "_blank", rel: "noopener" }, a.originalName)
        : el("a", { href: `https://drive.google.com/file/d/${a.driveFileId}/view`, target: "_blank", rel: "noopener" }, `${a.originalName} (Drive)`))
    )
  );
}

export function initToday() {
  document.getElementById("confirm-list").addEventListener("click", async () => {
    await api("/api/morning-list/confirm", { method: "POST" }).catch((e) => alert(e.message));
    await loadMorningList();
  });
  document.getElementById("change-list").addEventListener("click", () => replyToMorningList().catch((e) => alert(e.message)));
  document.getElementById("refresh-morning-list").addEventListener("click", loadMorningList);
  document.getElementById("refresh-all-tasks").addEventListener("click", loadTasks);
  document.getElementById("refresh-reminders").addEventListener("click", loadReminders);

  document.getElementById("new-task-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const error = document.getElementById("form-error");
    error.textContent = "";
    try {
      await api("/api/tasks", {
        json: {
          title: document.getElementById("task-title").value,
          category: document.getElementById("task-category").value || undefined,
          description: document.getElementById("task-description").value || undefined,
          timeWindowStart: new Date(document.getElementById("task-start").value).toISOString(),
          timeWindowEnd: new Date(document.getElementById("task-end").value).toISOString(),
        },
      });
      e.target.reset();
      emit("tasks-changed");
    } catch (err) {
      error.textContent = err.message;
    }
  });

  document.getElementById("new-reminder-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/reminders", {
        json: {
          label: document.getElementById("reminder-label").value,
          fireAt: new Date(document.getElementById("reminder-fire-at").value).toISOString(),
          repeatRule: document.getElementById("reminder-repeat").value || undefined,
        },
      });
      e.target.reset();
      await loadReminders();
    } catch (err) {
      alert(err.message);
    }
  });

  // Spec §4: choose one or more photos, tap the tick, they go to the task.
  document.getElementById("attachment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const taskId = document.getElementById("attachment-task-id").value;
    const status = document.getElementById("attachment-status");
    if (!taskId) return (status.textContent = "Choose Attach beside a task first.");
    const files = [...document.getElementById("attachment-file").files];
    const link = document.getElementById("attachment-drive-link").value.trim();
    try {
      let count = 0;
      for (const file of files) {
        status.textContent = `Attaching ${file.name}…`;
        const res = await fetch(`/api/attachments?taskId=${encodeURIComponent(taskId)}`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
          body: file,
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not attach ${file.name}`);
        count++;
      }
      if (link) {
        await api("/api/attachments/drive-link", { json: { taskId, url: link } });
        count++;
      }
      status.textContent = count ? `Attached ${count} item(s).` : "Choose photos or paste a Drive link.";
      e.target.reset();
      document.getElementById("attachment-task-id").value = taskId;
      await loadAttachments(taskId);
    } catch (err) {
      status.textContent = err.message;
    }
  });

  on("tasks-changed", () => Promise.all([loadTasks(), loadMorningList()]));
  on("reminders-changed", loadReminders);
  on("alerts-changed", loadAlerts);
}
