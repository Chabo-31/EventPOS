import { mkdir, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

function crc32(bytes){
 let c=0xffffffff
 for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0)}
 return (c^0xffffffff)>>>0
}
function chunk(type,data){
 const t=Buffer.from(type),n=Buffer.alloc(4),crc=Buffer.alloc(4)
 n.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])))
 return Buffer.concat([n,t,data,crc])
}
function rounded(x,y,left,top,w,h,r){
 const dx=Math.max(left+r-x,0,x-(left+w-r)),dy=Math.max(top+r-y,0,y-(top+h-r))
 return x>=left&&x<left+w&&y>=top&&y<top+h&&dx*dx+dy*dy<=r*r
}
function png(size,maskable){
 const raw=Buffer.alloc((size*4+1)*size),blue=[53,99,142,255],white=[255,255,255,255],screen=[219,232,245,255]
 const keys=[[164,224,46,46],[233,224,46,46],[302,224,46,46],[164,290,46,46],[233,290,46,46],[302,290,46,110],[164,354,115,46]]
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const px=(x+.5)*512/size,py=(y+.5)*512/size
  let color=maskable||rounded(px,py,0,0,512,512,104)?blue:[0,0,0,0]
  if(rounded(px,py,134,86,244,340,35))color=white
  if(rounded(px,py,162,115,188,82,12))color=screen
  if(keys.some(([l,t,w,h])=>rounded(px,py,l,t,w,h,10)))color=blue
  const offset=y*(size*4+1)+1+x*4;raw.set(color,offset)
 }
 const head=Buffer.alloc(13);head.writeUInt32BE(size);head.writeUInt32BE(size,4);head[8]=8;head[9]=6
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])
}
await mkdir('dist/icons',{recursive:true})
for(const [name,size,maskable] of [['icon-192.png',192,false],['icon-512.png',512,false],['maskable-512.png',512,true],['apple-touch-icon.png',180,true]])await writeFile('dist/icons/'+name,png(size,maskable))
