import { useRef, useState } from 'react'
import { exportBackup, readBackup, restoreBackup } from '../services/backup'
import type { Backup } from '../services/backup'
import type { EventData } from '../services/events'

export default function BackupManager({data,onRestore}:{data:EventData|null;onRestore:()=>void}){
 const [scope,setScope]=useState('all')
 const [preview,setPreview]=useState<Backup|null>(null)
 const [mode,setMode]=useState<'overwrite'|'copy'>('copy')
 const [busy,setBusy]=useState(false)
 const [message,setMessage]=useState('')
 const [error,setError]=useState('')
 const gate=useRef(false)
 const run=async(work:()=>Promise<void>)=>{if(gate.current)return;gate.current=true;setBusy(true);setError('');setMessage('');try{await work()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{gate.current=false;setBusy(false)}}
 const download=()=>void run(async()=>{
  const b=await exportBackup(scope==='all'?undefined:scope)
  const blob=new Blob([JSON.stringify(b)],{type:'application/json'})
  if(blob.size>100*1024*1024)throw new Error('バックアップが100MBを超えています。イベント単位で出力してください')
  const url=URL.createObjectURL(blob)
  const a=document.createElement('a');a.href=url;a.download='EventPOS_'+(b.scope==='all'?'all':'event')+'_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'
  document.body.appendChild(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),60000)
  setMessage('バックアップファイルの出力を開始しました')
 })
 return <section className="backup-manager"><h3>バックアップ・インポート</h3>
  <label htmlFor="backup-scope">出力対象</label><select id="backup-scope" value={scope} disabled={busy} onChange={e=>setScope(e.target.value)}><option value="all">すべてのデータ</option>{data?.events.map(e=><option value={e.id} key={e.id}>{e.name}（{e.date}）</option>)}</select>
  <button className="primary" disabled={busy||!data} onClick={download}>バックアップ出力</button>
  <p className="muted">写真・在庫・会計履歴を含むJSONファイルを保存します。全データ出力には端末設定も含みます。</p>
  <label htmlFor="backup-file">インポートするファイル</label><input id="backup-file" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file){setPreview(null);setMode('copy');void run(async()=>{setPreview(await readBackup(file))})}}}/>
  {preview&&<div className="backup-preview"><h3>インポート内容の確認</h3><p>{preview.scope==='all'?'全データ':'イベント単位'} ／ {new Date(preview.createdAt).toLocaleString('ja-JP')}</p>
   <p>イベント {preview.events.length}件 ／ 単品 {preview.products.length}件 ／ セット {preview.bundles.length}件 ／ 写真 {preview.images.length}件 ／ 会計 {preview.sales.length}件</p>
   {preview.events.map(e=><div className="line" key={e.id}><span>{e.name}（{e.date}）</span><span>{data?.events.some(x=>x.id===e.id)?'同一IDあり':'新規'}</span></div>)}
   <label htmlFor="restore-mode">復元方法</label><select id="restore-mode" value={mode} disabled={busy} onChange={e=>setMode(e.target.value as 'overwrite'|'copy')}><option value="copy">別イベントとして追加</option><option value="overwrite">{preview.scope==='all'?'全データを置き換え':'同一イベントを上書き（なければ追加）'}</option></select>
   <p className="muted">{mode==='copy'?'新しいIDを付与して追加します。元のデータと端末設定は維持します。':preview.scope==='all'?'現在の全イベント・商品・履歴・設定がバックアップ内容に置き換わります。':'同一IDのイベントと商品・履歴を置き換えます。他のイベント・端末設定は維持します。'}</p>
   <div className="actions"><button disabled={busy} onClick={()=>setPreview(null)}>取消</button><button className="primary" disabled={busy} onClick={()=>{if(mode==='overwrite'&&!window.confirm('現在のデータを上書きします。事前にバックアップを保存しましたか？'))return;void run(async()=>{await restoreBackup(preview,mode);onRestore();setPreview(null);setMessage('インポートが完了しました')})}}>インポート確定</button></div>
  </div>}
  {busy&&<p role="status">処理中…</p>}{message&&<p className="inventory-notice" role="status">{message}</p>}{error&&<p className="sale-error" role="alert">{error}</p>}
 </section>
}
