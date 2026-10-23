const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright-core');

function isLoginURL(value) {
  try { const url = new URL(value); return /^(?:passport2(?:-api)?|sso|login)\.chaoxing\.com$/i.test(url.hostname) || /\.chaoxing\.com$/i.test(url.hostname) && /^\/(?:login|sso)(?:\/|$)/i.test(url.pathname); }
  catch { return false; }
}
function courseURLs(values) {
  const valid = Array.isArray(values) ? values.filter(value => {try {const url=new URL(value);return url.protocol==='https:'&&(url.hostname==='chaoxing.com'||url.hostname.endsWith('.chaoxing.com'));}catch{return false;}}) : [];
  const content = valid.filter(value => !isLoginURL(value));
  if (content.length) return [...new Set(content)].slice(0,10);
  return [...new Set(valid.map(value => {
    const url=new URL(value);let refer;
    try { refer=new URL(url.searchParams.get('refer')); }catch{}
    if (!refer || isLoginURL(refer.href) || refer.hostname==='i.mooc.chaoxing.com') url.searchParams.set('refer','https://i.chaoxing.com/');
    return url.href;
  }))].slice(0,1);
}
function preferredPage(pages) {
  return pages.find(page => /\/mycourse\/studentstudy/.test(page.url())) || pages.find(page => /^https:\/\//.test(page.url()) && !isLoginURL(page.url())) || pages[0];
}

function findChromium(runtimeDir) {
  if (!fs.existsSync(runtimeDir)) throw new Error('课程浏览器尚未准备好，请重新安装课桥浏览器组件');
  for (const name of fs.readdirSync(runtimeDir)) {
    if (!/^chromium-/.test(name)) continue;
    for (const suffix of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
      const candidate = path.join(runtimeDir, name, suffix);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('未找到课程浏览器运行程序');
}
function extensionHash(directory) {
  const hash = createHash('sha256');
  for (const name of fs.readdirSync(directory).sort()) if (/\.(js|json|html|css)$/.test(name)) hash.update(name).update(fs.readFileSync(path.join(directory, name)));
  return hash.digest('hex');
}
async function ensureTextProtocol(worker) {
  return worker.evaluate(() => {
    if (globalThis.CourseBridgeTextProtocol === 1) return true;
    // Older persistent workers can survive an unpacked-file update. Test the
    // running code rather than trusting only the manifest's version string.
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (message?.type !== 'text-input') return;
      (async () => {
        const saved = await chrome.storage.local.get(['token','clientId']);
        if (!saved.token || !saved.clientId) throw Error('文本输入通道尚未配对');
        const response = await fetch('http://127.0.0.1:17328/v1/type', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + saved.token }, body: JSON.stringify({ clientId: saved.clientId, tabId: sender.tab?.id ?? -1, frameId: sender.frameId ?? 0, typing: message.typing, url: sender.url }), signal: AbortSignal.timeout(3500) });
        const result = await response.json(); if (!response.ok) throw Error(result.error || '文本输入通道连接失败'); return result;
      })().then(respond).catch(error => respond({ status: 'blocked', detail: error.message }));
      return true;
    });
    globalThis.CourseBridgeTextProtocol = 1;
    return true;
  });
}
const hasOpenPaper = pages => pages.some(page => { try { return /\/exam(?:-ans)?\/(?:exam\/)?test\/|\/exam(?:-ans)?\/(?:mooc\d+\/)?exam\/preview(?:\/|$)/i.test(new URL(page.url()).pathname); } catch { return false; } });
function createBrowserManager({ runtimeDir, extensionDir, profileDir, token, isTaskRunning, onReady = () => {}, onDisconnected = () => {}, headless = false, prepareContext = async () => {}, ensureRuntime = async () => {} }) {
  let context;
  let opening;
  let loadedHash;
  let changedHash;
  let changedAt = 0;
  let restarting = false;
  let closed = false;
  let state = { status: '尚未打开课程浏览器', version: '', updatePending: false, running: false };
  const snapshot = () => ({ ...state, ...(context && state.running && context.pages().some(page => isLoginURL(page.url())) && !context.pages().some(page => /\/mycourse\/studentstudy/.test(page.url())) ? { status:'学习通尚未登录，请先在浏览器完成登录' } : {}) });
  const pagesFile = path.join(path.dirname(profileDir), 'course-pages.json');
  async function open(urls) {
    if (opening) return opening;
    if (context) { const page = preferredPage(context.pages()) || await context.newPage(); await page.bringToFront(); return snapshot(); }
    opening = (async () => {
      if (!urls) { try { urls=courseURLs(JSON.parse(fs.readFileSync(pagesFile,'utf8'))); } catch { urls=[]; } }
      if (!urls.length) urls=['https://i.chaoxing.com/'];
      state = { ...state, status: '正在打开课程浏览器…', updatePending: false };
      try { findChromium(runtimeDir); }
      catch { state.status = '正在准备课程浏览器组件，首次下载可能需要几分钟…'; await ensureRuntime(); }
      const executablePath = findChromium(runtimeDir);
      fs.mkdirSync(profileDir, { recursive: true });
      const launched = await chromium.launchPersistentContext(profileDir, {
        executablePath, headless, viewport: null,
        args: ['--autoplay-policy=no-user-gesture-required', `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
        ignoreDefaultArgs: ['--disable-extensions']
      });
      context = launched;
      launched.on('close', () => {
        if (context !== launched) return;
        context = undefined;
        state = { ...state, running: false, status: '课程浏览器已关闭' };
        if (!restarting && !closed) onDisconnected();
      });
      try {
        launched.on('serviceworker', worker => { if (worker.url().startsWith('chrome-extension://')) void ensureTextProtocol(worker).catch(() => {}); });
        await prepareContext(launched);
        const worker = launched.serviceWorkers().find(worker => worker.url().startsWith('chrome-extension://')) || await launched.waitForEvent('serviceworker', { predicate: worker => worker.url().startsWith('chrome-extension://'), timeout: 20000 });
        const info = await worker.evaluate(async token => {
          await chrome.storage.local.set({ token });
          let saved;
          for (let i = 0; i < 40; i++) { saved = await chrome.storage.local.get('clientId'); if (saved.clientId) break; await new Promise(resolve => setTimeout(resolve, 50)); }
          if (!saved.clientId) throw new Error('插件标识尚未就绪');
          return { version: chrome.runtime.getManifest().version, clientId: saved.clientId };
        }, token);
        await ensureTextProtocol(worker);
        loadedHash = extensionHash(extensionDir);
        changedHash = undefined;
        onReady(info.clientId);
        const restored = launched.pages();
        const used = new Set();
        for (let i = 0; i < urls.length; i++) {
          const page = restored.find(page=>!used.has(page) && page.url()===urls[i]) || restored.find(page=>!used.has(page) && page.url()==='about:blank') || await launched.newPage();
          used.add(page);
          if (page.url()!==urls[i]) await page.goto(urls[i], { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        }
        state = { status: '浏览器已连接 · 插件已自动配对', version: info.version, updatePending: false, running: true };
        return snapshot();
      } catch (error) {
        context = undefined;
        await launched.close();
        onDisconnected();
        state = { ...state, running: false, status: '浏览器连接失败，请重试' };
        throw new Error(`课程浏览器未能就绪：${error.message}`);
      }
    })();
    try { return await opening; }
    catch (error) { state = { ...state, running: false, status: '课程浏览器打开失败，请重试' }; throw error; }
    finally { opening = undefined; }
  }
  async function checkUpdates() {
    if (!context || opening || restarting || closed) return;
    const current = extensionHash(extensionDir);
    if (current === loadedHash) { changedHash = undefined; return; }
    if (changedHash !== current) { changedHash = current; changedAt = Date.now(); return; }
    if (Date.now() - changedAt < 1500) return;
    const paperOpen = hasOpenPaper(context.pages());
    state = { ...state, updatePending: true, status: paperOpen ? '试卷页面仍打开，插件更新将在关闭试卷后应用' : isTaskRunning() ? '插件更新已准备，暂停任务后自动应用' : '正在自动更新插件…' };
    if (isTaskRunning() || paperOpen) return;
    restarting = true;
    const previous = context;
    const urls = previous.pages().map(page => page.url()).filter(url => { try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) && (parsed.hostname === 'chaoxing.com' || parsed.hostname.endsWith('.chaoxing.com')); } catch { return false; } });
    context = undefined;
    try { await previous.close(); await open(urls.length ? urls : undefined); }
    catch { state = { ...state, running: false, status: '插件更新尚未完成，请重新打开课程浏览器' }; }
    finally { restarting = false; }
  }
  const timer = setInterval(() => { checkUpdates().catch(() => { state = { ...state, updatePending: true, status: '正在等待插件文件更新完成' }; }); }, 1000);
  timer.unref();
  return {
    snapshot, open, checkUpdates,
    async close() { closed = true; clearInterval(timer); const previous = context; context = undefined; if (previous) { try { fs.writeFileSync(pagesFile,JSON.stringify(courseURLs(previous.pages().map(page=>page.url())))); } catch { /* Closing remains possible if the saved page list is unavailable. */ } } await previous?.close(); state.running = false; },
    context: () => context
  };
}
module.exports = { createBrowserManager, findChromium, extensionHash, courseURLs, isLoginURL, preferredPage, ensureTextProtocol, hasOpenPaper };
