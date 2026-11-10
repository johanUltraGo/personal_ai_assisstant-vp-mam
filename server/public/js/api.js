// Shared helpers: API calls (with the PIN prompt on 401) and small DOM builders.
// All text from the server is inserted with textContent, never as HTML.

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export async function api(url, options = {}) {
  const init = { credentials: "same-origin", ...options };
  if (init.json !== undefined) {
    init.method = init.method || "POST";
    init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
    init.body = JSON.stringify(init.json);
    delete init.json;
  }
  const res = await fetch(url, init);
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    onUnauthorized(body);
    throw new Error(body.error || "Please sign in.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = typeof body.error === "string" ? body.error : body.error ? describeValidation(body.error) : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

function describeValidation(error) {
  const fields = Object.entries(error.fieldErrors || {}).map(([k, v]) => `${k}: ${v.join(", ")}`);
  return [...(error.formErrors || []), ...fields].join("; ") || "Please check the form.";
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function button(label, onClick, cls) {
  const b = el("button", { type: "button", class: cls }, label);
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await onClick();
    } catch (err) {
      alert(err.message);
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

export const fmtDateTime = (v) => new Date(v).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtTime = (v) => new Date(v).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
export const fmtDay = (v) => new Date(v).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "long", year: "numeric" });

/** ISO string → value for <input type="datetime-local"> in local time. */
export function toLocalInput(value) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** Tiny event bus so sections refresh each other after changes. */
const listeners = {};
export function on(event, fn) {
  (listeners[event] ||= []).push(fn);
}
export function emit(event) {
  for (const fn of listeners[event] || []) Promise.resolve(fn()).catch(() => {});
}
