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

// Service worker on every visit: lets the phone install the app (icon on the
// home screen, opens full-screen) and receive notifications.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").then((reg) => reg.update()).catch(() => {});
}
