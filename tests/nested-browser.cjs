const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createBridge } = require('../desktop/bridge.cjs');
const { summarizeSessions } = require('../desktop/ui/sessions.js');
const root = path.join(__dirname, '..');
const work = path.join(root, 'work', 'nested-browser');
const extension = path.join(work, 'extension');
fs.mkdirSync(work, { recursive: true });
fs.cpSync(path.join(root, 'extension'), extension, { recursive: true });
for (const name of ['manifest.json', 'background.js']) {
  const file = path.join(extension, name);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('127.0.0.1:17328', '127.0.0.1:17329'));
}
const wav = Buffer.alloc(32044);
wav.write('RIFF'); wav.writeUInt32LE(32036, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(32000, 40);
const token = 'c'.repeat(32);
const escape = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const player = `<!doctype html><html><meta charset="utf-8"><title>内嵌播放器</title><body><div data-coursebridge-player><audio controls></audio><button data-coursebridge-play onclick="document.querySelector('audio').src='https://media.chaoxing.com/tone.wav';this.hidden=true;document.body.dataset.loaded='yes'">播放</button></div></body></html>`;
(async () => {
  const bridge = createBridge({ dataDir: path.join(work, 'data'), port: 17329, token });
  let context;
  try {
    await bridge.listen();
    bridge.update({ enabled: true, autoNext: true, nextDelay: 2 });
    context = await chromium.launchPersistentContext(path.join(work, 'profile'), { executablePath: process.env.COURSEBRIDGE_CHROME, headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions'] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    await worker.evaluate(token => chrome.storage.local.set({ token }), token);
    await context.route(/https?:\/\/[^/]*chaoxing\.com\//, route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/tone.wav') return route.fulfill({ contentType: 'audio/wav', body: wav });
      if (url.pathname === '/knowledge/cards') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><title>章节内容</title><iframe allow="autoplay" srcdoc="${escape(player)}"></iframe></html>` });
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><meta charset="utf-8"><title>学生学习页面</title><h1 data-current-chapter>第一章</h1><iframe allow="autoplay" src="${url.protocol}//mooc1.chaoxing.com/knowledge/cards"></iframe><button data-coursebridge-next onclick="document.body.dataset.next='yes'">下一章节</button></html>` });
    });
    const page = await context.newPage();
    for (const protocol of ['https', 'http']) {
      await page.goto(`${protocol}://course.chaoxing.com/mycourse/studentstudy`);
      try { await page.waitForFunction(() => document.body.dataset.next === 'yes', null, { timeout: 20000 }); }
      catch (error) {
        for (const frame of page.frames()) console.log(await frame.evaluate(() => ({ url: location.href, media: [...document.querySelectorAll('audio,video')].map(m => ({ src: m.currentSrc, paused: m.paused, ended: m.ended, readyState: m.readyState, error: m.error?.code, playError: m.dataset.coursebridgePlayError })) })));
        throw error;
      }
      const frame = page.frames().find(frame => frame.url() === 'about:srcdoc');
      assert.ok(frame, 'srcdoc 播放器存在');
      assert.equal(await frame.evaluate(() => document.body.dataset.loaded), 'yes');
      assert.equal(await frame.evaluate(() => document.querySelector('audio').ended), true);
      const summary = summarizeSessions(bridge.snapshot().frames, true).find(item => item.title === '学生学习页面');
      assert.equal(summary.media, 1);
      assert.equal(summary.connectedFrames, 3);
      assert.notEqual(summary.status, '等待课程内容');
    }
    const inner = page.frames().find(frame => frame.url() === 'about:srcdoc');
    await inner.addScriptTag({ path: path.join(root, 'extension', 'adapter.js') });
    const timeoutResult = await inner.evaluate(async () => {
      let paused = false;
      const start = Date.now();
      const result = await CourseBridgeAdapter.playWithTimeout({ play: () => new Promise(() => {}), pause: () => { paused = true; } }, 60);
      return { result, paused, elapsed: Date.now() - start };
    });
    assert.equal(timeoutResult.result, false);
    assert.equal(timeoutResult.paused, true);
    assert.ok(timeoutResult.elapsed < 1000);
    fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ passed: true, scenarios: ['HTTPS nested iframe and srcdoc', 'HTTP nested iframe and srcdoc', 'source loaded by player button', 'main page chapter navigation', 'inner-player status aggregation', 'unresolved play promise timeout'] }, null, 2));
    console.log('PASS: HTTP/HTTPS 多层 iframe、srcdoc 播放器、点击加载媒体、自动播放、章节切换、状态汇总与播放超时恢复。');
  } finally { await context?.close(); await bridge.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
