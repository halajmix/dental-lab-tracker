// Removing a Workbox route does not delete its existing runtime cache.
// Purge it when the replacement worker activates, without touching drafts,
// queued changes, or the static app shell.
self.addEventListener("activate", (event) => {
  event.waitUntil(self.caches.delete("supabase-api"));
});
