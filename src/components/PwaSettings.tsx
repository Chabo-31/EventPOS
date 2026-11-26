import { useEffect, useState } from 'react'
import { pwa, subscribePwa, checkUpdate, applyUpdate, installApp } from '../services/pwa'

function formatVersion(value:string){
 const date=new Date(value)
 if(Number.isNaN(date.getTime()))return value
 return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(date)+' JST'
}

export default function PwaSettings(){
 const [state,setState]=useState({...pwa})
 const [message,setMessage]=useState('')
 const [busy,setBusy]=useState(false)
 useEffect(()=>{const sync=()=>setState({...pwa});const unsubscribe=subscribePwa(sync);sync();return unsubscribe},[])
 const update=async()=>{setBusy(true);setMessage('');try{await checkUpdate();setMessage(pwa.update?'新しいバージョンがあります':'更新確認が完了しました')}catch(e){setMessage(String(e))}finally{setBusy(false)}}
 return <section className="pwa-settings">
  <h3>アプリ・オフライン</h3>
  <div className="line"><span>通信状態</span><strong>{state.online?'オンライン':'オフライン'}</strong></div>
  <div className="line"><span>オフライン準備</span><strong>{state.ready?'完了':state.development?'開発モード':state.error?'準備失敗':'準備中・未対応'}</strong></div>
  <div className="line"><span>起動形式</span><strong>{state.installed?'アプリ':'ブラウザ'}</strong></div>
  <div className="line"><span>アプリバージョン</span><span>{formatVersion(state.version)}</span></div>
  {state.installable&&<button className="primary" onClick={()=>void installApp().catch(e=>setMessage(String(e)))}>アプリをインストール</button>}
  {!state.installed&&!state.installable&&<p className="muted">iPhone・iPadはSafariの共有メニューから「ホーム画面に追加」、PC・Androidはブラウザのインストールメニューを使用してください。</p>}
  <p className="muted">最初はオンラインで起動し、準備完了を確認してください。データは端末内に保存されます。定期的にバックアップしてください。</p>
  <button disabled={busy||!state.online||state.development} onClick={()=>void update()}>{busy?'確認中…':'更新を確認'}</button>
  {state.update&&<div className="inventory-notice"><strong>新しいバージョンがあります</strong><p>会計・編集を完了し、バックアップを保存してから更新してください。</p><button className="primary" onClick={()=>{if(window.confirm('未確定の会計・編集中の内容がないことを確認しましたか？'))applyUpdate()}}>アプリを更新</button></div>}
  {state.error&&<p className="sale-error" role="alert">{state.error}</p>}{message&&<p role="status">{message}</p>}
 </section>
}
