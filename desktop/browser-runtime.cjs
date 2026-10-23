const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { findChromium } = require('./browser.cjs');

// Browser binaries are downloaded from Playwright's upstream distribution at
// the user's request, rather than being republished under this project's MIT license.
async function prepareBrowserRuntime({ runtimeDir, dataDir, dialog, parentWindow, spawnImpl = spawn }) {
  try { return findChromium(runtimeDir); } catch { /* First use. */ }
  const choice = await dialog.showMessageBox(parentWindow, {
    type: 'info', title: '准备课程浏览器',
    message: '首次使用需要下载独立的课程浏览器组件',
    detail: '将通过 Playwright 官方分发地址下载 Chrome for Testing，约 200 MB。浏览器由 Google 提供，适用其独立条款；课桥不重新授权该组件。下载期间请保持联网。相关链接见使用说明的“浏览器组件与许可”。',
    buttons: ['下载并打开', '稍后再说'], defaultId: 0, cancelId: 1, noLink: true
  });
  if (choice.response !== 0) throw new Error('浏览器组件尚未下载，可稍后再次点击打开课程浏览器');
  const temporary = path.join(dataDir, 'work', 'browser-download');
  fs.mkdirSync(temporary, { recursive: true });
  const cli = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'cli.js');
  await new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, [cli, 'install', 'chromium', '--no-shell'], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: runtimeDir, TEMP: temporary, TMP: temporary, TMPDIR: temporary }
    });
    let tail = '';
    const collect = chunk => { tail = (tail + chunk.toString()).slice(-3000); };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('浏览器组件下载失败，请检查网络后重试。' + (tail.includes('ENOSPC') ? ' 磁盘空间不足。' : ''))));
  });
  return findChromium(runtimeDir);
}
module.exports = { prepareBrowserRuntime };
