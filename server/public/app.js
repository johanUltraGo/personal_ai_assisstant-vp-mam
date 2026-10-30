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
