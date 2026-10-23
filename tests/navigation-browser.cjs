const { chromium } = require('playwright-core');
const { createBridge } = require('../desktop/bridge.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const work = path.join(root, 'work', 'navigation-browser');
const extension = path.join(work, 'extension');
fs.mkdirSync(work, { recursive: true });
fs.cpSync(path.join(root, 'extension'), extension, { recursive: true });
for (const name of ['manifest.json', 'background.js']) { const file = path.join(extension, name); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('127.0.0.1:17328', '127.0.0.1:17330')); }
function wav(seconds) {
  const samples = 16000 * seconds, bytes = samples * 2, data = Buffer.alloc(44 + bytes);
  data.write('RIFF'); data.writeUInt32LE(36 + bytes, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(bytes, 40); return data;
}
function course(startQuiz) {
  return `<!doctype html><html><meta charset="utf-8"><title>学生学习页面</title><style>iframe{width:650px;height:200px}.posCatalog_select{padding:10px}.active{color:blue}</style>
  <div id="prev_tab"><ul class="prev_ul"><li class="${startQuiz ? '' : 'active'}" onclick="tab(0)">1 视频</li><li class="${startQuiz ? 'active' : ''}" onclick="tab(1)">2 章节测验</li></ul></div>
  <iframe id="video" allow="autoplay" ${startQuiz ? 'style="display:none"' : ''} src="https://media.chaoxing.com/video"></iframe>
  <iframe id="quiz" ${startQuiz ? '' : 'style="display:none"'} src="https://mooc1.chaoxing.com/work/exercise"></iframe>
  <aside><div id="chapter22" class="posCatalog_select posCatalog_active"><span class="posCatalog_name">2.2 脑机接口技术的应用与挑战</span></div><div id="chapter23" class="posCatalog_select"><span class="posCatalog_name" onclick="chapter()">2.3 互动环节—Q&A</span></div></aside>
  <script>function tab(n){document.querySelectorAll('.prev_ul li').forEach((el,i)=>el.classList.toggle('active',i===n));document.getElementById('video').style.display=n?'none':'';document.getElementById('quiz').style.display=n?'':'none';if(n)document.body.dataset.quizVisited='yes'}function chapter(){document.body.dataset.nextChapter='yes';document.getElementById('chapter22').classList.remove('posCatalog_active');document.getElementById('chapter23').classList.add('posCatalog_active');document.getElementById('video').src='https://media.chaoxing.com/video-two';tab(0)}</script></html>`;
}
(async () => {
  const token = 'd'.repeat(32);
  const bridge = createBridge({ dataDir: path.join(work, 'data'), port: 17330, token });
  let context;
  try {
    await bridge.listen();
    bridge.update({ enabled: true, autoNext: true, autoAnswer: false, skipUnanswered: true, nextDelay: 2 });
    context = await chromium.launchPersistentContext(path.join(work, 'profile'), { executablePath: process.env.COURSEBRIDGE_CHROME, headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions'] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(token => chrome.storage.local.set({ token }), token);
    await context.route(/https:\/\/[^/]*chaoxing\.com\//, route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('.wav')) return route.fulfill({ contentType: 'audio/wav', body: wav(url.pathname.includes('long') ? 60 : 1) });
      if (url.pathname === '/video' || url.pathname === '/video-two') return route.fulfill({ contentType: 'text/html', body: `<html><meta charset="utf-8"><title>视频</title><audio controls src="https://media.chaoxing.com/${url.pathname === '/video' ? 'short' : 'long'}.wav"></audio></html>` });
      if (url.pathname === '/work/exercise') return route.fulfill({ contentType: 'text/html', body: '<html><meta charset="utf-8"><title>章节测验</title><section data-coursebridge-question><h3 data-question-title>需要稍后完成的题目</h3><label><input type="radio" name="q">选项一</label><label><input type="radio" name="q">选项二</label></section><button data-coursebridge-submit onclick="document.body.dataset.clicked=\'yes\'">提交答案</button></html>' });
      return route.fulfill({ contentType: 'text/html', body: course(url.pathname === '/future') });
    });
    const page = await context.newPage();
    await page.goto('https://mooc1.chaoxing.com/skip');
    await page.waitForFunction(() => document.body.dataset.quizVisited === 'yes', null, { timeout: 25000 });
    await page.waitForFunction(() => document.body.dataset.nextChapter === 'yes', null, { timeout: 25000 });
    const quiz = page.frames().find(f => f.url().includes('/work/exercise'));
    assert.equal(await quiz.locator('input:checked').count(), 0);
    assert.equal(await quiz.evaluate(() => document.body.dataset.clicked), undefined);
    bridge.update({ enabled: true, autoAnswer: true, autoSubmit: true, skipUnanswered: false });
    await page.goto('https://mooc1.chaoxing.com/future');
    await page.waitForTimeout(8000);
    assert.equal(await page.evaluate(() => document.body.dataset.nextChapter), undefined);
    const futureQuiz = page.frames().find(f => f.url().includes('/work/exercise'));
    assert.equal(await futureQuiz.evaluate(() => document.body.dataset.clicked), undefined);
    await futureQuiz.evaluate(() => { const result = document.createElement('div'); result.className = 'submit-success'; result.textContent = '提交成功'; document.body.append(result); });
    await page.waitForFunction(() => document.body.dataset.nextChapter === 'yes', null, { timeout: 20000 });
    fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ passed: true, scenarios: ['video to same-chapter quiz', 'no-bank mode leaves questions untouched and continues 2.2 to 2.3', 'automatic-answer mode waits on missing answers', 'confirmed submission allows next chapter', 'hidden previous player does not block progression'] }, null, 2));
    console.log('PASS: 视频→章节测验→2.3；暂不答题模式不填写/不提交；自动答题模式等待确认提交；隐藏旧视频不阻塞。');
  } finally { await context?.close(); await bridge.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
