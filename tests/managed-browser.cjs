const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createBridge } = require('../desktop/bridge.cjs');
const { createBrowserManager } = require('../desktop/browser.cjs');
const root = path.join(__dirname, '..');
const currentVersion = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8')).version;
const nextVersion = currentVersion.replace(/\d+$/, number => String(Number(number) + 1));
const work = path.join(root, 'work', 'managed-browser-test');
const extensionDir = path.join(work, 'extension');
fs.mkdirSync(work, { recursive: true });
fs.cpSync(path.join(root, 'extension'), extensionDir, { recursive: true });
for (const name of ['manifest.json', 'background.js']) { const file = path.join(extensionDir, name); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('127.0.0.1:17328', '127.0.0.1:17331')); }
async function waitFor(predicate, timeout = 25000) { const started = Date.now(); while (!predicate()) { if (Date.now() - started > timeout) throw new Error('等待自动浏览器状态超时'); await new Promise(resolve => setTimeout(resolve, 100)); } }
(async () => {
  const bridge = createBridge({ dataDir: path.join(work, 'data'), port: 17331 });
  let manager;
  try {
    await bridge.listen();
    manager = createBrowserManager({
      runtimeDir: process.env.COURSEBRIDGE_BROWSER_RUNTIME || path.join(root, 'runtime', 'browsers'), extensionDir, profileDir: path.join(work, 'profile'), token: bridge.snapshot().token,
      isTaskRunning: () => bridge.snapshot().settings.enabled,
      onReady: id => bridge.useClient(id), onDisconnected: () => { bridge.control('pause'); bridge.useClient(null); }, headless: true,
      prepareContext: context => context.route('https://*.chaoxing.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><meta charset="utf-8"><title>课桥专用浏览器验证</title><h1>独立验证页面</h1></html>' }))
    });
    const first = await manager.open();
    assert.equal(first.version, currentVersion);
    assert.equal(first.running, true);
    const context = manager.context();
    await manager.open();
    assert.equal(manager.context(), context, '重复点击复用已有浏览器');
    const worker = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
    const saved = await worker.evaluate(() => chrome.storage.local.get('token'));
    assert.equal(saved.token, bridge.snapshot().token, '自动配对，不通过网页传递配对码');
    await waitFor(() => bridge.snapshot().frames.length > 0);
    assert.equal(bridge.snapshot().frames[0].extensionVersion, currentVersion);
    const page = context.pages()[0];
    await page.evaluate(() => localStorage.setItem('coursebridge-profile-test', 'preserved'));
    bridge.control('start');
    const manifestPath = path.join(extensionDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); manifest.version = nextVersion; fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    await waitFor(() => manager.snapshot().updatePending);
    assert.equal(manager.snapshot().version, currentVersion, '运行中的任务不强制刷新');
    bridge.control('pause');
    await waitFor(() => manager.snapshot().version === nextVersion);
    const updatedPage = manager.context().pages()[0];
    await updatedPage.waitForLoadState('domcontentloaded');
    assert.equal(await updatedPage.evaluate(() => localStorage.getItem('coursebridge-profile-test')), 'preserved');
    fs.writeFileSync(path.join(work, 'result.json'), JSON.stringify({ passed: true, scenarios: ['independent current browser runtime', 'automatic extension loading', 'automatic pairing', 'one browser instance', 'update deferred while task runs', 'automatic update after pause', 'profile and page restored'] }, null, 2));
    console.log('PASS: 专用浏览器自动加载与配对、重复打开复用、运行时延后更新、暂停后自动更新、资料与页面保留。');
  } finally { await manager?.close(); await bridge.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
