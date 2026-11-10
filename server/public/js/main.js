import { api, setUnauthorizedHandler } from "./api.js";
import { initAssistant } from "./assistant.js";
import { initToday, loadMorningList, loadAlerts, loadTasks, loadReminders } from "./today.js";
import { initMessages, loadContacts, loadSent } from "./messages.js";
import { initSettings, showLogin, loadCalendar, loadConnections, loadActivity } from "./settings.js";

function loadAll() {
  const loaders = [loadMorningList, loadAlerts, loadTasks, loadReminders, loadContacts, loadSent, loadCalendar, loadConnections, loadActivity];
  return Promise.allSettled(loaders.map((load) => load()));
}

setUnauthorizedHandler((body) => {
  if (body && body.pinRequired) showLogin();
});

initAssistant();
initToday();
initMessages();
initSettings(loadAll);

api("/api/auth/status")
  .then((status) => (status.pinRequired && !status.signedIn ? showLogin() : loadAll()))
  .catch(() => loadAll());

// Keep the service worker current once notifications were turned on.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistration().then((reg) => reg && reg.update()).catch(() => {});
}
