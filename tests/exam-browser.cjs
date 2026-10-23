const { chromium } = require('playwright-core');
const { createBridge } = require('../desktop/bridge.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), work = path.join(root, 'work', 'exam-browser');
fs.mkdirSync(work, { recursive: true });
const extension = path.join(work, 'extension');
fs.cpSync(path.join(root, 'extension'), extension, { recursive: true });
for (const name of ['manifest.json', 'background.js']) {
  const file = path.join(extension, name);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('127.0.0.1:17328', '127.0.0.1:17342'));
}
// Test-only accelerated heartbeat. Production remains two seconds.
const script = path.join(extension, 'content.js');
fs.writeFileSync(script, fs.readFileSync(script, 'utf8').replace('setInterval(tick, 2000)', 'setInterval(tick, 100)'));
function question(number, prefix, hidden = false) {
  return `<section data-coursebridge-question id="q-${number}" style="display:${hidden ? 'none' : 'block'}"><h3 data-question-title>${prefix}第${number}题</h3><label><input type="radio" name="q${number}" value="0">选项甲</label><label><input type="radio" name="q${number}" value="1">选项乙</label></section>`;
}
function fixture(url) {
  const kind = url.searchParams.get('case'), index = Number(url.searchParams.get('questionIndex') || 0);
  const bulk = kind === 'bulk' || kind === 'bulk-missing';
  const total = bulk ? 85 : 3;
  const content = bulk ? Array.from({ length: total }, (_, i) => question(i + 1, kind, i !== 0)).join('') : question(index + 1, kind);
  return `<!doctype html><meta charset="utf-8"><title>模拟考试</title><body data-coursebridge-exam-total="${total}"><p>题量：${total}</p>${content}
    ${bulk ? `<aside id="answer-card">${Array.from({ length: total }, (_, i) => `<a href="#" onclick="event.preventDefault();show(${i});document.body.dataset.cardClicks=String(+(document.body.dataset.cardClicks||0)+1)">${i + 1}</a>`).join('')}</aside>` : ''}
    <button id="next-question" ${index === total - 1 && !bulk ? 'disabled' : ''}>下一题</button>
    <button id="submit" style="display:${!bulk ? 'inline-block' : 'none'}" onclick="document.body.dataset.submitClicks=String(+(document.body.dataset.submitClicks||0)+1);document.querySelector('#confirmation').style.display='block'">交卷</button>
    <div id="confirmation" role="dialog" style="display:none"><p>确认交卷？</p><button onclick="this.parentElement.style.display='none'">取消</button><button id="confirm" onclick="document.body.dataset.confirmClicks=String(+(document.body.dataset.confirmClicks||0)+1);document.body.dataset.submitted='yes';this.parentElement.style.display='none'">确认交卷</button></div><button data-coursebridge-next onclick="document.body.dataset.chapterNext='yes'">下一章节</button>
    <script>let current=${index};function show(number){current=number;document.querySelectorAll('[data-coursebridge-question]').forEach((q,i)=>q.style.display=i===number?'block':'none');document.querySelector('#next-question').disabled=number===${total - 1};document.querySelector('#submit').style.display=number===${total - 1}?'inline-block':'none';document.body.dataset.current=String(number)}
    document.querySelector('#next-question').onclick=()=>{document.body.dataset.nextClicks=String(+(document.body.dataset.nextClicks||0)+1);${bulk ? 'show(current+1)' : "location.href='?case=" + kind + "&questionIndex='+(current+1)"}};</script>`;
}
(async () => {
  const bridge = createBridge({ dataDir: fs.mkdtempSync(path.join(work, 'data-')), port: 17342 });
  let context;
  try {
    await bridge.listen();
    bridge.importBank(['bulk', 'dynamic', 'incomplete', 'manual'].flatMap(prefix => Array.from({ length: prefix === 'bulk' ? 85 : 3 }, (_, i) => ({ question: `${prefix}第${i + 1}题`, answer: '选项乙' }))));
    bridge.importBank(Array.from({ length: 84 }, (_, i) => ({ question: `bulk-missing第${i + 1}题`, answer: '选项乙' })));
    bridge.update({ enabled: true, autoAnswer: true, autoSubmit: true, autoNext: true, skipUnanswered: true, lookupMode: 'local', nextDelay: 2 });
    const counts = [];
    context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work, 'profile-')), { executablePath: process.env.COURSEBRIDGE_CHROME, headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions'] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(token => chrome.storage.local.set({ token }), bridge.snapshot().token);
    await context.route('https://exam.chaoxing.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture(new URL(route.request().url())) }));
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const open = async query => page.goto('https://exam.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew?' + query);
    await open('case=bulk');
    await page.waitForFunction(() => document.body.dataset.submitted === 'yes', null, { timeout: 25000 });
    assert.equal(await page.locator('input:checked').count(), 85);
    assert.equal(await page.evaluate(() => document.body.dataset.nextClicks), '84', '批量查题、仅当前题填写');
    assert.equal(await page.evaluate(() => document.body.dataset.cardClicks), undefined);
    assert.equal(await page.evaluate(() => document.body.dataset.submitClicks), '1');
    assert.equal(await page.evaluate(() => document.body.dataset.confirmClicks), '1');
    await page.waitForTimeout(8000);
    assert.equal(await page.evaluate(() => document.body.dataset.chapterNext), undefined, '交卷后保持结果页，不误用课程导航');
    console.log('PASS: 85 道题批量读取，仅填写当前题，顺序进入交卷页并确认一次。');
    await open('case=dynamic');
    await page.waitForFunction(() => document.body.dataset.submitted === 'yes', null, { timeout: 30000 });
    assert.equal(new URL(page.url()).searchParams.get('questionIndex'), '2');
    assert.equal(await page.locator('input:checked').count(), 1);
    assert.equal(await page.evaluate(() => document.body.dataset.submitClicks), '1');
    console.log('PASS: 服务端分页逐题保存并进入下一题，页面重新加载后仍能核对整卷进度，末题才交卷。');
    await open('case=incomplete&questionIndex=2');
    await page.waitForTimeout(18000);
    assert.equal(await page.evaluate(() => document.body.dataset.submitted), undefined);
    assert.equal(await page.evaluate(() => document.body.dataset.submitClicks), undefined);
    console.log('PASS: 直接进入最后一题时，未验证前面题目，不自动交卷或离开考试。');
    await open('case=bulk-missing');
    await page.waitForTimeout(18000);
    assert.equal(await page.locator('input:checked').count(), 84);
    assert.equal(await page.evaluate(() => document.body.dataset.submitClicks), undefined);
    assert.equal(await page.evaluate(() => document.body.dataset.nextClicks), '84');
    console.log('PASS: 整卷缺一个答案时可填写已匹配题目，但不会跳过或提交半份试卷。');
    bridge.update({ autoSubmit: false });
    await open('case=manual');
    await page.waitForURL('**questionIndex=2', { timeout: 25000 });
    await page.waitForTimeout(6000);
    assert.equal(await page.locator('input:checked').count(), 1);
    assert.equal(await page.evaluate(() => document.body.dataset.submitClicks), undefined);
    assert.deepEqual(errors, []);
    const result = { passed: true, hiddenQuestionsRead: 85, protocolBatchLimit: 30, noHiddenWrites: true, dynamicNextQuestion: true, neverSubmitsPartialPaper: true, manualSubmissionRespected: true, realExamAccessed: false, pageErrors: errors };
    fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify(result, null, 2));
    await page.screenshot({ path: path.join(work, 'exam-fixture.png'), fullPage: true });
    console.log(JSON.stringify(result));
  } finally { await context?.close(); await bridge.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
