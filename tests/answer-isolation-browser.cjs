const { chromium } = require('playwright-core');
const { createBridge } = require('../desktop/bridge.cjs');
const { createTextTyper } = require('../desktop/typing.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), work = path.join(root, 'work', 'answer-isolation'); fs.mkdirSync(work, { recursive: true });
const extension = path.join(work, 'extension'); fs.cpSync(path.join(root, 'extension'), extension, { recursive: true });
for (const name of ['manifest.json','background.js','content.js']) {
  const file = path.join(extension, name); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('127.0.0.1:17328','127.0.0.1:17344').replace('setInterval(tick, 2000)', 'setInterval(tick, 100)'));
}
function fixture(kind) {
  const shared = ['shared','all-visible','custom'].includes(kind), total = shared ? 2 : 1;
  const q = n => `<section data-coursebridge-question id="q${n}" style="display:${n===41 || kind==='all-visible' ? 'block':'none'}"><h3 data-question-title>${kind}第${n}题</h3>${kind === 'custom' ? '<div role="radio" data-index="0">甲</div><div role="radio" data-index="1">乙</div>' : '<label><input type="radio" name="shared" value="0">甲</label><label><input type="radio" name="shared" value="1">乙</label>'}</section>`;
  const text = kind === 'blank' ? '<h3 data-question-title>【填空题】两个空</h3><input type="text"><input type="text">' : `<h3 data-question-title>【论述题】文本编辑器测试（1000字以上）</h3>${kind==='iframe' ? '<iframe srcdoc="&lt;body contenteditable=true&gt;&lt;/body&gt;"></iframe>' : '<div contenteditable="true" style="height:180px"></div>'}`;
  return `<!doctype html><meta charset="utf-8"><title>答案隔离测试</title><body data-coursebridge-exam-total="${total}">${shared ? q(41)+q(42) : '<section data-coursebridge-question>'+text+'</section>'}
  <button id="next" ${shared?'':'hidden'}>下一题</button><button id="submit" style="display:${shared?'none':'block'}" onclick="document.body.dataset.submits=String(+(document.body.dataset.submits||0)+1)">交卷</button>
  <script>let current=41; const saved={}; document.body.dataset.saved='{}';
  document.querySelectorAll('input[type=radio],[role=radio]').forEach(input=>input.addEventListener('click',()=>{
    const q=input.closest('section'); if(q.style.display==='none') document.body.dataset.hiddenClicks=String(+(document.body.dataset.hiddenClicks||0)+1);
    if(input.matches('[role=radio]')) { document.querySelectorAll('[role=radio]').forEach(x=>x.setAttribute('aria-checked','false')); input.setAttribute('aria-checked','true'); }
    saved[current]=input.value||input.dataset.index; document.body.dataset.saved=JSON.stringify(saved);
    document.body.dataset.optionClicks=String(+(document.body.dataset.optionClicks||0)+1);
  })); document.querySelector('#next').onclick=()=>{ current=42;document.querySelector('#q41').style.display='none';document.querySelector('#q42').style.display='block';document.querySelector('#next').hidden=true;document.querySelector('#submit').style.display='block';};
  </script>`;
}
(async () => {
  let context;
  const typer = createTextTyper({ getContext: () => context, characterDelay: 0 });
  const bridge = createBridge({ dataDir: fs.mkdtempSync(path.join(work,'data-')), port: 17344, textInput: typer.request });
  try {
    await bridge.listen();
    bridge.importBank(['shared','all-visible','custom'].flatMap(kind=>[41,42].map(n=>({question:`${kind}第${n}题`,answer:'乙'}))));
    const essay = '这是基于智能感知与环境控制的设计构想。'.repeat(90);
    bridge.importBank([{question:'【填空题】两个空',type:'blank',blankCount:2,answers:['第二','第一']},{question:'【论述题】文本编辑器测试（1000字以上）',type:'essay',answers:[essay]}]);
    bridge.update({enabled:true,autoAnswer:true,autoSubmit:true,autoNext:true,lookupMode:'local'});
    context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work,'profile-')),{executablePath:process.env.COURSEBRIDGE_CHROME,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'); await worker.evaluate(token=>chrome.storage.local.set({token}),bridge.snapshot().token);
    await context.route('https://isolation.chaoxing.com/**',route=>route.fulfill({contentType:'text/html',body:fixture(new URL(route.request().url()).searchParams.get('kind'))}));
    const page=await context.newPage(), errors=[]; page.on('pageerror',e=>errors.push(e.message));
    const open=kind=>page.goto('https://isolation.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?kind='+kind);
    for(const kind of ['shared','custom']) {
      await open(kind); await page.waitForFunction(()=>document.body.dataset.submits==='1',null,{timeout:10000});
      assert.deepEqual(JSON.parse(await page.getAttribute('body','data-saved')),{'41':'1','42':'1'});
      assert.equal(await page.getAttribute('body','data-hidden-clicks'),null);
      assert.equal(await page.getAttribute('body','data-option-clicks'),'2');
      await page.waitForTimeout(1200); assert.equal(await page.getAttribute('body','data-option-clicks'),'2');
      console.log('PASS: '+kind+' 共用原生/页面控件，批量查询但仅当前题写入，不循环重填。');
    }
    await open('all-visible');await page.waitForTimeout(1800);
    assert.equal(await page.getAttribute('body','data-option-clicks'),null);assert.equal(await page.getAttribute('body','data-submits'),null);
    console.log('PASS: 整卷预览共用控件时停止填写，不互相覆盖。');
    for(const kind of ['blank','rich','iframe']) {
      await open(kind);await page.waitForFunction(()=>document.body.dataset.submits==='1',null,{timeout:10000});
      if(kind==='blank')assert.deepEqual(await page.locator('input[type=text]').evaluateAll(inputs=>inputs.map(x=>x.value)),['第二','第一']);
      else {
        const editor=kind==='iframe'?page.frameLocator('iframe').locator('body'):page.locator('[contenteditable]');
        assert.equal((await editor.innerText()).replace(/\s/g,''),essay);
      }
      console.log('PASS: '+kind+' 非选择题完整填写并校验。');
    }
    await open('rich'); await page.locator('[contenteditable]').fill('用户自己写的文字');await page.waitForTimeout(1600);
    assert.equal(await page.locator('[contenteditable]').innerText(),'用户自己写的文字');assert.equal(await page.getAttribute('body','data-submits'),null);
    assert.deepEqual(errors,[]);
    const race = await context.newPage();
    race.on('pageerror',e=>{ errors.push(e.message); console.error(e.message); });
    await race.route('https://race.example/**',route=>route.fulfill({contentType:'text/html',body:'<body data-coursebridge-exam="true" data-coursebridge-exam-total="1"><section data-coursebridge-question><h3 data-question-title>第一道请求中的题目</h3><label><input type="radio" name="race">甲</label><label><input type="radio" name="race">乙</label></section></body>'}));
    await race.goto('https://race.example/exam-ans/exam/test/reVersionTestStartNew');
    await race.addScriptTag({path:path.join(root,'extension/rules.js')}); await race.addScriptTag({path:path.join(root,'extension/adapter.js')}); await race.addScriptTag({path:path.join(root,'extension/text.js')}); await race.addScriptTag({path:path.join(root,'extension/exam.js')});
    await race.evaluate(()=>{
      CourseBridgeAdapter.identify=()=>true;
      globalThis.CourseBridgeFont={prepare:async()=>{},text:el=>({value:el?.textContent?.trim()||'',unresolved:false})};
      globalThis.CourseBridgeResources={state:()=>({}),checkpoint:()=>null,checkpointRejected:()=>false};
      globalThis.chrome={runtime:{getManifest:()=>({version:'test'}),sendMessage:message=>{ globalThis.testRequestStarted=true; return new Promise(resolve=>setTimeout(()=>resolve({settings:{enabled:true,autoAnswer:true,autoNext:false,autoSubmit:false},command:{revision:0},answers:message.questions.map(q=>({id:q.id,status:'matched',indices:[0]}))}),600)); }}};
      document.querySelectorAll('input').forEach(input=>input.onclick=()=>document.body.dataset.raceWrites='yes');
    });
    await race.addScriptTag({path:path.join(root,'extension/content.js')});await race.waitForFunction(()=>globalThis.testRequestStarted===true);
    await race.locator('h3').evaluate(el=>el.textContent='页面已换为第二道题目');await race.waitForTimeout(900);
    assert.equal(await race.getAttribute('body','data-race-writes'),null,'延迟的上一题结果不能写入复用的下一题容器');await race.close();
    assert.deepEqual(errors,[]);
    console.log('PASS: 查题返回前题干已切换，丢弃过期结果，不写入新题目。');
    fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({passed:true,hiddenWrites:0,sharedRadioOverwriteFixed:true,customHandlerSafe:true,nonChoiceEditors:['blank','rich','iframe'],manualTextPreserved:true,realExamAccessed:false},null,2));
    console.log('PASS: 手动文本保留，不自动覆盖或交卷。');
  } finally {typer.close();await context?.close();await bridge.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
