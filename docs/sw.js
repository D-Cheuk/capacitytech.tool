// Mude V ao alterar index.html, modelo.docx ou bibliotecas, para forçar atualização.
const V = "v1";
const SHELL = ["./", "index.html", "modelo.docx", "lib/pizzip.min.js", "lib/docxtemplater.js", "data.json", "pubkey.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const dinamico = /\/(data|pubkey)\.json$/.test(new URL(e.request.url).pathname);
  e.respondWith(dinamico
    // dados: tenta a rede (pega atualização e revogação); sem rede, usa o cache
    ? fetch(e.request, {cache: "no-store"})
        .then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; })
        .catch(() => caches.match(e.request))
    // demais arquivos: cache primeiro
    : caches.match(e.request).then(r => r || fetch(e.request)));
});
