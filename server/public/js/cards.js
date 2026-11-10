import { api, el, button, emit, toLocalInput } from "./api.js";

/**
 * The single "Send?" step (spec §5): shows exactly the stored message once,
 * with Send and Cancel. Only the Send tap can make anything leave.
 */
export function sendCard(pending) {
  const channel = pending.channel === "EMAIL" ? "Email" : "WhatsApp";
  const to = pending.recipientAddress ? `${pending.recipientName} (${pending.recipientAddress})` : `${pending.recipientName} — you choose the chat in WhatsApp`;
  const status = el("p", { class: "hint", "aria-live": "polite" });
  const actions = el("div", { class: "button-row" });
  const card = el(
    "div",
    { class: "card" },
    el("h4", {}, `${channel} to ${to}`),
    pending.subject ? el("p", {}, el("strong", {}, "Subject: "), pending.subject) : null,
    el("div", { class: "message-body" }, pending.body),
    el("p", {}, el("strong", {}, "Send?")),
    actions,
    status
  );
  const finish = (text) => {
    actions.replaceChildren();
    status.textContent = text;
    card.classList.add("done");
  };
  actions.append(
    button("Send", async () => {
      const result = await api(`/api/messaging/pending/${pending.id}/send`, { method: "POST" });
      if (result.handoffUrl && result.status === "HANDED_OFF") {
        finish("WhatsApp is opening with the message typed — choose the chat and tap send there.");
        window.open(result.handoffUrl, "_blank", "noopener");
      } else if (result.status === "SENT") {
        finish("Sent.");
      } else {
        finish(`Not sent: ${result.record.blockReason || result.status}`);
        if (result.handoffUrl) actions.append(el("a", { href: result.handoffUrl, target: "_blank", rel: "noopener" }, "Send it yourself in WhatsApp"));
      }
      emit("messages-changed");
      emit("alerts-changed");
    }, "primary"),
    button("Cancel", async () => {
      await api(`/api/messaging/pending/${pending.id}/cancel`, { method: "POST" });
      finish("Cancelled. Nothing was sent.");
    }, "secondary")
  );
  return card;
}

/** Evening plan proposal (spec §3): she edits every window, then saves. */
export async function planCard(proposalId) {
  const plan = await api(`/api/plans/${proposalId}`);
  const tbody = el("tbody");
  const addRow = (item = {}) => {
    const row = el(
      "tr",
      {},
      el("td", {}, el("input", { type: "text", value: item.title || "", "aria-label": "Task" })),
      el("td", {}, el("input", { type: "datetime-local", value: item.start ? toLocalInput(item.start) : "", "aria-label": "Starts" })),
      el("td", {}, el("input", { type: "datetime-local", value: item.end ? toLocalInput(item.end) : "", "aria-label": "Ends" }))
    );
    row.dataset.category = item.category || "";
    row.dataset.notes = item.notes || "";
    row.append(el("td", {}, button("Remove", async () => row.remove(), "secondary")));
    tbody.append(row);
  };
  plan.items.forEach(addRow);
  const status = el("p", { class: "hint", "aria-live": "polite" });
  const card = el(
    "div",
    { class: "card" },
    el("h4", {}, `Plan for ${plan.planDate}`),
    el("table", { class: "plan-table" }, el("thead", {}, el("tr", {}, el("th", {}, "Task"), el("th", {}, "Starts"), el("th", {}, "Ends"), el("th"))), tbody),
    el(
      "div",
      { class: "button-row" },
      button("Add a row", async () => addRow(), "secondary"),
      button("Save plan", async () => {
        const items = [...tbody.querySelectorAll("tr")].map((row) => {
          const [title, start, end] = [...row.querySelectorAll("input")].map((i) => i.value);
          if (!title || !start || !end) throw new Error("Each row needs a task, a start and an end.");
          return { title, category: row.dataset.category || undefined, notes: row.dataset.notes || undefined, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
        });
        const saved = await api(`/api/plans/${proposalId}/save`, { json: { items } });
        status.textContent = `Saved ${saved.tasks.length} task(s) for ${plan.planDate}.`;
        card.classList.add("done");
        emit("tasks-changed");
      }, "primary")
    ),
    status
  );
  if (plan.status !== "DRAFT") {
    status.textContent = plan.status === "SAVED" ? "This plan is saved." : "This plan was replaced by a newer one.";
    card.classList.add("done");
  }
  return card;
}
