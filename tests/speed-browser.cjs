const { chromium } = require('playwright-core');
const { createBridge } = require('../desktop/bridge.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const work = path.join(root, 'work', 'speed-browser');
const extension = path.join(work, 'extension');
fs.mkdirSync(work, { recursive: true });
fs.cpSync(path.join(root, 'extension'), extension, { recursive: true });
for (const name of ['manifest.json', 'background.js']) {
  const file = path.join(extension, name);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('127.0.0.1:17328', '127.0.0.1:17332'));
}
function audioData() {
  const bytes = 16000 * 2 * 30, data = Buffer.alloc(44 + bytes);
  data.write('RIFF'); data.writeUInt32LE(36 + bytes, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(bytes, 40); return data;
}
(async () => {
  const bridge = createBridge({ dataDir: path.join(work, 'data'), port: 17332 });
  let context;
  try {
    await bridge.listen();
    bridge.update({ enabled: true, playbackRate: 4, autoNext: false, autoAnswer: false, muted: true });
    context = await chromium.launchPersistentContext(path.join(work, 'profile'), {
      executablePath: process.env.COURSEBRIDGE_CHROME, headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions']
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    await worker.evaluate(token => chrome.storage.local.set({ token }), bridge.snapshot().token);
    await context.route('https://speed.chaoxing.com/**', route => route.fulfill(route.request().url().endsWith('.wav') ? { contentType: 'audio/wav', body: audioData() } : { contentType: 'text/html', body: '<!doctype html><html><meta charset="utf-8"><title>倍速验证</title><h1>独立验证页面</h1><audio loop controls src="/tone.wav"></audio></html>' }));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://speed.chaoxing.com/course');
    for (const rate of [4, 8, 16]) {
      bridge.update({ playbackRate: rate });
      await page.waitForFunction(expected => { const media = document.querySelector('audio'); return media.playbackRate === expected && !media.paused; }, rate, { timeout: 15000 });
      const measured = await page.evaluate(async () => { const media = document.querySelector('audio'); const before = media.currentTime; const start = performance.now(); await new Promise(resolve => setTimeout(resolve, 300)); const elapsed = (performance.now() - start) / 1000; let progressed = media.currentTime - before; if (progressed < 0) progressed += media.duration; return progressed / elapsed; });
      assert.ok(measured > rate * 0.65 && measured < rate * 1.4, `实际媒体进度应接近 ${rate} 倍，测得 ${measured.toFixed(1)}`);
    }
    // A player rejecting a speed must report that issue while keeping bridge communication alive.
    const debug = await context.newCDPSession(page);
    const worlds = [];
    debug.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
    await debug.send('Runtime.enable');
    const extensionWorld = worlds.find(world => world.auxData?.type === 'isolated' && !world.name.startsWith('__playwright'));
    assert.ok(extensionWorld, '找到实际插件的隔离执行环境');
    const injected = await debug.send('Runtime.evaluate', { contextId: extensionWorld.id, expression: "Object.defineProperty(document.querySelector('audio'), 'playbackRate', { configurable: true, get: () => 1, set: () => { throw new DOMException('Unsupported speed', 'NotSupportedError'); } })" });
    assert.equal(injected.exceptionDetails, undefined);
    bridge.update({ playbackRate: 12 });
    await page.waitForFunction(() => { const host = document.getElementById('coursebridge-panel'); return !!host; });
    const started = Date.now();
    while (!bridge.snapshot().frames.some(frame => /不支持 12 倍速/.test(frame.status))) {
      if (Date.now() - started > 15000) throw new Error('未收到播放器速度限制说明');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ passed: true, rates: [4, 8, 16], checkedActualMediaProgress: true, unsupportedPlayerMessage: true }, null, 2));
    console.log('PASS: 真实插件设置 4/8/16 倍、实际媒体进度检查，以及播放器拒绝倍速时的说明。');
  } finally { await context?.close(); await bridge.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
