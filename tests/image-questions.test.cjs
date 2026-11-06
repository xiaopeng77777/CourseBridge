const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {tilePlan}=require('../desktop/question-images.cjs');
const {createDeepSeek}=require('../desktop/deepseek.cjs');
const {resolveOnline}=require('../desktop/answer-routing.cjs');
const {sanitizeSettings}=require('../extension/rules.js');
const parent=path.resolve(__dirname,'../work/20261106-image-questions/unit');fs.mkdirSync(parent,{recursive:true});
const question={title:'示例图形题',options:['A [图片#1234567812345678]','B [图片#2345678923456789]'],multiple:false,hasImages:true,images:[{id:'image-1',key:'1234567812345678',position:'option',optionIndex:0}]};
const storage={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};
const wait=async predicate=>{for(let i=0;i<100;i++){const v=predicate();if(v)return v;await new Promise(r=>setTimeout(r,10));}throw Error('等待测试结果超时');};
function provider(t,options={}) {
 const calls=[];const p=createDeepSeek({dataDir:fs.mkdtempSync(path.join(parent,'case-')),secureStorage:storage,requestGap:1,...options,fetchImpl:async(url,init)=>{
  if(url.endsWith('/user/balance'))return {ok:true,text:async()=>JSON.stringify({is_available:true,balance_infos:[{currency:'CNY',total_balance:'1.00'}]})};
  calls.push(JSON.parse(init.body));return {ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({indices:[1],uncertain:false})}}],usage:{total_tokens:345}})};
 }});t.after(()=>p.close());return {p,calls};
}
test('长图分段覆盖整张，边界有效且相邻分段重叠',()=>{
 for(const [w,h]of [[600,6500],[6000,500],[1800,2200],[400,300]]) {
  const tiles=tilePlan(w,h);assert.ok(tiles.length<=16);assert.ok(tiles.every(t=>t.x>=0&&t.y>=0&&t.x+t.width<=w&&t.y+t.height<=h&&t.width<=1280&&t.height<=1400));
  for(let y=0;y<h;y+=137)for(let x=0;x<w;x+=131)assert.ok(tiles.some(t=>x>=t.x&&x<t.x+t.width&&y>=t.y&&y<t.y+t.height));
 }
 assert.throws(()=>tilePlan(8000,8000),/不受支持/);
});
test('图片题分析设置默认启用但可明确关闭',()=>{assert.equal(sanitizeSettings({}).imageAnalysis,true);assert.equal(sanitizeSettings({imageAnalysis:false}).imageAnalysis,false);});
test('图题不向言溪发送空图标或字母，不消耗言溪次数',()=>{
 let enncy=0,ai=0;const result=resolveOnline(question,{mode:'enncy-deepseek',canRequest:true,providers:{enncy:{resolve(){enncy++;}},deepseek:{resolve(){ai++;return {status:'matched',indices:[1]};}}}});
 assert.equal(enncy,0);assert.equal(ai,1);assert.deepEqual(result.indices,[1]);
});
test('图题将局部图片与选项索引绑定，使用内嵌像素且缓存不重复计费',async t=>{
 const {p,calls}=provider(t,{imageReader:async()=>[{position:'option',optionIndex:0,tile:1,total:1,url:'data:image/png;base64,AA=='}]});await p.configure({apiKey:'fixture-image-key',enabled:true});
 p.resolve(question,true);await wait(()=>calls.length===1&&p.resolve(question,false)?.status==='matched');
 assert.equal(calls[0].model,'deepseek-flash');assert.equal(calls[0].messages[1].content[1].text.startsWith('选项 index=0'),true);assert.equal(calls[0].messages[1].content[2].image_url.url,'data:image/png;base64,AA==');
 for(let i=0;i<10;i++)assert.deepEqual(p.resolve(question,true).indices,[1]);assert.equal(calls.length,1);assert.equal(p.snapshot().sessionTokens,345);
});
test('图片读取失败或不支持的模型不发起收费请求',async t=>{
 const {p,calls}=provider(t,{imageReader:async()=>{const e=Error('图片未加载，未发起分析');e.imageError=true;throw e;}});await p.configure({apiKey:'fixture-key',enabled:true});p.resolve(question,true);
 await wait(()=>p.resolve(question,false)?.status==='missing');assert.equal(calls.length,0);assert.equal(p.snapshot().sessionRequests,0);
 await p.configure({model:'deepseek-v4-pro'});assert.match(p.resolve(question,true).detail,/Flash/);assert.equal(calls.length,0);
});
test('暂停会取消正在准备的图片，不在暂停后发起 API 调用',async t=>{
 let finish;const {p,calls}=provider(t,{imageReader:()=>new Promise(resolve=>{finish=resolve;})});await p.configure({apiKey:'fixture-key',enabled:true});p.resolve(question,true);await wait(()=>finish);p.cancelPending();finish([{position:'title',tile:1,total:1,url:'data:image/png;base64,AA=='}]);await new Promise(r=>setTimeout(r,20));assert.equal(calls.length,0);
});
