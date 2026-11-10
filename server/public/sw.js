// Service worker: shows notifications pushed by the server and confirms
// reminder delivery (spec §10: "Each reminder logs sent and delivered status").
self.addEventListener("push", (event) => {
  let message = { title: "Vice Principal AI", body: "", data: {} };
  try {
    message = event.data ? event.data.json() : message;
  } catch (_) {
    message.body = event.data ? event.data.text() : "";
  }
  const data = message.data || {};
  const shown = self.registration.showNotification(message.title, {
    body: message.body,
    data,
    tag: data.reminderId || data.eventId || data.date || undefined,
    renotify: true,
  });
  const confirm = data.reminderId
    ? fetch(`/api/reminders/${encodeURIComponent(data.reminderId)}/delivered`, { method: "POST", credentials: "include" }).catch(() => {})
    : Promise.resolve();
  event.waitUntil(Promise.all([shown, confirm]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        if ("focus" in win) {
          win.navigate(url).catch(() => {});
          return win.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
