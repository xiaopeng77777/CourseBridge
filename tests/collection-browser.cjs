const { chromium } = require('playwright-core');
const { createBridge } = require('../desktop/bridge.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const work = path.join(root, 'work', 'collection-browser');
const extension = path.join(work, 'extension');
fs.mkdirSync(work, { recursive: true });
fs.cpSync(path.join(root, 'extension'), extension, { recursive: true });
for (const name of ['manifest.json', 'background.js']) { const file = path.join(extension, name); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('127.0.0.1:17328', '127.0.0.1:17333')); }
(async () => {
  const dataDir = fs.mkdtempSync(path.join(work, 'data-'));
  const bridge = createBridge({ dataDir, port: 17333 });
  let context;
  try {
    await bridge.listen();
    context = await chromium.launchPersistentContext(path.join(work, 'profile'), { executablePath: process.env.COURSEBRIDGE_CHROME, headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions'] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(token => chrome.storage.local.set({ token }), bridge.snapshot().token);
    await context.route('https://collection.chaoxing.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><meta charset="utf-8"><title>题目收集验证</title><h1 data-current-chapter>独立验证课时</h1><section data-coursebridge-question><h3 data-question-title>收集到的答案是否应自动认定正确？</h3><label><input type="radio" name="q" checked>应该</label><label><input type="radio" name="q">不应该</label></section></html>' }));
    const page = await context.newPage(); await page.goto('https://collection.chaoxing.com/course');
    const wait = async predicate => { const started = Date.now(); while (!predicate()) { if (Date.now() - started > 15000) throw new Error('等待题库同步超时'); await new Promise(resolve => setTimeout(resolve, 100)); } };
    await wait(() => bridge.snapshot().pendingCount === 1);
    const entry = bridge.listBank({ filter: 'pending' }).entries[0];
    assert.deepEqual(entry.answers, [], '页面已选答案不能被认定为正确答案');
    assert.deepEqual(entry.options, ['应该', '不应该']);
    await page.reload(); await page.waitForTimeout(2300);
    assert.equal(bridge.snapshot().pendingCount, 1, '重复进入不重复收集');
    bridge.saveQuestion({ ...entry, answers: ['不应该'] });
    bridge.update({ enabled: true, autoAnswer: true, autoSubmit: false, autoNext: false });
    await page.waitForFunction(() => document.querySelectorAll('input')[1].checked);
    assert.equal(bridge.snapshot().bankCount, 1);
    assert.equal(bridge.snapshot().pendingCount, 0);
    fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ passed: true, capturedWhilePaused: true, neverTrustedSelectedOption: true, deduplicated: true, confirmedAnswerMatched: true }, null, 2));
    console.log('PASS: 真实插件自动收集题干和选项、已选答案不当成正确答案、刷新去重、补答案后本地匹配填写。');
  } finally { await context?.close(); await bridge.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
