const MAX_PARTS=16,MAX_TOTAL=6*1024*1024;
function imageError(message) { const error=new Error(message);error.imageError=true;return error; }
function tilePlan(width,height) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>30000000)throw imageError('图片尺寸不受支持，请手动核对本题');
  const columns=positions(width,1280),rows=positions(height,1400),tiles=[];
  for(const y of rows)for(const x of columns)tiles.push({x,y,width:Math.min(1280,width-x),height:Math.min(1400,height-y)});
  if(tiles.length>MAX_PARTS)throw imageError('题目长图需要的分段过多，已停止自动分析，请手动核对');
  return tiles;
}
function positions(length,size) {if(length<=size)return [0];const result=[];for(let n=0;n<length;n+=size-80){const value=Math.min(n,length-size);if(result.at(-1)!==value)result.push(value);if(value+size>=length)break;}return result;}
const courseFrame=frame=>{try{const url=new URL(frame.url());return url.protocol==='https:'&&(url.hostname==='chaoxing.com'||url.hostname.endsWith('.chaoxing.com'));}catch{return false;}};
function createQuestionImageReader({getContext,nativeImage}) {
  const cache=new Map();let total=0;
  async function locate(context,descriptor) {
    if(!/^[a-zA-Z0-9-]{1,80}$/.test(descriptor.id)||!/^[a-f0-9]{16}$/.test(descriptor.key))throw imageError('题目图片标识不正确，未发起分析');
    const found=[];
    for(const page of context.pages())for(const frame of page.frames()) {
      if(!courseFrame(frame)&&!(frame.url()==='about:blank'&&frame.parentFrame()&&courseFrame(frame.parentFrame())))continue;
      const locator=frame.locator(`[data-coursebridge-image-id="${descriptor.id}"]`);
      if(await locator.count()===1)found.push(locator);
    }
    if(found.length!==1)throw imageError('题目图片已切换或页面已关闭，未发起分析');
    const locator=found[0];
    const info=await locator.evaluate(el=>{
      const key=el.getAttribute('data-coursebridge-image-key'),tag=el.tagName.toLowerCase(),background=el.getAttribute('data-coursebridge-image-kind')==='background'&&/url\(/i.test(getComputedStyle(el).backgroundImage);
      let src=el.currentSrc||el.src||'';
      if(tag==='canvas'){try{src=el.toDataURL('image/png');}catch{src='';}}
      return {key,tag,background,src,complete:tag!=='img'||(el.complete&&el.naturalWidth>0)};
    });
    if(info.key!==descriptor.key||(!['img','svg','canvas'].includes(info.tag)&&!info.background)||!info.complete)throw imageError('题目图片尚未完整加载或已变化，未发起分析');
    return {locator,info};
  }
  async function raster(context,locator,info,signal) {
    let bytes;
    try {
      if(/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(info.src)&&info.src.length<12*1024*1024)bytes=Buffer.from(info.src.slice(info.src.indexOf(',')+1),'base64');
      else if(info.src) {
        const url=new URL(info.src);
        if(url.protocol==='https:'&&(url.hostname==='chaoxing.com'||url.hostname.endsWith('.chaoxing.com'))) {
          // Read only this attested page image, with the browser's own session.
          // Never forward its URL, cookies or headers to the AI provider.
          const response=await context.request.get(url.href,{timeout:12000,maxRedirects:0});
          if(response.ok()&&/^image\//i.test(response.headers()['content-type']||'')&&Number(response.headers()['content-length']||0)<=8*1024*1024)bytes=await response.body();
        }
      }
    }catch { /* Cookie-protected or external images can still be read as a bounded element crop. */ }
    if(signal?.aborted)throw imageError('任务已暂停，图片分析已取消');
    let image=bytes&&bytes.length<=8*1024*1024?nativeImage.createFromBuffer(bytes):null;
    if(!image||image.isEmpty())image=nativeImage.createFromBuffer(await locator.screenshot({type:'png',animations:'disabled',timeout:5000}));
    if(image.isEmpty())throw imageError('当前题目图片无法解码，请手动核对');
    return image;
  }
  async function read(question,{signal}={}) {
    const context=getContext();
    if(!context)throw imageError('图片题需要使用课桥专用课程浏览器，普通浏览器暂不支持');
    if(!Array.isArray(question.images)||!question.images.length||question.images.length>12)throw imageError('题目图片信息不完整，未发起分析');
    const result=[];let bytes=0;const deadline=Date.now()+30000;
    for(const descriptor of question.images) {
      if(Date.now()>deadline)throw imageError('题目图片读取超时，未发起收费请求；请确认图片完整加载后重试');
      if(signal?.aborted)throw imageError('任务已暂停，图片分析已取消');
      const {locator,info}=await locate(context,descriptor);
      let parts=cache.get(descriptor.key);
      if(parts) {cache.delete(descriptor.key);cache.set(descriptor.key,parts);}
      else {
        const image=await raster(context,locator,info,signal),size=image.getSize(),plan=tilePlan(size.width,size.height);parts=[];
        if(plan.length>1) {
          const scale=Math.min(1,1200/size.width,1200/size.height);
          parts.push({buffer:image.resize({width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale)),quality:'best'}).toPNG(),overview:true});
        }
        for(const tile of plan)parts.push({buffer:image.crop(tile).toPNG(),overview:false});
        const sizeBytes=parts.reduce((sum,p)=>sum+p.buffer.length,0);
        if(sizeBytes>MAX_TOTAL)throw imageError('图片题数据过大，已停止自动分析，请手动核对');
        while(cache.size&&(total+sizeBytes>16*1024*1024||cache.size>=48)) {const key=cache.keys().next().value;total-=cache.get(key).reduce((sum,p)=>sum+p.buffer.length,0);cache.delete(key);}
        cache.set(descriptor.key,parts);total+=sizeBytes;
      }
      for(const [index,part]of parts.entries()) {
        bytes+=part.buffer.length;
        if(bytes>MAX_TOTAL||result.length>=MAX_PARTS)throw imageError('本题图片或长图分段过多，已停止自动分析，请手动核对');
        result.push({position:descriptor.position,optionIndex:descriptor.optionIndex,tile:index+1,total:parts.length,overview:part.overview,url:'data:image/png;base64,'+part.buffer.toString('base64')});
      }
    }
    if(signal?.aborted)throw imageError('任务已暂停，图片分析已取消');
    return result;
  }
  return {read,close(){cache.clear();total=0;}};
}
module.exports={createQuestionImageReader,tilePlan};
