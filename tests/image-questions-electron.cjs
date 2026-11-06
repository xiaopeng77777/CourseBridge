// Synthetic graph fixtures only; no account, real course or API key is used.
const {app,nativeImage}=require('electron');
const {chromium}=require('playwright-core');
const {findChromium}=require('../desktop/browser.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createBridge}=require('../desktop/bridge.cjs');
const {createQuestionImageReader}=require('../desktop/question-images.cjs');
const root=path.resolve(__dirname,'..'),work=path.join(root,'work/20261106-image-questions/integration');fs.mkdirSync(work,{recursive:true});
app.setPath('userData',path.join(work,'electron-profile'));
app.whenReady().then(async()=>{
 let context,bridge;const passed=[],calls=[];
 const reader=createQuestionImageReader({getContext:()=>context,nativeImage});
 try{
  context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work,'browser-')),{executablePath:process.env.COURSEBRIDGE_CHROME||findChromium(path.join(root,'runtime/browsers')),headless:true});
  await context.route('https://fixture.chaoxing.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><body><section data-coursebridge-question><h3 data-question-title>【单选题】选择指定的示例结构图</h3><label>A<input type="radio" name="q"><img id="diagramA"></label><label>B<input type="radio" name="q"><img id="diagramB"></label></section></body>'}));
  const page=await context.newPage();await page.goto('https://fixture.chaoxing.com/work/dowork');
  await page.evaluate(async()=>{for(const [i,id]of ['diagramA','diagramB'].entries()){const canvas=document.createElement('canvas');canvas.width=600;canvas.height=i?500:4200;const g=canvas.getContext('2d');g.fillStyle='white';g.fillRect(0,0,canvas.width,canvas.height);g.strokeStyle=i?'#235bc2':'#253341';g.lineWidth=5;for(let y=40;y<canvas.height;y+=250){g.beginPath();g.arc(100,y+40,25,0,Math.PI*2);g.arc(450,y+80,25,0,Math.PI*2);g.moveTo(125,y+40);g.lineTo(425,y+80);g.stroke();g.fillStyle='black';g.font='26px sans-serif';g.fillText('Synthetic diagram '+i+' row '+y,30,y+140);}const image=document.getElementById(id);image.style.width='300px';image.src=canvas.toDataURL('image/png');await image.decode();}});
  for(const file of ['rules.js','images.js','adapter.js'])await page.addScriptTag({path:path.join(root,'extension',file)});
  const questions=await page.evaluate(()=>CourseBridgeAdapter.readQuestions().map(({element,inputs,titleElement,...q})=>q));
  assert.equal(questions.length,1);assert.equal(questions[0].hasImages,true);assert.equal(questions[0].images.length,2);assert.notEqual(questions[0].options[0],questions[0].options[1]);passed.push('纯图片选项保持识别和独立身份');
  const parts=await reader.read(questions[0]);assert.ok(parts.length>2);assert.ok(parts.some(p=>p.overview));assert.ok(parts.filter(p=>p.optionIndex===0).length>2);assert.ok(parts.every(p=>p.url.startsWith('data:image/png;base64,')));passed.push('原图读取、长图分段及图片与选项绑定');
  let invalid=false;try{await reader.read({...questions[0],images:[{...questions[0].images[0],id:'not-on-this-page'}]});}catch{invalid=true;}assert.ok(invalid);passed.push('页面图片标识不匹配时拒绝读取');
  const storage={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};
  bridge=createBridge({dataDir:fs.mkdtempSync(path.join(work,'data-')),port:0,secureStorage:storage,deepseekOptions:{imageReader:reader.read,requestGap:1,fetchImpl:async(url,init)=>{
   if(url.endsWith('/user/balance'))return {ok:true,text:async()=>JSON.stringify({is_available:true,balance_infos:[{currency:'CNY',total_balance:'1.00'}]})};
   calls.push(JSON.parse(init.body));return {ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"indices":[1],"uncertain":false}'}}],usage:{total_tokens:1111}})};
  }}});
  await bridge.listen();await bridge.configureDeepSeek({apiKey:'fixture-key-not-real',enabled:true});bridge.update({enabled:true,autoAnswer:true,lookupMode:'enncy-deepseek',autoSubmit:false});
  const base=bridge.snapshot(),sync=async questions=>{const response=await fetch(`http://127.0.0.1:${base.port}/v1/sync`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+base.token},body:JSON.stringify({clientId:'fixture',tabId:1,frameId:0,state:{title:'Synthetic',assessment:true,visible:true,questions:1,questionTotal:1},questions})});return response.json();};
  let result=await sync(questions);for(let i=0;i<80&&!result.answers?.some(a=>a.status==='matched');i++){await new Promise(r=>setTimeout(r,50));result=await sync(questions);}
  assert.equal(result.answers[0].status,'matched');assert.ok(calls[0].messages[1].content.some(p=>p.type==='image_url'));assert.ok(!JSON.stringify(calls).includes('fixture.chaoxing.com'));passed.push('本地桥接到看图 API 的完整模拟链路，无 URL 或凭证外传');
  const filled=await page.evaluate(answers=>CourseBridgeAdapter.applyAnswers(answers,CourseBridgeAdapter.readQuestions()),result.answers);assert.equal(filled,1);assert.equal(await page.locator('input').nth(1).isChecked(),true);passed.push('模型索引填写到对应图片选项，未提交');
  const before=calls.length;result=await sync(questions);assert.equal(calls.length,before);assert.equal(result.answers[0].status,'matched');passed.push('在线图片答案存回后本地复用，无重复调用');
  bridge.update({imageAnalysis:false,saveOnlineAnswers:false});const changed=questions.map(q=>({...q,title:q.title+'另一道无本地答案题'}));result=await sync(changed);assert.match(result.answers[0].detail,/已关闭/);assert.equal(calls.length,before);passed.push('关闭图片分析后不调用 API');
  await page.evaluate(()=>{document.querySelector('#diagramB').src='data:image/png;base64,broken';});await page.waitForTimeout(80);const failed=await page.evaluate(()=>CourseBridgeAdapter.readQuestions()[0].imageIssue);assert.match(failed,/加载失败/);passed.push('图片未加载时给出明确原因');
  fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({passed:true,cases:passed,calls:calls.length},null,2));console.log(JSON.stringify({passed:true,cases:passed,calls:calls.length}));
 }finally{reader.close();await bridge?.close();await context?.close();app.quit();}
}).catch(error=>{console.error(error);app.exit(1);});
