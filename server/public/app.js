async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? JSON.stringify(body.error) : `Request failed: ${res.status}`);
  }
  return res.json();
}

async function loadMorningList() {
  const list = await fetchJSON("/api/morning-list/today");
  const ul = document.getElementById("morning-list");
  ul.innerHTML = "";
  if (list.tasks.length === 0) {
    ul.innerHTML = "<li>Nothing scheduled for today.</li>";
    return;
  }
  for (const t of list.tasks) {
    const li = document.createElement("li");
    li.textContent = `${formatWindow(t)} — ${t.title} [${t.status}]`;
    ul.appendChild(li);
  }
}

function setTaskDraft(draft) {
  const preview = document.getElementById("task-draft");
  preview.hidden = false;
  preview.innerHTML = "";
  const details = document.createElement("p");
  details.textContent = `${draft.title} — ${new Date(draft.timeWindowStart).toLocaleString()} to ${new Date(draft.timeWindowEnd).toLocaleString()}`;
  const notes = document.createElement("p");
  notes.textContent = draft.description || draft.category || "No additional notes";
  const use = document.createElement("button");
  use.type = "button";
  use.textContent = "Use this draft";
  use.addEventListener("click", () => {
    document.getElementById("task-title").value = draft.title;
    document.getElementById("task-category").value = draft.category || "";
    document.getElementById("task-description").value = draft.description || "";
    document.getElementById("task-start").value = toLocalDateTime(draft.timeWindowStart);
    document.getElementById("task-end").value = toLocalDateTime(draft.timeWindowEnd);
    document.getElementById("new-task-section").scrollIntoView({ behavior: "smooth" });
  });
  preview.append(details, notes, use);
}

function toLocalDateTime(value) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

async function parseAssistantText() {
  const text = document.getElementById("assistant-text").value.trim();
  const status = document.getElementById("speech-status");
  if (!text) { status.textContent = "Please speak or type what you would like to plan."; return; }
  status.textContent = "Creating a draft…";
  try {
    const result = await fetchJSON("/api/ai/parse-task", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
    });
    if (result.status === "parsed") {
      setTaskDraft(result.draft);
      status.textContent = "Draft ready for your review.";
    } else {
      status.textContent = result.question;
    }
  } catch (error) {
    status.textContent = error.message;
  }
}

function configureSpeechInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const button = document.getElementById("listen-button");
  const status = document.getElementById("speech-status");
  if (!SpeechRecognition) {
    button.disabled = true;
    status.textContent = "Voice input is not available in this browser. You can still type a task.";
    return;
  }
  button.addEventListener("click", () => {
    const recognition = new SpeechRecognition();
    recognition.lang = "ta-IN"; // Tamil recognisers also accept common English school terms; typing remains available if unsupported.
    recognition.interimResults = true;
    recognition.continuous = false;
    status.textContent = "Listening…";
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0].transcript).join(" ");
      document.getElementById("assistant-text").value = transcript;
      status.textContent = "I heard: " + transcript;
    };
    recognition.onerror = (event) => { status.textContent = `Voice input could not start: ${event.error}. You can type instead.`; };
    recognition.onend = () => { if (status.textContent === "Listening…") status.textContent = "Listening finished. Review the text, then make a task draft."; };
    recognition.start();
  });
}

async function loadConnections() {
  const list = await fetchJSON("/api/connectors/health");
  const element = document.getElementById("connections-list");
  element.innerHTML = "";
  for (const connection of list) {
    const item = document.createElement("li");
    item.className = connection.configured ? "connection-ready" : "connection-not-ready";
    item.textContent = `${connection.type}: ${connection.detail}`;
    element.appendChild(item);
  }
}

document.getElementById("parse-task-button").addEventListener("click", parseAssistantText);
document.getElementById("refresh-connections").addEventListener("click", () => loadConnections().catch((error) => alert(error.message)));
document.getElementById("leave-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const output = document.getElementById("leave-draft");
  try {
    const result = await fetchJSON("/api/leave/draft", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audience: document.getElementById("leave-audience").value,
        names: document.getElementById("leave-names").value.split(",").map((name) => name.trim()).filter(Boolean),
        leaveDate: document.getElementById("leave-date").value,
        reason: document.getElementById("leave-reason").value || undefined,
        schoolName: document.getElementById("leave-school").value || undefined,
      }),
    });
    output.hidden = false;
    output.textContent = `${result.subject}\n\n${result.body}`;
  } catch (error) { alert(error.message); }
});

document.getElementById("attachment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const taskId = document.getElementById("attachment-task-id").value.trim();
  const file = document.getElementById("attachment-file").files[0];
  const status = document.getElementById("attachment-status");
  if (!file) return;
  status.textContent = "Attaching…";
  try {
    const response = await fetch(`/api/attachments?taskId=${encodeURIComponent(taskId)}`, {
      method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": file.name }, body: file,
    });
    if (!response.ok) throw new Error((await response.json()).error || "Could not attach file");
    status.textContent = `${file.name} is attached to this task.`;
    document.getElementById("attachment-file").value = "";
  } catch (error) { status.textContent = error.message; }
});

async function loadAllTasks() {
  const tasks = await fetchJSON("/api/tasks");
  const tbody = document.querySelector("#tasks-table tbody");
  tbody.innerHTML = "";
  for (const t of tasks) {
    const tr = document.createElement("tr");

    const actions = document.createElement("td");
    if (t.status !== "COMPLETED") {
      if (t.status === "SCHEDULED" || t.status === "REMINDER_SENT" || t.status === "OVERDUE") {
        actions.appendChild(actionButton("Start", () => startTask(t.id)));
      }
      actions.appendChild(actionButton("Complete", () => completeTask(t.id)));
    }
    actions.appendChild(actionButton("Attach file", () => {
      document.getElementById("attachment-task-id").value = t.id;
      document.getElementById("attachment-section").scrollIntoView({ behavior: "smooth" });
      document.getElementById("attachment-file").focus();
      return Promise.resolve();
    }));

    tr.innerHTML = `
      <td>${escapeHtml(t.title)}</td>
      <td>${escapeHtml(t.category || "")}</td>
      <td>${formatWindow(t)}</td>
      <td class="status-${t.status}">${t.status}</td>
    `;
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
}

function actionButton(label, onClick) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.addEventListener("click", async () => {
    try {
      await onClick();
      await Promise.all([loadAllTasks(), loadMorningList()]);
    } catch (err) {
      alert(err.message);
    }
  });
  return btn;
}

function startTask(id) {
  return fetchJSON(`/api/tasks/${id}/start`, { method: "POST" });
}

function completeTask(id) {
  // The ONLY place in the UI that marks a task done — always an explicit
  // click by her, never automatic (spec §10).
  return fetchJSON(`/api/tasks/${id}/complete`, { method: "POST" });
}

function formatWindow(t) {
  const start = new Date(t.timeWindowStart);
  const end = new Date(t.timeWindowEnd);
  const fmt = (d) => d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function loadReminders() {
  const reminders = await fetchJSON("/api/reminders");
  const tbody = document.querySelector("#reminders-table tbody");
  tbody.innerHTML = "";
  for (const r of reminders) {
    const tr = document.createElement("tr");
    const actions = document.createElement("td");
    if (r.status === "PENDING") {
      actions.appendChild(actionButton("Snooze 10m", () => fetchJSON(`/api/reminders/${r.id}/snooze`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ minutes: 10 }),
      }).then(loadReminders)));
    }
    tr.innerHTML = `
      <td>${new Date(r.fireAt).toLocaleString()}</td>
      <td>${escapeHtml(r.label)}</td>
      <td>${r.status}</td>
    `;
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
}

document.getElementById("refresh-reminders").addEventListener("click", loadReminders);

document.getElementById("new-reminder-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await fetchJSON("/api/reminders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: document.getElementById("reminder-label").value,
      fireAt: new Date(document.getElementById("reminder-fire-at").value).toISOString(),
      repeatRule: document.getElementById("reminder-repeat").value || undefined,
    }),
  });
  document.getElementById("new-reminder-form").reset();
  await loadReminders();
});

loadReminders();

document.getElementById("refresh-morning-list").addEventListener("click", loadMorningList);
document.getElementById("refresh-all-tasks").addEventListener("click", loadAllTasks);

document.getElementById("new-task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("form-error");
  errorEl.textContent = "";
  try {
    await fetchJSON("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: document.getElementById("task-title").value,
        category: document.getElementById("task-category").value || undefined,
        description: document.getElementById("task-description").value || undefined,
        timeWindowStart: new Date(document.getElementById("task-start").value).toISOString(),
        timeWindowEnd: new Date(document.getElementById("task-end").value).toISOString(),
      }),
    });
    document.getElementById("new-task-form").reset();
    await Promise.all([loadAllTasks(), loadMorningList()]);
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

loadMorningList();
loadAllTasks();
configureSpeechInput();
loadConnections().catch(() => {});
