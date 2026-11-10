import { api, el, emit } from "./api.js";
import { sendCard, planCard } from "./cards.js";

// One conversation at a time; GENERAL by default, EVENING_PLAN for "Plan
// tomorrow", MORNING_REPLY for "Change…" on today's list.
let conversation = null;
let lastInputMode = "TYPED";

const log = () => document.getElementById("conversation");
const cardsBox = () => document.getElementById("assistant-cards");
const status = (text) => (document.getElementById("speech-status").textContent = text);

function bubble(role, text) {
  log().append(el("div", { class: `bubble ${role}` }, text));
  log().scrollTop = log().scrollHeight;
}

export async function startConversation(kind = "GENERAL", opening) {
  conversation = await api("/api/assistant/conversations", { json: { kind } });
  log().replaceChildren();
  cardsBox().replaceChildren();
  if (kind === "EVENING_PLAN") bubble("assistant", "Let's plan tomorrow. How did today go?");
  if (opening) await ask(opening, "TYPED");
}

let busy = false;
function setBusy(value) {
  busy = value;
  for (const id of ["assistant-send", "listen-button", "plan-tomorrow", "new-conversation"]) document.getElementById(id).disabled = value;
}

export async function ask(text, inputMode = lastInputMode) {
  if (!text.trim()) return;
  // One message at a time: a second one while the first is answered would
  // interleave the conversation (the server refuses it too).
  if (busy) {
    status("Please wait — I'm still answering your last message.");
    document.getElementById("assistant-text").value = text;
    return;
  }
  setBusy(true);
  if (!conversation) conversation = await api("/api/assistant/conversations", { json: { kind: "GENERAL" } });
  bubble("user", text);
  status("Thinking…");
  try {
    const result = await api(`/api/assistant/conversations/${conversation.id}/messages`, { json: { text, inputMode } });
    bubble("assistant", result.reply);
    status("");
    for (const card of result.cards) {
      if (card.type === "send") cardsBox().append(sendCard(card.pending));
      if (card.type === "plan") cardsBox().append(await planCard(card.proposalId));
    }
    if (result.cards.some((c) => c.type === "changed")) emit("tasks-changed");
    speak(result.reply);
  } catch (err) {
    status(err.message);
  } finally {
    lastInputMode = "TYPED";
    setBusy(false);
  }
}

/** Reads the reply aloud after a spoken request (voice-first, spec §4). */
function speak(text) {
  if (lastInputMode !== "VOICE" || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = /[஀-௿]/.test(text) ? "ta-IN" : "en-IN";
  window.speechSynthesis.speak(utterance);
}

function configureSpeech() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = document.getElementById("listen-button");
  if (!Recognition) {
    mic.disabled = true;
    status("Voice input is not available in this browser. You can type instead.");
    return;
  }
  mic.addEventListener("click", () => {
    const recognition = new Recognition();
    // Browser speech needs one language; Tamil recognisers also catch common
    // English words. Claude handles mixed Tamil-English text afterwards.
    recognition.lang = "ta-IN";
    recognition.interimResults = true;
    recognition.continuous = false;
    let transcript = "";
    mic.classList.add("listening");
    status("Listening…");
    recognition.onresult = (event) => {
      transcript = Array.from(event.results).map((r) => r[0].transcript).join(" ");
      document.getElementById("assistant-text").value = transcript;
    };
    recognition.onerror = (event) => status(`Voice input stopped: ${event.error}. You can type instead.`);
    recognition.onend = () => {
      mic.classList.remove("listening");
      if (transcript.trim()) {
        document.getElementById("assistant-text").value = "";
        lastInputMode = "VOICE";
        ask(transcript, "VOICE");
      } else if (document.getElementById("speech-status").textContent === "Listening…") status("");
    };
    recognition.start();
  });
}

export function initAssistant() {
  configureSpeech();
  const input = document.getElementById("assistant-text");
  const submit = () => {
    const text = input.value;
    input.value = "";
    ask(text, "TYPED");
  };
  document.getElementById("assistant-send").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  document.getElementById("plan-tomorrow").addEventListener("click", () => startConversation("EVENING_PLAN").catch((e) => status(e.message)));
  document.getElementById("new-conversation").addEventListener("click", () => startConversation("GENERAL").catch((e) => status(e.message)));
}

/** "Change…" on today's list: one reply to the morning list (spec §3). */
export async function replyToMorningList() {
  await startConversation("MORNING_REPLY");
  bubble("assistant", "What would you like to change in today's list?");
  document.getElementById("assistant-section").scrollIntoView({ behavior: "smooth" });
  document.getElementById("assistant-text").focus();
}
