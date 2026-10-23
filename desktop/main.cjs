const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, session, powerMonitor, powerSaveBlocker, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { createBridge } = require('./bridge.cjs');
const { createBrowserManager } = require('./browser.cjs');
const { readImport } = require('./library.cjs');
const { createPowerKeeper } = require('./power.cjs');
const { createTextTyper } = require('./typing.cjs');
const { prepareBrowserRuntime } = require('./browser-runtime.cjs');

const root = path.join(__dirname, '..');
const dataDir = process.env.COURSEBRIDGE_DATA_DIR || (app.isPackaged ? path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'CourseBridge', 'data') : path.join(root, 'data'));
fs.mkdirSync(path.join(dataDir, 'electron'), { recursive: true });
app.setPath('userData', path.join(dataDir, 'electron'));
app.setPath('sessionData', path.join(dataDir, 'electron'));
app.setAppUserModelId('org.coursebridge.desktop');
let bridge;
let window;
let browser;
let power;
let typer;
let shuttingDown = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    typer = createTextTyper({ getContext: () => browser?.context() });
    bridge = createBridge({ dataDir, secureStorage: safeStorage, textInput: typer.request, port: process.env.COURSEBRIDGE_TEST === '1' && process.env.COURSEBRIDGE_TEST_PORT === '0' ? 0 : undefined });
    try { await bridge.listen(); }
    catch { dialog.showErrorBox('无法启动课桥', '本机连接端口 17328 已被占用，请关闭另一个课桥实例后重试。'); return app.quit(); }
    power = createPowerKeeper({ powerMonitor, powerSaveBlocker, getState: () => bridge.snapshot() });
    const portableRoot = app.isPackaged ? path.dirname(process.execPath) : root;
    const runtimeDir = path.join(app.isPackaged ? dataDir : portableRoot, 'runtime', 'browsers');
    browser = createBrowserManager({
      runtimeDir, extensionDir: path.join(portableRoot, 'extension'), profileDir: path.join(dataDir, 'course-browser'), token: bridge.snapshot().token,
      ensureRuntime: () => prepareBrowserRuntime({ runtimeDir, dataDir, dialog, parentWindow: window }),
      isTaskRunning: () => bridge.snapshot().settings.enabled,
      onReady: id => bridge.useClient(id),
      onDisconnected: () => { bridge.control('pause'); bridge.useClient(null); },
      headless: process.env.COURSEBRIDGE_TEST === '1'
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const pageURL = pathToFileURL(path.join(__dirname, 'ui', 'index.html')).href;
    window = new BrowserWindow({ width: 1180, height: 860, minWidth: 980, minHeight: 680, show: process.env.COURSEBRIDGE_TEST !== '1', title: '课桥 · CourseBridge', icon: path.join(__dirname, 'assets', 'app.ico'), backgroundColor: '#f5f6fa', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== pageURL) event.preventDefault(); });
    const handle = (name, fn) => ipcMain.handle(name, (event, ...args) => {
      if (event.sender !== window.webContents || event.senderFrame?.url !== pageURL) throw new Error('不允许的窗口');
      return fn(...args);
    });
    handle('snapshot', () => ({ ...bridge.snapshot(), browser: browser.snapshot(), power: power.refresh() }));
    handle('settings', settings => { const result = bridge.update(settings); power.refresh(); return result; });
    handle('control', action => { const result = bridge.control(action); power.refresh(); return result; });
    handle('copy-token', () => { clipboard.writeText(bridge.snapshot().token); return true; });
    handle('open-extension', () => shell.openPath(path.join(app.isPackaged ? path.dirname(process.execPath) : root, 'extension')));
    handle('open-learning', () => browser.open());
    handle('bank-list', query => bridge.listBank(query));
    handle('offline-reference', question => bridge.offlineReference(question));
    handle('offline-search', query => bridge.searchOffline(query));
    handle('enncy-config', input => bridge.configureEnncy(input));
    handle('enncy-refresh', () => bridge.refreshEnncy());
    handle('enncy-retry', () => bridge.retryEnncy());
    handle('deepseek-config', input => bridge.configureDeepSeek(input));
    handle('deepseek-refresh', () => bridge.refreshDeepSeek());
    handle('deepseek-retry', () => bridge.retryDeepSeek());
    handle('open-deepseek', page => shell.openExternal(page === 'docs' ? 'https://api-docs.deepseek.com/' : page === 'keys' ? 'https://platform.deepseek.com/api_keys' : 'https://platform.deepseek.com/'));
    handle('open-enncy', page => shell.openExternal(page === 'docs' ? 'https://tk.enncy.cn/tk/article?uid=8ca2dbdd621943c4ba98ebba4d56e568' : page === 'account' ? 'https://tk.enncy.cn/user/dashboard' : 'https://tk.enncy.cn/'));
    handle('bank-save', input => bridge.saveQuestion(input));
    handle('bank-export', async () => {
      const chosen = await dialog.showSaveDialog(window, { title: '导出本地题库备份', defaultPath: path.join(path.dirname(dataDir), '课桥题库备份.json'), filters: [{ name: 'JSON 题库备份', extensions: ['json'] }] });
      if (chosen.canceled || !chosen.filePath) return false;
      fs.writeFileSync(chosen.filePath, JSON.stringify(bridge.exportBank(), null, 2));
      return true;
    });
    handle('import-bank', async () => {
      const chosen = await dialog.showOpenDialog(window, { title: '合并导入本地题库', filters: [{ name: '题库文件（JSON / CSV）', extensions: ['json', 'csv'] }], properties: ['openFile'] });
      if (chosen.canceled) return null;
      if (fs.statSync(chosen.filePaths[0]).size > 8 * 1024 * 1024) throw new Error('题库文件过大，最大支持 8 MB');
      return bridge.importBank(readImport(fs.readFileSync(chosen.filePaths[0], 'utf8'), path.extname(chosen.filePaths[0])));
    });
    await window.loadURL(pageURL);
    if (process.argv.includes('--open-course-browser')) browser.open().catch(error => dialog.showErrorBox('课程浏览器未能打开', error.message));
    if (process.env.COURSEBRIDGE_TEST === '1' && process.env.COURSEBRIDGE_SMOKE_OUTPUT) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      fs.writeFileSync(process.env.COURSEBRIDGE_SMOKE_OUTPUT, (await window.webContents.capturePage()).toPNG());
      app.quit();
    }
  }).catch(error => { dialog.showErrorBox('课桥启动失败', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (shuttingDown) return;
    event.preventDefault(); shuttingDown = true;
    power?.dispose();
    typer?.close();
    Promise.allSettled([browser?.close(), bridge?.close()]).finally(() => app.quit());
  });
}
