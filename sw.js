const CACHE_NAME = "gramotey-v1.0.5";

const APP_SHELL = [
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/rules.js",
  "./js/languagetool.js",
  "./js/ai.js",
  "./js/diff.js",
  "./js/store.js",
  "./js/utils.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Запросы к LanguageTool и ИИ не кешируем и не перехватываем.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  event.respondWith(handleAsset(request));
});

async function handleNavigation(request) {
  try {
    const response = await fetch(request);

    // Кешируем только успешные ответы. Прокси/хостинг может вернуть 502 —
    // такой ответ нельзя сохранять, иначе офлайн откроется пустая страница.
    if (response && response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      return response;
    }

    const cachedShell = await caches.match("./index.html");
    if (cachedShell) return cachedShell;
    return response;
  } catch {
    const cachedShell = await caches.match("./index.html");
    if (cachedShell) return cachedShell;

    return new Response("Приложение ещё не сохранено для офлайн-режима. Откройте его один раз с интернетом.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

async function handleAsset(request) {
  const cached = await caches.match(request);
  if (cached && cached.ok) return cached;

  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch {
    if (cached) return cached;
    return new Response("", { status: 504 });
  }
}
