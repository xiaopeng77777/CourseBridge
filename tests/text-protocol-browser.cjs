const {chromium}=require('playwright-core');
const {ensureTextProtocol}=require('../desktop/browser.cjs');
const {createBridge}=require('../desktop/bridge.cjs');
const {createTextTyper}=require('../desktop/typing.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),work=path.join(root,'work/text-protocol');fs.mkdirSync(work,{recursive:true});
const extension=path.join(work,'extension');fs.cpSync(path.join(root,'extension'),extension,{recursive:true});
for(const name of ['manifest.json','background.js','content.js']){const file=path.join(extension,name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('127.0.0.1:17328','127.0.0.1:17351').replace('setInterval(tick, 2000)','setInterval(tick, 100)'));}
const bg=path.join(extension,'background.js');fs.writeFileSync(bg,fs.readFileSync(bg,'utf8').replace("['sync','decode-font','text-input']","['sync','decode-font']").replace('globalThis.CourseBridgeTextProtocol = 1;',''));
(async()=>{let context;const typer=createTextTyper({getContext:()=>context,characterDelay:0});const bridge=createBridge({dataDir:fs.mkdtempSync(path.join(work,'data-')),port:17351,textInput:typer.request});try{
  await bridge.listen();const title='【论述题】旧插件连接恢复验证（1000字以上）',answer='这是用于模拟旧插件恢复输入通道的中文正文。'.repeat(70);bridge.importBank([{question:title,type:'essay',answers:[answer]}]);
  context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work,'profile-')),{executablePath:process.env.COURSEBRIDGE_CHROME,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(token=>{chrome.storage.local.set({token});const fetchOriginal=fetch;globalThis.fetch=(url,options)=>fetchOriginal(String(url).replace('127.0.0.1:17328','127.0.0.1:17351'),options);},bridge.snapshot().token);
  await ensureTextProtocol(worker);await ensureTextProtocol(worker);
  await context.route('https://protocol.chaoxing.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><body data-coursebridge-exam-total="1"><section data-coursebridge-question><h3 data-question-title>${title}</h3><div contenteditable="true" style="height:180px"></div></section><button onclick="document.body.dataset.submitted='yes'">交卷</button>`}));
  const page=await context.newPage();await page.goto('https://protocol.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew');bridge.update({enabled:true,autoAnswer:true,autoSubmit:false,autoNext:false,lookupMode:'local'});
  await page.waitForFunction(()=>document.querySelector('[contenteditable]').innerText.length>1000,null,{timeout:30000});
  for(let i=0;i<60;i++){if((await page.locator('[contenteditable]').innerText()).replace(/\s/g,'')===answer)break;await page.waitForTimeout(150);}
  assert.equal((await page.locator('[contenteditable]').innerText()).replace(/\s/g,''),answer);assert.equal(await page.getAttribute('body','data-submitted'),null);
  console.log('PASS: real old worker receives native protocol repair once; complete essay typed without helper tabs or page refresh');
}finally{typer.close();await context?.close();await bridge.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
