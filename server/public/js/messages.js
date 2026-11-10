import { api, el, button, on, fmtDateTime } from "./api.js";
import { sendCard } from "./cards.js";

// Contacts (people and groups), compose → "Send?", sent history, leave notices.

let contacts = [];

export async function loadContacts() {
  contacts = await api("/api/messaging/contacts");
  document.getElementById("contact-names").replaceChildren(...contacts.map((c) => el("option", { value: c.displayName })));
  document.getElementById("contacts-list").replaceChildren(
    ...contacts.map((c) =>
      el(
        "li",
        {},
        `${c.displayName}${c.kind === "GROUP" ? " (group)" : ""} — ${[c.email, c.whatsappNumber].filter(Boolean).join(", ") || (c.kind === "GROUP" ? "WhatsApp: you pick the group" : "no address")} `,
        button("Remove", async () => {
          if (!confirm(`Remove ${c.displayName}?`)) return;
          await api(`/api/messaging/contacts/${c.id}`, { method: "DELETE" });
          await loadContacts();
        }, "secondary")
      )
    )
  );
}

/** A name box that resolves to exactly one contact, asking when several match (spec §5). */
export function contactPicker(prefill = "") {
  const input = el("input", { type: "text", list: "contact-names", autocomplete: "off" });
  if (prefill) {
    const match = contacts.filter((c) => c.displayName.toLowerCase().includes(prefill));
    if (match.length === 1) input.value = match[0].displayName;
  }
  return { input, selectedId: () => resolveContactId(input.value) };
}

/** Name → one contact id; asks which one when several match. */
export function resolveContactId(typed) {
  const name = typed.trim().toLowerCase();
  if (!name) return null;
  const exact = contacts.find((c) => c.displayName.toLowerCase() === name);
  if (exact) return exact.id;
  const matches = contacts.filter((c) => c.displayName.toLowerCase().includes(name));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) throw new Error(`Several contacts match "${typed}": ${matches.map((c) => c.displayName).join(", ")}. Which one?`);
  throw new Error(`No contact called "${typed}". Add it under Contacts first.`);
}

export async function loadSent() {
  const sent = await api("/api/messaging/sent");
  document.getElementById("sent-list").replaceChildren(
    ...sent.map((m) =>
      el("li", {}, `${fmtDateTime(m.confirmedAt)} — ${m.channel === "EMAIL" ? "Email" : "WhatsApp"} to ${m.recipient}: `, el("span", { class: `status-${m.status}` }, m.status), m.blockReason ? ` (${m.blockReason})` : "")
    )
  );
}

async function prepareFor(contactId, channel, subject, body, box) {
  const pending = await api("/api/messaging/prepare", { json: { contactId, channel, subject: subject || undefined, body } });
  box.replaceChildren(sendCard(pending));
}

export function initMessages() {
  const toInput = document.getElementById("compose-to");
  document.getElementById("compose-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const id = resolveContactId(toInput.value);
      if (!id) throw new Error("Type who to send it to.");
      await prepareFor(
        id,
        document.getElementById("compose-channel").value,
        document.getElementById("compose-subject").value,
        document.getElementById("compose-body").value,
        document.getElementById("compose-cards")
      );
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("contact-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/messaging/contacts", {
        json: {
          displayName: document.getElementById("contact-name").value,
          kind: document.getElementById("contact-kind").value,
          email: document.getElementById("contact-email").value || undefined,
          whatsappNumber: document.getElementById("contact-whatsapp").value || undefined,
        },
      });
      e.target.reset();
      await loadContacts();
    } catch (err) {
      alert(err.message);
    }
  });

  document.getElementById("leave-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = document.getElementById("leave-draft");
    try {
      const audience = document.getElementById("leave-audience").value;
      const draft = await api("/api/leave/draft", {
        json: {
          audience,
          names: document.getElementById("leave-names").value.split(",").map((n) => n.trim()).filter(Boolean),
          fromDate: document.getElementById("leave-from").value,
          toDate: document.getElementById("leave-to").value || undefined,
          reason: document.getElementById("leave-reason").value || undefined,
        },
      });
      const picker = contactPicker(audience === "TEACHER" ? "teacher" : "");
      const channel = el("select", {}, el("option", { value: "WHATSAPP" }, "WhatsApp"), el("option", { value: "EMAIL" }, "Email"));
      const body = el("textarea", { rows: "8" });
      body.value = draft.body;
      const box = el("div");
      out.hidden = false;
      out.replaceChildren(
        el("p", { class: "hint" }, `${draft.workingDays.length} working day(s)${draft.skipped.length ? `; left out: ${draft.skipped.map((s) => `${s.date} (${s.reason})`).join(", ")}` : ""}.`),
        el("label", {}, "Message ", body),
        el("label", {}, "To ", picker.input),
        el("label", {}, "Send by ", channel),
        button("Prepare to send", async () => prepareFor(picker.selectedId(), channel.value, draft.subject, body.value, box)),
        box
      );
    } catch (err) {
      alert(err.message);
    }
  });

  on("messages-changed", loadSent);
}
