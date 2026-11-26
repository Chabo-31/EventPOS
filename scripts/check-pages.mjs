import { readFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const root=resolve('dist')
const html=await readFile(resolve(root,'index.html'),'utf8')
const manifest=JSON.parse(await readFile(resolve(root,'manifest.webmanifest'),'utf8'))
const worker=await readFile(resolve(root,'sw.js'),'utf8')
assert.equal(manifest.start_url,'./')
assert.equal(manifest.scope,'./')
assert.equal(manifest.display,'standalone')
const files=JSON.parse(worker.match(/^const FILES=(.*);$/m)[1])
for(const name of files)await access(resolve(root,name))
for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
 const path=match[1]
 assert.ok(path.startsWith('./'),'Non-relative asset: '+path)
 assert.ok(files.includes(path),'Asset not precached: '+path)
}
for(const icon of manifest.icons)assert.ok(files.includes('./'+icon.src),'Icon not precached: '+icon.src)
assert.ok(files.includes('./index.html'))
assert.ok(files.includes('./manifest.webmanifest'))
assert.ok(files.includes('./icons/apple-touch-icon.png'))
console.log('Pages build verified:',files.length,'precached files')
