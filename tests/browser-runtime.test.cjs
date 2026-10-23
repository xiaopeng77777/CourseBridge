const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { prepareBrowserRuntime } = require('../desktop/browser-runtime.cjs');
const parent = path.resolve(__dirname, '../work/browser-runtime-test');
fs.mkdirSync(parent, { recursive: true });
const fixture = () => fs.mkdtempSync(path.join(parent, 'case-'));
test('首次浏览器下载经用户选择；取消时不启动下载', async () => {
  const dir = fixture(); let spawned = false;
  await assert.rejects(prepareBrowserRuntime({ runtimeDir: path.join(dir, 'runtime'), dataDir: dir, dialog: { showMessageBox: async () => ({ response: 1 }) }, spawnImpl: () => { spawned = true; } }), /尚未下载/);
  assert.equal(spawned, false);
});
test('组件通过匹配的 Playwright CLI 安装到独立目录；失败不伪报成功', async () => {
  const dir = fixture(), runtimeDir = path.join(dir, 'runtime'); let args, options;
  const spawnImpl = (_exe, a, o) => {
    args = a; options = o;
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    process.nextTick(() => child.emit('close', 1)); return child;
  };
  await assert.rejects(prepareBrowserRuntime({ runtimeDir, dataDir: dir, dialog: { showMessageBox: async () => ({ response: 0 }) }, spawnImpl }), /下载失败/);
  assert.deepEqual(args.slice(1), ['install', 'chromium', '--no-shell']);
  assert.equal(options.env.PLAYWRIGHT_BROWSERS_PATH, runtimeDir);
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(options.windowsHide, true);
});
test('已有完整组件时无需提示或再次下载', async () => {
  const dir = fixture(), runtimeDir = path.join(dir, 'runtime');
  const exe = path.join(runtimeDir, 'chromium-fixture', 'chrome-win64', 'chrome.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true }); fs.writeFileSync(exe, 'fixture');
  const actual = await prepareBrowserRuntime({ runtimeDir, dataDir: dir, dialog: { showMessageBox: async () => assert.fail('不应提示') }, spawnImpl: () => assert.fail('不应下载') });
  assert.equal(actual, exe);
});
test('下载退出成功后仍须确认可执行文件存在', async () => {
  const dir = fixture(), runtimeDir = path.join(dir, 'runtime');
  const spawnImpl = () => { const child = new EventEmitter(); process.nextTick(() => child.emit('close', 0)); return child; };
  await assert.rejects(prepareBrowserRuntime({ runtimeDir, dataDir: dir, dialog: { showMessageBox: async () => ({ response: 0 }) }, spawnImpl }), /尚未准备好/);
});
