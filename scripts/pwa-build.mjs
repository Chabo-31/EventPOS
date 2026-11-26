import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
const root='dist'
async function walk(dir){
 const entries=await readdir(dir,{withFileTypes:true})
 const paths=await Promise.all(entries.map(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]))
 return paths.flat()
}
const paths=(await walk(root)).filter(p=>!p.endsWith('sw.js')&&!p.endsWith('.map')).sort()
const hash=createHash('sha256')
for(const p of paths){hash.update(p);hash.update(await readFile(p))}
const version=hash.digest('hex').slice(0,20)
const urls=paths.map(p=>'./'+p.slice(root.length+1).replaceAll('\\','/'))
const source=`const CACHE='eventpos-'+${JSON.stringify(version)};
const FILES=${JSON.stringify(urls)};
const scope=self.registration.scope;
const absolute=FILES.map(p=>new URL(p,scope).href);
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 try{await cache.addAll(absolute.map(url=>new Request(url,{cache:'reload'})));}
 catch(error){await caches.delete(CACHE);throw error;}
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 // Keep the previous version's cache for tabs still running an older app shell.
 const names=(await caches.keys()).filter(n=>n.startsWith('eventpos-')&&n!==CACHE);
 for(const name of names.slice(0,-1))await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||!request.url.startsWith(scope))return;
 if(request.mode==='navigate'){
  event.respondWith((async()=>{const cache=await caches.open(CACHE);return (await cache.match(new URL('index.html',scope).href))||fetch(request);})());return;
 }
 if(!absolute.includes(request.url))return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);return (await cache.match(request))||fetch(request);})());
});
`;
await writeFile(join(root,'sw.js'),source)
console.log('PWA precache:',version,urls.length,'files')
