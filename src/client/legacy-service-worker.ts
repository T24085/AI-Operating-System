const reloadMarker = "aios:legacy-worker-reload";

export async function releaseLegacyServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return false;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (!registrations.length) {
      sessionStorage.removeItem(reloadMarker);
      return false;
    }
    const controlled = Boolean(navigator.serviceWorker.controller);
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ("caches" in globalThis) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
    }
    if (controlled && sessionStorage.getItem(reloadMarker) !== "1") {
      sessionStorage.setItem(reloadMarker, "1");
      return true;
    }
    sessionStorage.removeItem(reloadMarker);
  } catch {
    sessionStorage.removeItem(reloadMarker);
  }
  return false;
}
