import { api, setUnauthorizedHandler } from "./api.js";
import { sendCard, planCard } from "./cards.js";
import { initRail, loadRail } from "./voice-rail.js";

// Voice overlay: one orb, four states (idle, listening, thinking, speaking),
// talking to the same assistant API as the full app (/api/assistant/...).
// Nothing is sent to anyone from here without her tapping Send on a card.

const $ = (id) => document.getElementById(id);
const orb = $("orb");
const STATUS = {
  idle: "tap to talk",
  listening: "listening, tap to stop",
  thinking: "thinking",
  speaking: "speaking, tap to stop",
  unavailable: "",
};

let conversationId = sessionStorageGet("vp-voice-conversation");
let recognition = null;
let lastInputWasVoice = false;

function sessionStorageGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function sessionStorageSet(key, value) {
  try { value ? sessionStorage.setItem(key, value) : sessionStorage.removeItem(key); } catch { /* private mode */ }
}

function setState(state, statusText) {
  document.body.dataset.state = state;
  $("status").textContent = statusText ?? STATUS[state];
  orb.setAttribute("aria-label", state === "listening" || state === "speaking" ? "Tap to stop" : "Tap to talk");
}

// Each bubble says which language it is in: Tamil, English, or both mixed.
function languageOf(text) {
  const tamil = /[஀-௿]/.test(text);
  const latin = /[A-Za-z]/.test(text);
  if (tamil && latin) return { lang: "ta", label: "in Tamil and English" };
  if (tamil) return { lang: "ta", label: "in Tamil" };
  return { lang: "en", label: "in English" };
}

// Replies may use **bold**; show it as bold instead of printing the stars.
function fillText(node, text) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  node.replaceChildren(...parts.map((part, i) => (i % 2 ? Object.assign(document.createElement("strong"), { textContent: part }) : document.createTextNode(part))));
}

function setBubble(id, text) {
  const node = $(id);
  fillText(node, text);
  const { lang, label } = languageOf(text);
  if (text.trim()) node.lang = lang;
  else node.removeAttribute("lang");
  $(`${id}-lang`).textContent = text.trim() ? label : "";
}

// The heard bubble is shown in English: Tamil-script transcripts are
// rewritten by the server (in parallel, so the reply is not delayed).
let heardTurn = 0;
function showHeard(text) {
  const turn = ++heardTurn;
  if (!/[஀-௿]/.test(text)) return setBubble("heard", text);
  // Never show Tamil letters: wait for the English.
  $("heard").textContent = "…";
  $("heard-lang").textContent = "";
  api("/api/assistant/english", { json: { text } })
    .then(({ english }) => { if (turn === heardTurn) setBubble("heard", english); })
    .catch(() => { if (turn === heardTurn) $("heard").textContent = "(heard you; showing the reply below)"; });
}

function showReply(text) {
  setBubble("reply", text);
}

async function ensureConversation() {
  if (conversationId) return conversationId;
  const convo = await api("/api/assistant/conversations", { json: { kind: "GENERAL" } });
  conversationId = convo.id;
  sessionStorageSet("vp-voice-conversation", conversationId);
  return conversationId;
}

async function ask(text, inputMode) {
  const words = text.trim();
  if (!words) return setState("idle");
  lastInputWasVoice = inputMode === "VOICE";
  showHeard(words);
  $("cards").replaceChildren();
  setState("thinking");
  try {
    const id = await ensureConversation();
    let result;
    try {
      result = await api(`/api/assistant/conversations/${id}/messages`, { json: { text: words, inputMode } });
    } catch (err) {
      // A finished or broken conversation: start a fresh one once and retry.
      if (/start again|New conversation|no longer exists/i.test(err.message)) {
        conversationId = null;
        sessionStorageSet("vp-voice-conversation", null);
        result = await api(`/api/assistant/conversations/${await ensureConversation()}/messages`, { json: { text: words, inputMode } });
      } else {
        throw err;
      }
    }
    showReply(result.reply);
    for (const card of result.cards) {
      if (card.type === "send") $("cards").append(sendCard(card.pending));
      if (card.type === "plan") $("cards").append(await planCard(card.proposalId));
    }
    if (lastInputWasVoice) speak(result.reply);
    else setState("idle");
    loadRail(); // the assistant may have added a task or sent a message
  } catch (err) {
    showReply(err.message);
    setState(/not set up|ANTHROPIC_API_KEY/i.test(err.message) ? "unavailable" : "idle", /not set up|ANTHROPIC_API_KEY/i.test(err.message) ? "assistant not set up" : undefined);
  }
}

// Speaking: read the reply aloud; each spoken word gives the orb one beat.
function speak(text) {
  if (!("speechSynthesis" in window) || !text) return setState("idle");
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/\*\*/g, ""));
  utterance.lang = /[஀-௿]/.test(text) ? "ta-IN" : "en-IN";
  utterance.onstart = () => setState("speaking");
  utterance.onboundary = () => {
    orb.classList.remove("beat");
    void orb.offsetWidth; // restart the beat animation
    orb.classList.add("beat");
  };
  utterance.onend = utterance.onerror = () => {
    orb.classList.remove("beat");
    if (document.body.dataset.state === "speaking") setState("idle");
  };
  window.speechSynthesis.speak(utterance);
}

// Listening: browser speech recognition (free, built into Chrome). Indian
// English by default so her words come back in English; the "speak Tamil"
// switch listens in Tamil, and the page then shows only the English meaning.
const LISTEN_KEY = "vp-voice-listen-lang";
function listenLang() {
  try { return localStorage.getItem(LISTEN_KEY) === "ta-IN" ? "ta-IN" : "en-IN"; } catch { return "en-IN"; }
}
function showListenLang() {
  const tamil = listenLang() === "ta-IN";
  const button = $("listen-lang");
  if (!button) return;
  button.textContent = tamil ? "listening in Tamil: switch to English" : "speak Tamil instead";
  button.setAttribute("aria-pressed", String(tamil));
}
$("listen-lang")?.addEventListener("click", () => {
  try { localStorage.setItem(LISTEN_KEY, listenLang() === "ta-IN" ? "en-IN" : "ta-IN"); } catch {}
  showListenLang();
});
showListenLang();
function listen() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;
  recognition = new Recognition();
  recognition.lang = listenLang();
  recognition.interimResults = true;
  recognition.continuous = false;
  let transcript = "";
  recognition.onstart = () => setState("listening");
  recognition.onresult = (event) => {
    transcript = Array.from(event.results).map((r) => r[0].transcript).join(" ");
    // Tamil mode: convert once, when she has finished speaking.
    if (!/[஀-௿]/.test(transcript)) showHeard(transcript);
    else { $("heard").textContent = "…"; $("heard-lang").textContent = ""; }
  };
  recognition.onerror = (event) => {
    // Opening the app can't always start the microphone by itself; then one tap does.
    if (event.error === "not-allowed" || event.error === "service-not-allowed") setState("idle", "tap the crystal to talk");
    else if (event.error !== "aborted" && event.error !== "no-speech") setState("idle", `didn't catch that (${event.error})`);
  };
  recognition.onend = () => {
    recognition = null;
    if (transcript.trim()) ask(transcript, "VOICE");
    else if (document.body.dataset.state === "listening") setState("idle", "didn't hear anything, tap to try again");
  };
  try {
    recognition.start();
  } catch {
    setState("idle");
  }
}

orb.addEventListener("click", () => {
  const state = document.body.dataset.state;
  if (state === "speaking") {
    window.speechSynthesis.cancel();
    return setState("idle");
  }
  if (state === "listening") return recognition?.stop();
  if (state === "thinking") return;
  window.speechSynthesis?.cancel();
  listen();
});

// Typing works too (spec §4).
$("type-toggle").addEventListener("click", () => {
  const form = $("type-form");
  form.hidden = !form.hidden;
  $("type-toggle").textContent = form.hidden ? "type instead" : "hide keyboard";
  if (!form.hidden) $("type-input").focus();
});
$("type-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("type-input");
  const text = input.value;
  input.value = "";
  ask(text, "TYPED");
});

// Signed out: the PIN sheet.
setUnauthorizedHandler((body) => {
  if (body && body.pinRequired) {
    $("pin").hidden = false;
    $("pin-input").focus();
  }
});
$("pin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/auth/login", { json: { pin: $("pin-input").value } });
    $("pin").hidden = true;
    $("pin-error").textContent = "";
    setState("idle");
    loadRail();
    listenOnOpen();
  } catch (err) {
    $("pin-error").textContent = err.message;
  }
});

// Start: check sign-in and whether voice is available here.
if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
  $("type-form").hidden = false;
  $("type-toggle").hidden = true;
  setState("idle", "voice isn't available in this browser, type instead");
} else {
  setState("idle");
}
initRail();
loadRail();

// Siri-style: opened from the home-screen icon (installed app), it starts
// listening straight away, and again each time she comes back to it.
// In a normal browser tab it waits for a tap. ?listen=1 forces it (for testing).
const openedAsApp = window.matchMedia("(display-mode: standalone)").matches || new URLSearchParams(location.search).has("listen");
function listenOnOpen() {
  if (!openedAsApp || document.hidden || !$("pin").hidden) return;
  if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) return;
  if (document.body.dataset.state !== "idle") return;
  window.speechSynthesis?.cancel();
  listen();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    // Leaving the app: stop listening and talking, like closing Siri.
    recognition?.abort();
    window.speechSynthesis?.cancel();
    if (["listening", "speaking"].includes(document.body.dataset.state)) setState("idle");
  } else {
    listenOnOpen();
  }
});

api("/api/auth/status")
  .then((s) => {
    if (s.pinRequired && !s.signedIn) {
      $("pin").hidden = false;
      $("pin-input").focus();
    } else {
      listenOnOpen();
    }
  })
  .catch(() => {});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
