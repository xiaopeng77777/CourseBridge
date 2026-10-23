// Render the original SVG at native pixel sizes; preserve an editable vector source.
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright-core');
const root=path.join(__dirname,'..'),assets=path.join(root,'desktop/assets');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.COURSEBRIDGE_CHROME,headless:true});
 try{
  const page=await browser.newPage();const svg=fs.readFileSync(path.join(assets,'app.svg'),'utf8');
  const sizes=[16,20,24,32,40,48,64,96,128,256,512],frames=[];
  for(const size of sizes){
   const rendered=await page.evaluate(async({svg,size})=>{const img=new Image();img.src='data:image/svg+xml;base64,'+btoa(svg);await img.decode();const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,size,size);return{png:c.toDataURL('image/png').split(',')[1],rgba:[...ctx.getImageData(0,0,size,size).data]};},{svg,size});
   const png=Buffer.from(rendered.png,'base64');fs.writeFileSync(path.join(assets,`icon-${size}.png`),png);
   if(size>256)continue;
   let data=png;
   if(size<=48){const stride=Math.ceil(size/32)*4;data=Buffer.alloc(40+size*size*4+stride*size);data.writeUInt32LE(40,0);data.writeInt32LE(size,4);data.writeInt32LE(size*2,8);data.writeUInt16LE(1,12);data.writeUInt16LE(32,14);data.writeUInt32LE(size*size*4,20);
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){const src=(y*size+x)*4,dst=40+((size-1-y)*size+x)*4;data[dst]=rendered.rgba[src+2];data[dst+1]=rendered.rgba[src+1];data[dst+2]=rendered.rgba[src];data[dst+3]=rendered.rgba[src+3];if(!rendered.rgba[src+3])data[40+size*size*4+(size-1-y)*stride+Math.floor(x/8)]|=1<<(7-x%8);}
   }
   frames.push({size,data});
  }
  const header=Buffer.alloc(6+frames.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(frames.length,4);let offset=header.length;
  frames.forEach(({size,data},index)=>{const o=6+index*16;header[o]=header[o+1]=size===256?0:size;header.writeUInt16LE(1,o+4);header.writeUInt16LE(32,o+6);header.writeUInt32LE(data.length,o+8);header.writeUInt32LE(offset,o+12);offset+=data.length;});
  fs.writeFileSync(path.join(assets,'app.ico'),Buffer.concat([header,...frames.map(f=>f.data)]));
  const ext=path.join(root,'extension/icons');fs.mkdirSync(ext,{recursive:true});for(const size of [16,32,48,128])fs.copyFileSync(path.join(assets,`icon-${size}.png`),path.join(ext,`icon-${size}.png`));
  console.log(JSON.stringify({sizes:sizes,icoFrames:frames.length,vector:'desktop/assets/app.svg'}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
