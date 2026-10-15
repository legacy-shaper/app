/* Legacy Shaper — client app service worker.
   The app opens instantly and offline; collection data never passes through this cache (Supabase is always live). */
const VERSION = "ls-client-5a3dd8c1";
const APP = ["./", "./index.html", "./manifest.webmanifest", "./apple-touch-icon.png", "./icon-192.png", "./icon-512.png", "./room-chair.webp", "./room-parquet.jpg"];
const EXTERNAL = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500&family=Hanken+Grotesk:wght@300;400;500;600&display=swap"
];
const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

const END_MARK = "<!--ls-end-->";
const htmlResp = t => new Response(t, { headers: { "Content-Type": "text/html; charset=utf-8" } });
async function completePage(req) {             // the whole page or an error — never a half page
  const r = await fetch(req, { cache: "no-store" });
  if (!r.ok) throw new Error("http " + r.status);
  const t = await r.text();
  if (t.indexOf(END_MARK) < 0) throw new Error("incomplete page");
  return t;
}
async function keptPage() {                     // last complete copy on the device (checked, a damaged copy is dropped)
  const c = await caches.open(VERSION);
  for (const k of ["./index.html", "./"]) {
    const hit = await c.match(k, { ignoreSearch: true }); if (!hit) continue;
    const t = await hit.text(); if (t.indexOf(END_MARK) >= 0) return t;
    await c.delete(k);
  }
  return null;
}
async function cachePage(u) {                   // install: refuse to keep an incomplete page
  const t = await completePage(new Request(u, { cache: "reload" }));
  const c = await caches.open(VERSION); await c.put(u, htmlResp(t));
}
async function openApp(e) {
  const kept = await keptPage();
  const fresh = completePage(e.request).then(async t => { const c = await caches.open(VERSION); await c.put("./index.html", htmlResp(t)); return t; });
  if (!kept) { try { return htmlResp(await fresh); } catch (err) { return fetch(e.request); } }   // very first opening
  e.waitUntil(fresh.catch(() => {}));           // a slow network finishes in the background, ready for the next opening
  try { return htmlResp(await within(fresh, 2500)); } catch (err) { return htmlResp(kept); }
}

self.addEventListener("install", e => { e.waitUntil((async () => {
  const c = await caches.open(VERSION);
  await Promise.all(APP.map(async u => { if (u === "./" || u === "./index.html") return cachePage(u);   // only a COMPLETE page is kept
    try { const r = await fetch(new Request(u, { cache: "reload" })); if (r.ok) await c.put(u, r); } catch (err) {} }));
  await Promise.all(EXTERNAL.map(async u => { try { const r = await fetch(u, { mode: "cors" }); if (r.ok) await c.put(u, r); } catch (err) {} }));
  self.skipWaiting();
})()); });
self.addEventListener("activate", e => { e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("ls-client-") && k !== VERSION) await caches.delete(k);
  await self.clients.claim();
})()); });
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return;
  if (req.mode === "navigate" && new URL("./", self.location).pathname !== url.pathname && !url.pathname.endsWith("/index.html")) return;   // other pages of the site (questionnaire, signatures…) are not the app: never cached as it
  if (req.mode === "navigate") { e.respondWith(openApp(e)); return; }   // boot guard: complete page (fresh within 2.5 s) or the last complete copy
  e.respondWith((async () => { const hit = await caches.match(req); if (hit) return hit;
    try { const r = await within(fetch(req), 15000); const ok = r.ok || r.type === "opaque";
      if (ok && (url.origin === self.location.origin || EXTERNAL.includes(req.url) || url.hostname === "fonts.gstatic.com")) { const c = await caches.open(VERSION); c.put(req, r.clone()); }
      return r; }
    catch (err) { return Response.error(); } })());
});
