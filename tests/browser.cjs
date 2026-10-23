const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createBridge } = require('../desktop/bridge.cjs');
const root = path.join(__dirname, '..');
const work = path.join(root, 'work', 'browser-test');
fs.mkdirSync(work, { recursive: true });
const chromePath = process.env.COURSEBRIDGE_CHROME;
if (!chromePath) throw new Error('请设置 COURSEBRIDGE_CHROME，指向支持加载开发扩展的 Chromium 可执行文件');
const token = 'b'.repeat(32);
function wav(seconds = 1) {
  const samples = 16000 * seconds, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(36 + samples * 2, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  return data;
}
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>课桥课程集成验证</title><body data-coursebridge-demo><h1 data-current-chapter>第一章</h1><audio controls src="/tone.wav"></audio><section data-coursebridge-question><h3 data-question-title>以下哪项是可再生能源？</h3><label><input type="radio" name="q" value="coal">A. 煤炭</label><label><input type="radio" name="q" value="solar">B. 太阳能</label></section><button data-coursebridge-submit onclick="document.body.dataset.submitted='yes'">提交答案</button><button data-coursebridge-next onclick="document.querySelector('h1').textContent='第二章';document.body.dataset.next='yes'">下一章节</button></body></html>`;
(async () => {
  const bridge = createBridge({ dataDir: path.join(work, 'data'), token });
  let context;
  try {
    await bridge.listen();
    bridge.importBank([{ question: '以下哪项是可再生能源？', answer: '太阳能' }]);
    bridge.update({ enabled: true, autoAnswer: true, autoSubmit: true, autoNext: true, nextDelay: 2 });
    context = await chromium.launchPersistentContext(path.join(work, 'profile'), { executablePath: chromePath, headless: true, args: [`--disable-extensions-except=${path.join(root, 'extension')}`, `--load-extension=${path.join(root, 'extension')}`], ignoreDefaultArgs: ['--disable-extensions'] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    await worker.evaluate(async token => chrome.storage.local.set({ token, clientId: 'browser-integration' }), token);
    await context.route('https://course.chaoxing.com/**', route => {
      const url = route.request().url();
      return route.fulfill(url.endsWith('.wav') ? { contentType: 'audio/wav', body: wav(url.endsWith('/long.wav') ? 30 : 1) } : { contentType: 'text/html', body: url.endsWith('/pause') ? fixture.replace('tone.wav', 'long.wav') : fixture });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://course.chaoxing.com/demo');
    await page.waitForSelector('#coursebridge-panel');
    await page.waitForFunction(() => document.body.dataset.submitted === 'yes', { timeout: 15000 });
    assert.equal(await page.locator('input[value=solar]').isChecked(), true);
    await page.waitForFunction(() => document.body.dataset.next === 'yes', { timeout: 20000 });
    assert.equal(await page.locator('h1').textContent(), '第二章');
    assert.equal(bridge.snapshot().frames.some(f => f.media === 1), true);
    await page.goto('https://course.chaoxing.com/pause');
    await page.waitForFunction(() => !document.querySelector('audio').paused);
    bridge.control('pause');
    await page.waitForFunction(() => document.querySelector('audio').paused);
    bridge.control('start');
    await page.waitForFunction(() => !document.querySelector('audio').paused);
    await bridge.close();
    await page.waitForFunction(() => document.querySelector('audio').paused);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: 已加载真实 MV3 插件；配对、题库匹配、自动填写、点击提交、音频播放、章节切换、暂停与断线暂停通过。');
    fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ passed: true, checks: ['MV3 extension loaded', 'authenticated loopback sync', 'answer selection', 'submit action', 'audio playback', 'automatic chapter navigation', 'pause', 'pause on disconnect'], errors }, null, 2));
  } finally { await context?.close(); await bridge.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
