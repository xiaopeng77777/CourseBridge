const { chromium } = require('playwright-core');
const { createBridge } = require('../desktop/bridge.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root=path.join(__dirname,'..'), work=path.join(root,'work','assessment-browser');
fs.mkdirSync(work,{recursive:true});
const extension=path.join(work,'extension');fs.cpSync(path.join(root,'extension'),extension,{recursive:true});
for(const name of ['manifest.json','background.js']) {const file=path.join(extension,name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('127.0.0.1:17328','127.0.0.1:17334'));}
function question(title,options,multiple,id) {
  return `<div class="singleQuesId"><div class="TiMu newTiMu"><div class="Zy_TItle">${id}【${multiple?'多选题':'单选题'}】${title}</div><ul class="Zy_ulTop">${options.map((o,i)=>`<li role="${multiple?'checkbox':'radio'}"><label class="before"><span class="${multiple?'num_option_dx':'num_option'}" onclick="choose(this.closest('li'),${multiple})">${String.fromCharCode(65+i)}</span></label><a class="after">${o}</a></li>`).join('')}</ul></div></div>`;
}
function fixture(unsupported) {
  return `<!doctype html><meta charset="utf-8"><title>章节测验</title><a></a>${question('多选控件验证',['选项甲','选项乙','选项丙'],true,1)}${question('单选控件验证',['答案一','答案二'],false,2)}${unsupported?'<div class="TiMu"><div class="Zy_TItle">3【填空题】尚不支持的填空</div><textarea></textarea></div>':''}<a onclick="document.body.dataset.submitted='yes';document.body.dataset.submitClicks=String(+(document.body.dataset.submitClicks||0)+1)">提交</a><script>function choose(el,multiple){document.body.dataset.optionClicks=String(+(document.body.dataset.optionClicks||0)+1);if(!multiple)el.parentElement.querySelectorAll('li').forEach(row=>{row.setAttribute('aria-checked','false');row.querySelector('span').classList.remove('check_answer')});const value=el.getAttribute('aria-checked')!=='true';el.setAttribute('aria-checked',value);el.querySelector('span').classList.toggle('check_answer',value)}</script>`;
}
(async()=>{
  const bridge=createBridge({dataDir:fs.mkdtempSync(path.join(work,'data-')),port:17334});let context;
  try{
    await bridge.listen();bridge.importBank([{question:'多选控件验证',answers:['选项甲','选项丙']}]);
    bridge.update({enabled:true,autoAnswer:true,autoSubmit:true,autoNext:true,skipUnanswered:true,nextDelay:2});
    context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work,'profile-')),{executablePath:process.env.COURSEBRIDGE_CHROME,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(token=>chrome.storage.local.set({token}),bridge.snapshot().token);
    await context.route('https://assessment.chaoxing.com/**',route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/work/selectWorkQuestionYiPiYue')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>查看已批阅作业</title><div class="TiMu"><div class="Zy_TItle">已提交的题目</div><label><input type="radio" onclick="document.body.dataset.changed=\'yes\'">原有选项</label></div><button data-coursebridge-next onclick="document.body.dataset.next=\'yes\'">下一课时</button>'});
      return route.fulfill({contentType:'text/html',body:url.pathname.startsWith('/work/')?fixture(url.searchParams.has('unsupported')):`<!doctype html><meta charset="utf-8"><title>学生学习页面</title><style>iframe{width:800px;height:500px}</style><li data-coursebridge-tab class="active">章节测验</li><iframe src="/work/custom${url.search}"></iframe><button data-coursebridge-next onclick="document.body.dataset.next='yes'">下一课时</button>`});
    });
    const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('https://assessment.chaoxing.com/missing');
    const quiz=()=>page.frames().find(f=>f.url().includes('/work/'));
    await page.waitForFunction(()=>document.querySelector('#coursebridge-panel'),null,{timeout:15000});
    const wait=async(predicate,timeout=15000)=>{const begin=Date.now();while(!predicate()){if(Date.now()-begin>timeout)throw new Error('等待状态超时');await new Promise(r=>setTimeout(r,100));}};
    await wait(()=>bridge.snapshot().frames.some(f=>/未找到答案.*离线库未开启/.test(f.status)));
    assert.equal(await quiz().locator('.TiMu').count(),2);
    await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:35000});
    assert.equal(await quiz().evaluate(()=>document.body.dataset.submitted),undefined);
    assert.equal(await quiz().locator('[role=checkbox][aria-checked=true]').count(),2);
    assert.equal(await quiz().locator('[role=radio][aria-checked=true]').count(),0);
    assert.ok(bridge.snapshot().logs.some(log=>/仍未完成/.test(log.message)));
    console.log('PASS: 自定义多选按钮正确填写且去重识别；缺题显示原因，保留未完成测验并继续，不提交半份答案。');
    bridge.importBank([{question:'单选控件验证',answer:'答案二'}]);
    await page.goto('https://assessment.chaoxing.com/matched');
    await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:25000});
    assert.equal(await quiz().evaluate(()=>document.body.dataset.submitted),'yes');
    assert.equal(await quiz().evaluate(()=>document.body.dataset.submitClicks),'1');
    assert.equal(await quiz().evaluate(()=>document.body.dataset.optionClicks),'3','已选择选项不重复切换');
    console.log('PASS: 自定义单选、多选全部匹配后自动提交一次，实际确认完成后继续。');
    await page.goto('https://assessment.chaoxing.com/unsupported?unsupported=1');
    await wait(()=>bridge.snapshot().frames.some(f=>/题型暂不支持/.test(f.status)));
    await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:35000});
    assert.equal(await quiz().evaluate(()=>document.body.dataset.submitted),undefined);
    bridge.update({autoSubmit:false});await page.goto('https://assessment.chaoxing.com/manual');
    await wait(()=>bridge.snapshot().frames.some(f=>/等待你提交/.test(f.status)));
    await page.waitForTimeout(17000);assert.equal(await page.evaluate(()=>document.body.dataset.next),undefined);
    await quiz().getByText('提交',{exact:true}).click();
    await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:20000});
    assert.deepEqual(errors,[]);
    console.log('PASS: 未支持题型不会误提交；手动提交模式持续等待用户，确认完成后继续。');
    bridge.update({autoSubmit:true,skipUnanswered:false});
    await page.goto('https://assessment.chaoxing.com/work/selectWorkQuestionYiPiYue');
    await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:20000});
    assert.equal(await page.evaluate(()=>document.body.dataset.changed),undefined);
    assert.ok(bridge.snapshot().frames.some(f=>f.confirmed&&f.questions===0));
    console.log('PASS: 已批阅结果页识别为已提交，保持原有选项并进入下一课时。');
  }finally{await context?.close();await bridge.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
