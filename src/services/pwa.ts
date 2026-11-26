interface InstallPrompt extends Event {
 prompt():Promise<void>
 userChoice:Promise<{outcome:'accepted'|'dismissed'}>
}
const display=window.matchMedia('(display-mode: standalone)')
const standalone=()=>display.matches||(navigator as Navigator & {standalone?:boolean}).standalone===true
export const pwa={online:navigator.onLine,installed:standalone(),ready:false,cacheCount:0,cacheTotal:0,update:false,installable:false,development:import.meta.env.DEV,error:'',version:import.meta.env.VITE_BUILD_ID??'開発版'}
const listeners=new Set<()=>void>()
const notify=()=>listeners.forEach(fn=>fn())
export function subscribePwa(fn:()=>void){listeners.add(fn);return ()=>{listeners.delete(fn)}}
let registration:ServiceWorkerRegistration|undefined
let prompt:InstallPrompt|undefined
let reloading=false
let started=false
let checkSequence=0
function verifyOffline(){
 const sequence=++checkSequence
 const worker=navigator.serviceWorker?.controller
 pwa.ready=false;pwa.cacheCount=0;pwa.cacheTotal=0
 if(!worker){notify();return}
 const channel=new MessageChannel()
 const timeout=window.setTimeout(()=>{channel.port1.close();if(sequence===checkSequence){pwa.ready=false;notify()}},4000)
 channel.port1.onmessage=event=>{
  window.clearTimeout(timeout);channel.port1.close()
  if(sequence!==checkSequence)return
  const result=event.data
  pwa.ready=result?.ready===true;pwa.cacheCount=Number(result?.count)||0;pwa.cacheTotal=Number(result?.total)||0;notify()
 }
 worker.postMessage({type:'CHECK_OFFLINE'},[channel.port2])
}
function refresh(){pwa.online=navigator.onLine;pwa.installed=standalone();pwa.update=!!registration?.waiting;pwa.installable=!!prompt&&!pwa.installed;notify()}
function refreshAndVerify(){refresh();verifyOffline()}
export async function installApp(){if(!prompt)return;const current=prompt;prompt=undefined;refresh();await current.prompt();await current.userChoice}
export async function checkUpdate(){if(!registration)throw new Error('Service Workerが準備できていません');await registration.update();refresh()}
export function applyUpdate(){if(registration?.waiting){reloading=true;registration.waiting.postMessage({type:'ACTIVATE_UPDATE'})}}
export function startPwa(){
 if(started)return;started=true
 window.addEventListener('online',refreshAndVerify);window.addEventListener('offline',refreshAndVerify);display.addEventListener('change',refresh)
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();prompt=e as InstallPrompt;refresh()})
 window.addEventListener('appinstalled',()=>{prompt=undefined;refresh()})
 if(import.meta.env.DEV||!('serviceWorker' in navigator)){refresh();return}
 navigator.serviceWorker.addEventListener('controllerchange',()=>{refreshAndVerify();if(reloading){reloading=false;window.location.reload()}})
 void navigator.serviceWorker.register(import.meta.env.BASE_URL+'sw.js',{updateViaCache:'none'}).then(r=>{
  registration=r
  r.addEventListener('updatefound',()=>{const worker=r.installing;worker?.addEventListener('statechange',refresh);refresh()})
  refreshAndVerify();void navigator.serviceWorker.ready.then(refreshAndVerify)
 }).catch(e=>{pwa.error='オフライン準備に失敗：'+String(e);notify()})
}
