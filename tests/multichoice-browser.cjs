const { chromium } = require('playwright-core');
const { createBridge } = require('../desktop/bridge.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), work = path.join(root,'work','multichoice');fs.mkdirSync(work,{recursive:true});
function question(number, variant='known') {
  return `<section data-coursebridge-question id="q${number}"><h3 data-question-title>【多选题】第${number}道多选测试</h3><div class="stem_answer">${['甲','乙','丙','丁'].map((text,i)=>`<div class="answerBg"><span class="num_option_dx" data-index="${i}">${'ABCD'[i]}</span><span class="answerText">${text}</span></div>`).join('')}</div></section>`;
}
const handlers = variant => `<script>document.querySelectorAll('.num_option_dx').forEach(el=>el.onclick=()=>{
 document.body.dataset.clicks=String(+(document.body.dataset.clicks||0)+1);
 const apply=()=>{el.classList.toggle('${variant==='unknown'?'vendor_selected':'check_answer_dx'}');${variant==='replaced'?"el.closest('.answerBg').replaceWith(el.closest('.answerBg').cloneNode(true));setup();":''}};
 ${variant==='async'?'setTimeout(apply,250)':'apply()'};
});</script>`;
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.COURSEBRIDGE_CHROME,headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent(question(47)+handlers('known'));
  const oldStates=await page.evaluate(()=>{
   const selected=el=>el.getAttribute('aria-checked')==='true'||el.getAttribute('aria-selected')==='true'||el.matches('.checked,.selected,.check_answer')||!!el.querySelector('.check_answer,.checked,input:checked');
   const rows=[...document.querySelectorAll('.answerBg')], states=[];
   for(let tick=0;tick<4;tick++){rows.forEach((row,i)=>{if(selected(row)!==[0,2].includes(i))row.querySelector('.num_option_dx').click();});states.push(document.querySelectorAll('.check_answer_dx').length);}
   return states;
  });assert.deepEqual(oldStates,[2,0,2,0]);console.log('REPRODUCED: 0.1.20 多选样式漏识别，答案在两项和零项之间循环。');
  for(const variant of ['known','async','unknown','replaced']){
   const html=question(47)+ (variant==='replaced'?`<script>function setup(){document.querySelectorAll('.num_option_dx').forEach(el=>el.onclick=()=>{document.body.dataset.clicks=String(+(document.body.dataset.clicks||0)+1);el.classList.toggle('vendor_selected');el.closest('.answerBg').replaceWith(el.closest('.answerBg').cloneNode(true));setup();});}setup();</script>`:handlers(variant));
   await page.goto('about:blank');await page.setContent(html);
   await page.addScriptTag({path:path.join(root,'extension/rules.js')});await page.addScriptTag({path:path.join(root,'extension/adapter.js')});
   const apply=()=>page.evaluate(()=>CourseBridgeAdapter.applyAnswers([{id:'0',status:'matched',indices:[0,2]}],CourseBridgeAdapter.readQuestions()));
   await apply();await apply();await page.waitForTimeout(320);
   for(let i=0;i<20;i++)await apply();
   assert.equal(await page.getAttribute('body','data-clicks'),'2',variant+' 每个选项只点一次，即便控件被替换');
   if(['known','async'].includes(variant)){assert.equal(await page.locator('.check_answer_dx').count(),2);assert.equal(await apply(),1);}
   else {assert.equal(await apply(),0);assert.match(await page.evaluate(()=>{const q=CourseBridgeAdapter.readQuestions();CourseBridgeAdapter.applyAnswers([{id:'0',status:'matched',indices:[0,2]}],q);return q[0].fillIssue;}),/停止重复/);}
   console.log('PASS: '+variant+' 经过 20 轮检查保持稳定，不循环勾选。');
  }
 }finally{await browser.close();}
 const extension=path.join(work,'extension');fs.cpSync(path.join(root,'extension'),extension,{recursive:true});
 for(const name of ['manifest.json','background.js','content.js']){const file=path.join(extension,name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('127.0.0.1:17328','127.0.0.1:17346').replace('setInterval(tick, 2000)','setInterval(tick, 100)'));}
 const bridge=createBridge({dataDir:fs.mkdtempSync(path.join(work,'data-')),port:17346});let context;
 try{
  await bridge.listen();bridge.importBank(Array.from({length:85},(_,i)=>({question:`【多选题】第${i+1}道多选测试`,answers:['甲','丙']})));
  bridge.update({enabled:true,autoAnswer:true,autoNext:true,autoSubmit:false,lookupMode:'local'});
  context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work,'profile-')),{executablePath:process.env.COURSEBRIDGE_CHROME,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async token=>{await chrome.storage.local.set({token});globalThis.batches=[];const original=fetch;globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/v1/sync')){const message=JSON.parse(init.body);batches.push({ids:(message.questions||[]).map(q=>q.id),status:message.state.status,mode:message.state.paperMode});}return original(url,init);};},bridge.snapshot().token);
  await context.route('https://multichoice.chaoxing.com/**',route=>{
   const url=new URL(route.request().url()), preview=url.pathname.endsWith('/preview'), index=Number(url.searchParams.get('questionIndex')||0);
   const questions=preview?Array.from({length:85},(_,i)=>question(i+1)).join(''):question(index+41);
   const content=`<!doctype html><meta charset="utf-8"><title>${preview?'整卷预览':'多选连续作答测试'}</title><body data-coursebridge-exam-total="${preview?85:15}">${questions}${handlers('known')}<button ${preview||index===14?'hidden':''} onclick="location.href='?questionIndex=${index+1}'">下一题</button><button onclick="document.body.dataset.submitted='yes'">交卷</button>`;
   return route.fulfill({contentType:'text/html',body:content});
  });
  const page=await context.newPage();await page.goto('https://multichoice.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?questionIndex=0');
  await page.waitForURL('**questionIndex=14',{timeout:20000});await page.waitForTimeout(1200);
  assert.equal(await page.locator('.check_answer_dx').count(),2);assert.equal(await page.getAttribute('body','data-clicks'),'2');assert.equal(await page.getAttribute('body','data-submitted'),null);
  console.log('PASS: 41—55 多选题连续填写和切题，到末题保持答案稳定，关闭自动交卷生效。');
  await worker.evaluate(()=>{batches.length=0;});await page.goto('https://multichoice.chaoxing.com/exam-ans/mooc2/exam/preview');
  await page.waitForFunction(()=>document.querySelectorAll('[data-coursebridge-question]').length===85);await page.waitForTimeout(1300);
  const batches=await worker.evaluate(()=>batches);
  assert.deepEqual(batches.filter(b=>b.ids.length).slice(0,3).map(b=>b.ids.length),[30,30,25]);
  assert.ok(batches.some(b=>b.ids.includes('84')),'最后一题也查到');
  assert.ok(batches.some(b=>/已匹配 85\/85/.test(b.status)),'明确报告完整试卷结果');
  assert.equal(await page.getAttribute('body','data-clicks'),null,'预览用于查题，不触发保存语义不明的选项');
  assert.equal(await page.getAttribute('body','data-submitted'),null);
  assert.equal(bridge.snapshot().frames[0].questions,85);assert.match(bridge.snapshot().frames[0].status,/85\/85/);
  console.log('PASS: 实际预览地址分 30/30/25 查询全 85 题，状态总数正确，预览不改答案或交卷。');
  fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({passed:true,oldBugReproduced:[2,0,2,0],heartbeatsVerified:20,multichoiceQuestions:15,previewQuestionCount:85,previewBatches:[30,30,25],realExamAccessed:false},null,2));
 }finally{await context?.close();await bridge.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
