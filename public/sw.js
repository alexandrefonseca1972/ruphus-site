// Service worker do painel instalado (registrado só pelo painel, em www.ruphus.site).
//
// - /_next/static: cache primeiro (os nomes mudam a cada build, o conteúdo nunca).
// - páginas: rede primeiro; sem rede, a última cópia daquela página ou /offline.html.
// - outros arquivos da origem: rede; sem rede, a cópia guardada (o ícone do offline.html).
//   O HTML do painel é só a casca: os dados vêm do Firestore, que tem cache próprio.
// - POST (server actions), outros domínios (Firestore, fontes) e /api: direto à rede.
// - push: mostra o aviso de agendamento; o clique abre o painel na página do aviso.
const VERSAO = "v1";
const ESTATICO = `estatico-${VERSAO}`;
const PAGINAS = `paginas-${VERSAO}`;
const BASE = ["/offline.html", "/app/icone-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(PAGINAS).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== ESTATICO && n !== PAGINAS).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.open(ESTATICO).then(async (c) => {
        const guardado = await c.match(req);
        if (guardado) return guardado;
        const r = await fetch(req);
        if (r.ok) c.put(req, r.clone());
        return r;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => {
          if (r.ok) {
            const copia = r.clone();
            caches.open(PAGINAS).then((c) => c.put(req, copia));
          }
          return r;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match("/offline.html"))),
    );
    return;
  }

  // o resto (ícones, imagens de public/): rede, e sem ela o que estiver guardado
  e.respondWith(fetch(req).catch(async () => (await caches.match(req)) || Response.error()));
});

self.addEventListener("push", (e) => {
  if (!e.data) return;
  let d;
  try {
    d = e.data.json();
  } catch {
    d = { title: "Ruphus", body: e.data.text() };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "Ruphus", {
      body: d.body || "",
      icon: "/app/icone-192.png",
      badge: "/app/icone-192.png",
      tag: d.tag,
      data: { url: d.url || "/painel" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const alvo = new URL(e.notification.data?.url || "/painel", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((abertos) => {
      // painel já aberto: leva a aba para a página do aviso em vez de abrir outra
      const aba = abertos.find((c) => new URL(c.url).origin === self.location.origin);
      if (aba) return aba.focus().then(() => aba.navigate(alvo));
      return self.clients.openWindow(alvo);
    }),
  );
});
