const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createBridge } = require('../desktop/bridge.cjs');
const root = path.join(__dirname, '..'), work = path.join(root, 'work/resources-browser');
fs.mkdirSync(work, { recursive: true });
const extension = path.join(work, 'extension');
fs.cpSync(path.join(root, 'extension'), extension, { recursive: true });
for (const name of ['manifest.json','background.js']) {
  const file = path.join(extension, name); fs.writeFileSync(file, fs.readFileSync(file,'utf8').replaceAll('127.0.0.1:17328','127.0.0.1:17340'));
}
function wav() { const bytes=16000*16*2,b=Buffer.alloc(44+bytes);b.write('RIFF');b.writeUInt32LE(36+bytes,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(bytes,40);return b; }
const next = '<button id="prevNextFocusNext" onclick="document.body.dataset.next=\'yes\'">下一节</button>';
const frame = src => `<iframe allow="autoplay" style="width:720px;height:220px" src="https://media.chaoxing.com/${src}"></iframe>`;
const doc = '<div data-coursebridge-document style="height:180px;overflow:auto"><div style="height:1800px">课件第一页</div><div>课件最后一页</div></div>';
const quiz = `<div class="tkTopic"><span>共 2 题</span><div class="tkItem"><div class="tkItem_title">视频弹题第一题</div><ul class="tkItem_ul"><li class="ans-videoquiz-opt"><label><span><input style="display:none" type="radio" name="q"></span>A、错误项</label></li><li class="ans-videoquiz-opt"><label><span><input style="display:none" type="radio" name="q"></span>B、正确项</label></li></ul></div><div class="tkTopic_oper"><a class="ans-videoquiz-submit" onclick="check()">提交</a><a id="videoquiz-submitting" class="ans-videoquiz-submit" style="display:none">提交中</a><a class="ans-videoquiz-continue" style="display:none" onclick="document.querySelector('.tkTopic').style.display='none';document.body.dataset.passed='yes'">继续播放</a></div></div><script>function check(){if(!document.querySelectorAll('input')[1].checked)return;document.body.dataset.submits=String(+(document.body.dataset.submits||0)+1);if(document.body.dataset.submits==='1'){document.querySelector('.tkItem_title').textContent='视频弹题第二题';document.querySelectorAll('input').forEach(el=>el.checked=false)}else{document.querySelector('.ans-videoquiz-submit').style.display='none';setTimeout(()=>document.querySelector('.ans-videoquiz-continue').style.display='block',1500)}}</script>`;
(async () => {
  const bridge = createBridge({ dataDir: fs.mkdtempSync(path.join(work, 'data-')), port: 17340 }); let context;
  try {
    await bridge.listen(); bridge.update({ enabled:true, autoAnswer:true, autoSubmit:true, autoNext:true, skipUnanswered:true, nextDelay:2 });
    bridge.importBank([{question:'视频弹题第一题',answer:'正确项'}]);
    context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work,'profile-')), { executablePath:process.env.COURSEBRIDGE_CHROME, headless:true, args:['--autoplay-policy=no-user-gesture-required',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`], ignoreDefaultArgs:['--disable-extensions'] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); await worker.evaluate(token => chrome.storage.local.set({token}), bridge.snapshot().token);
    await context.route(/https:\/\/[^/]*chaoxing\.com\//, route => {
      const u = new URL(route.request().url()); if (u.pathname === '/tone.wav') return route.fulfill({contentType:'audio/wav',body:wav()});
      let body = '';
      if (u.pathname === '/image') body = frame('knowledge/cards') + next;
      if (u.pathname === '/knowledge/cards') body = '<div class="ans-cc"><h2>团队合照</h2><img width="250" height="160" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'250\' height=\'160\'%3E%3C/svg%3E"></div>';
      if (u.pathname === '/document') body = '<div class="ans-attach-ct"><div class="ans-job-icon">任务点</div>'+frame('screen/file')+'</div>'+next+'<script>addEventListener("message",e=>{if(e.source===document.querySelector("iframe").contentWindow&&e.data.read)setTimeout(()=>{document.querySelector(".ans-job-icon").classList.add("ans-job-finished");document.body.dataset.receipt="yes"},6000)})</script>';
      if (u.pathname === '/screen/file') body = doc+'<script>document.querySelector("[data-coursebridge-document]").addEventListener("scroll",function(){if(this.scrollTop+this.clientHeight>=this.scrollHeight-4)parent.postMessage({read:true},"*")})</script>';
      if (u.pathname === '/multi') body = '<div class="ans-attach-ct"><div class="task-status">任务点已完成</div>'+frame('player/first')+'</div><div class="ans-attach-ct">'+frame('player/second')+'</div>'+next;
      if (u.pathname === '/mixed') body = frame('screen/file')+'<div class="ans-attach-ct"><div class="task-status">任务点已完成</div>'+frame('player/first')+'</div>'+next;
      if (u.pathname === '/checkpoint') body = frame('player/quiz')+next;
      if (u.pathname.startsWith('/player/')) body = '<audio controls src="https://media.chaoxing.com/tone.wav"></audio>'+(u.pathname.endsWith('/quiz')?quiz:'');
      return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>课程资源回归验证</title><style>a{display:inline-block;padding:12px}iframe{display:block}</style>'+body});
    });
    const page = await context.newPage();
    if (!process.env.RESOURCE_CASE) {
    await page.goto('https://course.chaoxing.com/image');
    await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:35000});
    console.log('PASS image: 图片课时读取完成后自动下一节');
    await page.goto('https://course.chaoxing.com/document');
    await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:55000});
    assert.equal(await page.evaluate(()=>document.body.dataset.receipt),'yes');
    assert.equal(await page.frames().find(f=>f.url().includes('/screen/file')).evaluate(()=>{const el=document.querySelector('[data-coursebridge-document]');return el.scrollTop+el.clientHeight>=el.scrollHeight-4}),true);
    console.log('PASS document: 真实滚动到末页并等待稳定后切换');
    }
    if (!process.env.RESOURCE_CASE || process.env.RESOURCE_CASE === 'multi') {
    await page.goto('https://course.chaoxing.com/multi'); await page.waitForTimeout(12000);
    assert.equal(await page.evaluate(()=>document.body.dataset.next),undefined);
    const second=page.frames().find(f=>f.url().endsWith('/second')); assert.ok(second);
    const debug = await second.evaluate(()=>{const el=document.querySelector('audio');return {time:el.currentTime,paused:el.paused,ready:el.readyState,muted:el.muted,error:el.error?.message,playError:el.dataset.coursebridgePlayError}});
    assert.ok(debug.time>0, JSON.stringify({debug,frames:bridge.snapshot().frames}));

    await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:35000});
    console.log('PASS multiple: 第一视频的完成标记不会跳过第二视频；全部完成才切换');
    }
    if (!process.env.RESOURCE_CASE || process.env.RESOURCE_CASE === 'mixed') {
    await page.goto('https://course.chaoxing.com/mixed'); await page.waitForTimeout(10000);
    assert.equal(await page.evaluate(()=>document.body.dataset.next),undefined);
    await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:55000});
    console.log('PASS mixed: 视频已完成仍等待同一课时的 PPT 浏览完成');
    }
    await page.goto('https://course.chaoxing.com/checkpoint');
    await page.waitForTimeout(22000);
    const player=page.frames().find(f=>f.url().endsWith('/quiz'));
    assert.equal(await player.evaluate(()=>document.body.dataset.submits),'1');
    assert.equal(await player.evaluate(()=>document.querySelector('audio').paused),true);
    assert.equal(await page.evaluate(()=>document.body.dataset.next),undefined);
    assert.ok(bridge.snapshot().frames.some(f=>f.frameId===0&&/视频弹题.*未找到答案/.test(f.status)));
    bridge.importBank([{question:'视频弹题第二题',answer:'正确项'}]);
    await player.waitForFunction(()=>document.body.dataset.passed==='yes',null,{timeout:20000});
    await player.waitForFunction(()=>!document.querySelector('audio').paused,null,{timeout:12000});
    assert.equal(await player.evaluate(()=>document.body.dataset.submits),'2');

    await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:35000});
    console.log('PASS checkpoint: 逐题匹配提交、缺答案明确等待且不跳课、通过后继续播放并正常切换');
  } catch (error) {
    console.log(JSON.stringify(bridge.snapshot().frames,null,2));
    for(const page of context?.pages() || []) for(const frame of page.frames()) console.log(await frame.evaluate(()=>({path:location.pathname,media:[...document.querySelectorAll('audio,video')].map(el=>({time:el.currentTime,duration:el.duration,ended:el.ended,paused:el.paused,ready:el.readyState,error:el.dataset.coursebridgePlayError}))})).catch(()=>({detached:true})));
    throw error;
  } finally { await context?.close(); await bridge.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
