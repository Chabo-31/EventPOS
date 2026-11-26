import { useState } from 'react'
import { db } from '../database/db'
import NumberInput from './NumberInput'

export const defaultPresets=[1000,5000,10000]
export function readPresets(value?:string):number[]{
  try{
    const parsed:unknown=JSON.parse(value??'null')
    if(Array.isArray(parsed)&&parsed.length===3&&parsed.every(n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>0&&n<=999999999))return parsed
  }catch{/* fall back */}
  return defaultPresets
}
export default function CashPresetSettings({values}:{values:number[]}){
  const [editing,setEditing]=useState(false)
  const [draft,setDraft]=useState<string[]>([])
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const save=async()=>{
    if(busy)return
    const nums=draft.map(Number)
    if(nums.length!==3||nums.some(n=>!Number.isSafeInteger(n)||n<1||n>999999999)){setMessage('1～999,999,999円の整数を入力してください');return}
    setBusy(true);setMessage('')
    try{await db.settings.put({key:'cashPresets',value:JSON.stringify(nums)});setEditing(false);setMessage('保存しました')}
    catch(e){setMessage(String(e))}
    finally{setBusy(false)}
  }
  return <section className="cash-preset-settings"><h3>会計金額ボタン</h3>
    {editing?<form onSubmit={e=>{e.preventDefault();void save()}}><fieldset disabled={busy}>{draft.map((v,i)=><label key={i}>ボタン {i+1}（円）<NumberInput min="1" max="999999999" step="1" required value={v} onValueChange={n=>setDraft(old=>old.map((x,j)=>i===j?n:x))}/></label>)}<div className="actions"><button type="button" onClick={()=>{setEditing(false);setMessage('')}}>取消</button><button className="primary" type="submit">保存</button></div><button type="button" onClick={()=>setDraft(defaultPresets.map(String))}>初期値に戻す</button></fieldset></form>:<div className="line"><span>{values.map(n=>'+'+n.toLocaleString()).join(' ／ ')}</span><button onClick={()=>{setDraft(values.map(String));setEditing(true);setMessage('')}}>編集</button></div>}
    <p className="muted">会計画面の金額加算ボタン3個を設定します。</p><p role="status">{message}</p></section>
}
