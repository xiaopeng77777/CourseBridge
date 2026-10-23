const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createBridge } = require('../desktop/bridge.cjs');
const root = path.join(__dirname, '..'), work = path.join(root, 'work/document-completion-browser');
fs.mkdirSync(work, { recursive: true });
const extension = path.join(work, 'extension');
fs.cpSync(path.join(root, 'extension'), extension, { recursive: true });
for (const name of ['manifest.json','background.js']) {
  const file = path.join(extension,name); fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('127.0.0.1:17328','127.0.0.1:17342'));
}
const iframe = src => `<iframe style="display:block;width:700px;height:250px" src="https://media.chaoxing.com/${src}"></iframe>`;
const next = '<button id="prevNextFocusNext" onclick="document.body.dataset.next=\'yes\'">下一节</button>';
const done = '<div class="done-label"><i aria-hidden="true">✓</i><div>任务点已完成</div></div>';
(async()=>{
  const bridge = createBridge({ dataDir:fs.mkdtempSync(path.join(work,'data-')), port:17342 }); let context;
  try {
    await bridge.listen(); bridge.update({enabled:true,autoNext:true,autoAnswer:false,skipUnanswered:false,nextDelay:2});
    context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work,'profile-')), {executablePath:process.env.COURSEBRIDGE_CHROME,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'); await worker.evaluate(token=>chrome.storage.local.set({token}),bridge.snapshot().token);
    await context.route(/https:\/\/[^/]*chaoxing\.com\//,route=>{
      const pathname=new URL(route.request().url()).pathname; let body='';
      if(pathname==='/div-done') body='<div class="ans-attach-ct"><div class="ans-job-icon">任务点</div>'+done+iframe('ananas/modules/pdf/index.html')+'</div>'+next;
      if(pathname==='/inherited-done') body='<div class="ans-attach-ct"><div class="ans-job-icon ans-job-finished"></div>'+iframe('ananas/modules/pdf/index.html')+'</div>'+next;
      if(pathname==='/ananas/modules/pdf/index.html') body='<div class="ans-job-icon">内层旧任务标记</div>'+iframe('screen/file');
      if(pathname==='/screen/file') body='<div data-coursebridge-document style="height:180px;overflow:auto"><div style="height:6000px">已在之前浏览过的课件</div></div>';
      if(pathname==='/two-docs') body='<section class="ans-attach-ct">'+done+iframe('ananas/modules/pdf/index.html')+'</section><section id="second" class="ans-attach-ct"><div class="ans-job-icon">任务点</div>'+iframe('short-document')+'</section>'+next;
      if(pathname==='/short-document') body='<div data-coursebridge-document style="height:180px">课件末页</div>';
      return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>已完成课件验证</title>'+body});
    });
    const page=await context.newPage();
    for(const scenario of ['div-done','inherited-done']) {
      await page.goto('https://course.chaoxing.com/'+scenario);
      await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:30000});
      const viewer=page.frames().find(frame=>frame.url().endsWith('/screen/file'));
      assert.equal(await viewer.evaluate(()=>document.querySelector('[data-coursebridge-document]').scrollTop),0,'平台已经完成的课件不再重复翻阅');
      console.log('PASS '+scenario+': 识别完整文字和继承的完成状态，内层残留待完成标记不阻塞切换');
    }
    await page.goto('https://course.chaoxing.com/two-docs'); await page.waitForTimeout(14000);
    assert.equal(await page.evaluate(()=>document.body.dataset.next),undefined,'第一份课件的完成状态不能跳过第二份');
    assert.ok(bridge.snapshot().frames.some(frame=>frame.frameId===0&&/等待平台确认/.test(frame.status)));
    await page.evaluate(done=>document.querySelector('#second').insertAdjacentHTML('afterbegin',done),done);
    await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:30000});
    console.log('PASS independent: 两份课件分别确认完成，未完成资源仍会阻止下一节');
    await page.setContent('<main id="markers"></main>'); await page.addScriptTag({path:path.join(root,'extension/adapter.js')});
    const result=await page.evaluate(()=>{const target=document.querySelector('#markers');target.innerHTML='<div id="complete"><i aria-hidden="true">✓</i><div>任务点已完成</div></div><div id="pending">任务点待完成</div><div id="hidden" style="display:none">任务点已完成</div>';return ['complete','pending','hidden'].map(id=>CourseBridgeAdapter.taskCompleted(document.querySelector('#'+id)))});
    assert.deepEqual(result,[true,false,false]);
    console.log('PASS scope: 分段 DIV 完成提示可识别，待完成和隐藏提示不计入完成');
  }finally{await context?.close();await bridge.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
