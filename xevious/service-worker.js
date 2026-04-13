const CACHE_NAME = "xevious-board-v3";
const APP_FILES = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.webmanifest",
    "./icon.svg"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES))
    );
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") {
        return;
    }

    const requestUrl = new URL(event.request.url);
    const isLocalAsset = requestUrl.origin === self.location.origin;
    const isDynamicData = requestUrl.pathname.endsWith("/dashboard-data.js") || requestUrl.pathname.endsWith("dashboard-data.js");
    const isPageAsset =
        requestUrl.pathname.endsWith("/") ||
        requestUrl.pathname.endsWith("/index.html") ||
        requestUrl.pathname.endsWith("index.html") ||
        requestUrl.pathname.endsWith(".css") ||
        requestUrl.pathname.endsWith(".js") ||
        requestUrl.pathname.endsWith(".webmanifest");

    if (isDynamicData || (isLocalAsset && isPageAsset)) {
        event.respondWith(
            fetch(event.request, { cache: "no-store" })
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) {
                return cached;
            }

            return fetch(event.request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
                    return response;
                })
                .catch(() => caches.match("./index.html"));
        })
    );
});
