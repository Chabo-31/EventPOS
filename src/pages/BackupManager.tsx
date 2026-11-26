import { useRef, useState } from 'react'
import { exportBackup, readBackup, restoreBackup, inspectRestore } from '../services/backup'
import type { Backup, RestorePlan } from '../services/backup'
import type { EventData } from '../services/events'

export default function BackupManager({data,onRestore}:{data:EventData|null;onRestore:()=>void}){
 const [scope,setScope]=useState('all')
 const [preview,setPreview]=useState<Backup|null>(null)
 const [plan,setPlan]=useState<RestorePlan|null>(null)
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
  <label htmlFor="backup-file">インポートするファイル</label><input id="backup-file" type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file){setPreview(null);setPlan(null);void run(async()=>{const b=await readBackup(file);const checked=await inspectRestore(b);setPreview(b);setPlan(checked)})}}}/>
  {preview&&<div className="backup-preview"><h3>インポート内容の確認</h3><p>{preview.scope==='all'?'全データ':'イベント単位'} ／ {new Date(preview.createdAt).toLocaleString('ja-JP')}</p>
   <p>イベント {preview.events.length}件 ／ 単品 {preview.products.length}件 ／ セット {preview.bundles.length}件 ／ 写真 {preview.images.length}件 ／ 会計 {preview.sales.length}件</p>
   {plan&&<>
    {plan.rows.map(r=><article className="history-card" key={r.id}><div className="line"><strong>{r.name}</strong><strong>{({new:'新規登録',same:'変更なし',update:'上書き可能',conflict:'競合'})[r.status]}</strong></div>
      {r.changes.map(c=><p className="muted" key={c.label}>{c.label}：追加 {c.added} ／ 変更 {c.changed} ／ 削除 {c.removed}</p>)}
      {r.reasons.map(s=><p className="sale-error" key={s}>{s}</p>)}
    </article>)}
    {plan.conflicts.map(s=><p className="sale-error" key={s}>{s}</p>)}
    <p className="muted">ファイルにないイベントと既存の端末設定は維持します。未登録の設定・旧商品は追加します（設定 {plan.settings}件、旧商品 {plan.legacy}件）。競合がある場合は全件のインポートを停止します。</p>
    <div className="actions"><button disabled={busy} onClick={()=>{setPreview(null);setPlan(null)}}>取消</button><button className="primary" disabled={busy||plan.conflicts.length>0||plan.rows.some(r=>r.status==='conflict')} onClick={()=>{if(plan.rows.some(r=>r.status==='update')&&!window.confirm('表示された差分で既存イベントを上書きしますか？'))return;void run(async()=>{const count=await restoreBackup(preview,plan);onRestore();setPreview(null);setPlan(null);setMessage('インポート完了：更新・新規登録 '+count+'イベント')})}}>インポート確定</button></div>
   </>}

  </div>}
  {busy&&<p role="status">処理中…</p>}{message&&<p className="inventory-notice" role="status">{message}</p>}{error&&<p className="sale-error" role="alert">{error}</p>}
 </section>
}
