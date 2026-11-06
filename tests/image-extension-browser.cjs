// Actual MV3 loading, isolated worlds, background sync and synthetic graph options.
const {app,nativeImage}=require('electron');
const {chromium}=require('playwright-core');
const {findChromium}=require('../desktop/browser.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const {createBridge}=require('../desktop/bridge.cjs');
const {createQuestionImageReader}=require('../desktop/question-images.cjs');
const work=path.join(root,'work/20261106-image-questions/mv3');fs.mkdirSync(work,{recursive:true});
app.setPath('userData',path.join(work,'electron'));
const fixture=`<!doctype html><meta charset="utf-8"><title>合成图片选项验证</title><body>
<section class="singleQuesId"><h3 class="mark_name">【单选题】合成分离控件图片</h3><ul class="Zy_ulTop">${[0,1].map(i=>`<li><input type="radio" name="native" id="n${i}"><label for="n${i}">${'AB'[i]}</label><div class="after"><img aria-hidden="true" data-test-image="${i}"></div></li>`).join('')}</ul></section>
<section class="singleQuesId"><h3 class="mark_name">【单选题】合成背景图片</h3><div class="stem_answer">${[0,1].map(i=>`<div class="answerBg" role="radio" aria-checked="false"><span class="num_option">${'AB'[i]}</span><div class="answerText" data-background="${i}" style="width:300px;height:220px"></div></div>`).join('')}</div></section>
<section class="singleQuesId"><h3 class="mark_name">【单选题】合成选项内容缺失</h3><label><input type="radio" name="missing">A</label><label><input type="radio" name="missing">B</label></section>
<script>for(const el of document.querySelectorAll('[data-test-image],[data-background]')){const c=document.createElement('canvas');c.width=400;c.height=300;const g=c.getContext('2d');g.fillStyle='white';g.fillRect(0,0,400,300);g.lineWidth=4;g.strokeStyle='navy';g.font='24px sans-serif';g.fillStyle='black';g.fillText('Graph '+(el.dataset.testImage||el.dataset.background),140,30);for(let y=30;y<280;y+=60){g.beginPath();g.arc(70,y,15,0,Math.PI*2);g.moveTo(85,y);g.lineTo(300,150);g.stroke();}if(el.tagName==='IMG')el.src=c.toDataURL();else el.style.backgroundImage='url("'+c.toDataURL()+'")';}for(const row of document.querySelectorAll('[role=radio]'))row.onclick=()=>{for(const other of row.parentElement.children)other.setAttribute('aria-checked',String(other===row));};</script></body>`;
app.whenReady().then(async()=>{
 let context,bridge;const calls=[];let reads=0;const reader=createQuestionImageReader({getContext:()=>context,nativeImage});
 try{
 const storage={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};
 bridge=createBridge({dataDir:fs.mkdtempSync(path.join(work,'data-')),port:0,secureStorage:storage,deepseekOptions:{requestGap:1,imageReader:async(q,opts)=>{reads++;assert.equal(q.images.length,2);assert.deepEqual(q.images.map(i=>i.optionIndex),[0,1]);return reader.read(q,opts);},fetchImpl:async(url,init)=>{
  if(url.endsWith('/user/balance'))return {ok:true,text:async()=>JSON.stringify({is_available:true,balance_infos:[{currency:'CNY',total_balance:'1.00'}]})};
  const p=JSON.parse(init.body);assert.ok(Array.isArray(p.messages[1].content),'must use actual visual content');assert.equal(p.messages[1].content.filter(p=>p.type==='image_url').length,2);calls.push(p);
  return {ok:true,text:async()=>JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"indices":[1],"uncertain":false}'}}],usage:{total_tokens:20}})};
 }}});await bridge.listen();await bridge.configureDeepSeek({apiKey:'fixture-only-not-real',enabled:true});bridge.update({enabled:true,autoAnswer:true,autoSubmit:false,autoNext:false,lookupMode:'deepseek'});
 const ext=fs.mkdtempSync(path.join(work,'extension-'));fs.cpSync(path.join(root,'extension'),ext,{recursive:true});for(const name of ['background.js','manifest.json']){const file=path.join(ext,name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('127.0.0.1:17328',`127.0.0.1:${bridge.snapshot().port}`));}
 context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work,'profile-')),{executablePath:process.env.COURSEBRIDGE_CHROME||findChromium(path.join(root,'runtime/browsers')),headless:true,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`],ignoreDefaultArgs:['--disable-extensions']});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:15000});await worker.evaluate(async token=>chrome.storage.local.set({token,clientId:'graph-mv3'}),bridge.snapshot().token);
 await context.route('https://fixture.chaoxing.com/**',r=>r.fulfill({contentType:'text/html',body:fixture}));const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('https://fixture.chaoxing.com/mooc-ans/mooc2/work/dowork');
 await page.waitForFunction(()=>document.querySelector('#n1').checked,null,{timeout:20000});await page.waitForFunction(()=>document.querySelectorAll('[role=radio]')[1].getAttribute('aria-checked')==='true',null,{timeout:20000});
 assert.equal(calls.length,2);assert.equal(reads,2);assert.equal(await page.locator('input[name=missing]:checked').count(),0);assert.equal(errors.length,0,errors.join('\n'));
 const state=bridge.snapshot().frames.find(f=>f.frameHost==='fixture.chaoxing.com');assert.equal(state.imageProtocol,2);assert.equal(state.imageQuestions,2);assert.equal(state.imageCount,4);assert.equal(state.imageFailures,1);assert.match(state.remoteIssue,/仅识别到选项字母/);
 const report={passed:true,checks:['real MV3 scripts and isolated world','native control separated from graph','visible aria-hidden images retained','CSS background image choices','only-letter choices block paid lookup','local diagnostic counts without question data'],mockAPICalls:calls.length,realAPICalls:0};fs.writeFileSync(path.join(work,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){console.error(JSON.stringify({reads,calls:calls.length,frames:bridge?.snapshot().frames}));throw error;}finally{reader.close();await context?.close();await bridge?.close();app.quit();}
}).catch(error=>{console.error(error);app.exit(1);});
