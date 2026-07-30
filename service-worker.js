const CACHE='lexilift-v4-shell';
const SHELL=['./','./index.html','./assets/styles.css','./assets/app.js','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png','./data/catalog.json'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  if(url.pathname.includes('/data/items-')){
    event.respondWith(caches.open(CACHE).then(async cache=>{const hit=await cache.match(event.request);if(hit)return hit;const response=await fetch(event.request);if(response.ok)cache.put(event.request,response.clone());return response}));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{if(response.ok&&['document','script','style','image','manifest'].includes(event.request.destination)){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy))}return response}).catch(()=>caches.match('./index.html'))));
});
