// Service Worker básico do GuiaZap — permite instalação como app (PWA)
// e guarda em cache os arquivos principais para abrir mais rápido depois da primeira visita.

const CACHE_NAME = 'guiazap-v1';
const ARQUIVOS_PARA_CACHE = [
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/config.js',
  '/favicon-32.png',
  '/favicon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS_PARA_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(nomes.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Deixa passar direto tudo que for API (Supabase, IBGE, ViaCEP) — nunca cacheia dados dinâmicos
  if (event.request.url.includes('supabase.co') || event.request.url.includes('ibge.gov.br') || event.request.url.includes('viacep.com.br')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});