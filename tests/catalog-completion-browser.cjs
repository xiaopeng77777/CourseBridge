const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');const {createBridge}=require('../desktop/bridge.cjs');
const root=path.join(__dirname,'..'),work=path.join(root,'work/catalog-completion-browser');fs.mkdirSync(work,{recursive:true});
const extension=path.join(work,'extension');fs.cpSync(path.join(root,'extension'),extension,{recursive:true});
for(const name of ['manifest.json','background.js']){const file=path.join(extension,name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('127.0.0.1:17328','127.0.0.1:17344'))}
const frame=src=>`<iframe style="display:block;width:700px;height:220px" src="https://media.chaoxing.com/${src}"></iframe>`;
function main(complete){return `<div class="posCatalog_active" id="current"><span class="posCatalog_name">本章知识点及练习题</span><span class="posCatalog_task">${complete?'已完成':'待完成'}</span></div><div id="following"><button class="posCatalog_name" onclick="document.body.dataset.next='yes'">下一课时</button><span class="posCatalog_task">已完成</span></div><ul class="prev_ul"><li class="active">视频</li><li onclick="document.body.dataset.tab='yes'">章节测验</li></ul>${frame('knowledge/cards')}`}
(async()=>{const bridge=createBridge({dataDir:fs.mkdtempSync(path.join(work,'data-')),port:17344});let context;
try{
 await bridge.listen();bridge.update({enabled:true,autoNext:true,autoAnswer:true,autoSubmit:true,skipUnanswered:false,nextDelay:2});
 context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work,'profile-')),{executablePath:process.env.COURSEBRIDGE_CHROME,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(token=>chrome.storage.local.set({token}),bridge.snapshot().token);
 await context.route(/https:\/\/[^/]*chaoxing\.com\//,route=>{
  const p=new URL(route.request().url()).pathname;let body='';
  if(p==='/done'||p==='/pending')body=main(p==='/done');
  if(p==='/knowledge/cards')body=frame('screen/file')+frame('ananas/modules/video/index.html');
  if(p==='/screen/file')body='<div data-coursebridge-document style="height:180px;overflow:auto"><div style="height:18000px">没有自身任务点标记的课件</div></div>';
  if(p==='/ananas/modules/video/index.html')body='<video controls style="width:300px;height:150px"></video>';
  if(p==='/login')body='<div data-coursebridge-document style="height:180px;overflow:auto"><div style="height:18000px">扫码登录</div></div><button data-coursebridge-next onclick="document.body.dataset.clicked=\'yes\'">下一节</button>';
  return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>目录完成状态验证</title>'+body});
 });
 const page=await context.newPage();await page.goto('https://course.chaoxing.com/done');
 await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:25000});
 assert.equal(await page.evaluate(()=>document.body.dataset.tab),undefined,'已完成整章直接下一课时，不重做旧标签');
 const viewer=page.frames().find(frame=>frame.url().endsWith('/screen/file'));assert.equal(await viewer.evaluate(()=>document.querySelector('[data-coursebridge-document]').scrollTop),0);
 console.log('PASS catalog: 只有目录显示已完成时，多层课件不重复滚动，直接下一节');
 await page.goto('https://course.chaoxing.com/pending');await page.waitForTimeout(10000);
 assert.equal(await page.evaluate(()=>document.body.dataset.next),undefined,'其他课时已完成不能覆盖当前未完成课时');
 const pending=page.frames().find(frame=>frame.url().endsWith('/screen/file'));assert.ok(await pending.evaluate(()=>document.querySelector('[data-coursebridge-document]').scrollTop>0));
 console.log('PASS pending: 只读取当前课时完成状态，未完成内容正常继续浏览');
 await page.goto('https://passport2.chaoxing.com/login');await page.waitForTimeout(4000);
 assert.equal(await page.locator('#coursebridge-panel').count(),0);assert.equal(await page.evaluate(()=>document.querySelector('[data-coursebridge-document]').scrollTop),0);assert.equal(await page.evaluate(()=>document.body.dataset.clicked),undefined);
 await page.addScriptTag({path:path.join(root,'extension/adapter.js')});assert.equal(await page.evaluate(()=>CourseBridgeAdapter.identify()),false);
 console.log('PASS login: 扫码及登录页面不注入课桥任务脚本，不滚动、不自动点击');
}finally{await context?.close();await bridge.close()}})().catch(error=>{console.error(error);process.exitCode=1});
