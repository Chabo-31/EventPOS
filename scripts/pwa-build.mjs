import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
const root='dist'
async function walk(dir){
 const entries=await readdir(dir,{withFileTypes:true})
 return (await Promise.all(entries.map(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]))).flat()
}
const paths=(await walk(root)).filter(p=>!p.endsWith('sw.js')&&!p.endsWith('.map')).sort()
const hash=createHash('sha256')
hash.update(await readFile(new URL(import.meta.url)))
for(const p of paths){hash.update(p);hash.update(await readFile(p))}
const version=hash.digest('hex').slice(0,20)
const urls=paths.map(p=>'./'+p.slice(root.length+1).replaceAll('\\','/'))
const source=`const VERSION=${JSON.stringify(version)};
const FILES=${JSON.stringify(urls)};
const scope=self.registration.scope;
const PREFIX='eventpos-v3:'+scope+':';
const CACHE=PREFIX+VERSION;
const absolute=FILES.map(p=>new URL(p,scope).href);
const shell=new URL('index.html',scope).href;
const assetRoot=new URL('assets/',scope).href;
function valid(response,url){
 if(!response||!response.ok)return false;
 const type=response.headers.get('content-type')||'';
 const path=new URL(url).pathname;
 if(/\\.m?js$/i.test(path))return /javascript|ecmascript/i.test(type);
 if(/\\.css$/i.test(path))return /text\\/css/i.test(type);
 if(/\\.html$/i.test(path))return /text\\/html/i.test(type);
 if(/\\.png$/i.test(path))return /image\\/png/i.test(type);
 return !/text\\/html/i.test(type);
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE);
 try{
  for(const url of absolute){
   const response=await fetch(new Request(url,{cache:'reload'}));
   if(!valid(response,url))throw new Error('Invalid precache response: '+url);
   await cache.put(url,response);
  }
 }catch(error){await caches.delete(CACHE);throw error;}
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 // Do not delete older caches here: existing tabs can still need their hashed assets.
 await self.clients.claim();
})()));
self.addEventListener('message',event=>{
 if(event.data?.type==='ACTIVATE_UPDATE')event.waitUntil(self.skipWaiting());
 if(event.data?.type==='CHECK_OFFLINE'&&event.ports[0])event.waitUntil((async()=>{
  try{
   const cache=await caches.open(CACHE);
   const missing=[];
   for(const url of absolute)if(!valid(await cache.match(url,{ignoreVary:true}),url))missing.push(url);
   event.ports[0].postMessage({ready:missing.length===0,count:absolute.length-missing.length,total:absolute.length,version:VERSION});
  }catch{event.ports[0].postMessage({ready:false,count:0,total:absolute.length,version:VERSION});}
 })());
});
async function cachedAsset(request){
 const current=await caches.open(CACHE);
 const own=await current.match(request.url,{ignoreVary:true});
 if(valid(own,request.url))return own;
 for(const name of (await caches.keys()).filter(n=>n.startsWith(PREFIX)&&n!==CACHE).reverse()){
  const previous=await (await caches.open(name)).match(request.url,{ignoreVary:true});
  if(valid(previous,request.url))return previous;
 }
 try{const response=await fetch(request);if(valid(response,request.url))return response;}catch{}
 return new Response('Asset unavailable',{status:503,headers:{'Content-Type':'text/plain'}});
}
async function navigation(request){
 const cache=await caches.open(CACHE);
 const html=await cache.match(shell,{ignoreVary:true});
 // Only serve the cached shell if its complete hashed asset set is still available.
 if(valid(html,shell)){
  const checks=await Promise.all(absolute.filter(u=>u.startsWith(assetRoot)).map(async u=>valid(await cache.match(u,{ignoreVary:true}),u)));
  if(checks.every(Boolean))return html;
 }
 try{const response=await fetch(request,{cache:'no-store'});if(valid(response,shell))return response;}catch{}
 return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><title>EventPOS</title><p>アプリのファイルが不足しています。オンラインに接続して再読み込みしてください。</p></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
}
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||!request.url.startsWith(scope))return;
 if(request.mode==='navigate'){event.respondWith(navigation(request));return;}
 if(absolute.includes(request.url)||request.url.startsWith(assetRoot))event.respondWith(cachedAsset(request));
});
`;
await writeFile(join(root,'sw.js'),source)
console.log('PWA precache:',version,urls.length,'files')
