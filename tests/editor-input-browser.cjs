const { chromium } = require('playwright-core');
const { createTextTyper } = require('../desktop/typing.cjs');
const { createBridge } = require('../desktop/bridge.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), work = path.join(root, 'work/editor-input'); fs.mkdirSync(work, { recursive: true });
const extension = path.join(work, 'extension'); fs.cpSync(path.join(root, 'extension'), extension, { recursive: true });
for (const name of ['manifest.json', 'background.js', 'content.js']) {
  const file = path.join(extension, name); fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('127.0.0.1:17328', '127.0.0.1:17349').replace('setInterval(tick, 2000)', 'setInterval(tick, 100)'));
}
const answer = '第一段：人工智能技术应用可通过感知、分析与反馈改善建筑环境。\n第二段：方案以隐私保护、节能与无障碍使用为设计约束。\n' + '以真实需求验证构想，评价舒适性、能耗和维护成本，持续改进。'.repeat(40);
const title = kind => `【论述题】${kind}编辑器的长文本测试（1000字以上）`;
const norm = value => value.replace(/[\s\u200b\ufeff]/gu, '');
function fixture(kind, preview) {
  const body = kind === 'iframe' || kind === 'design' ? `<iframe id="editor-frame" src="/editor?kind=${kind}"></iframe><textarea id="backing" hidden></textarea>` : kind === 'plain' || kind === 'limited' ? `<textarea id="editor" ${kind === 'limited' ? 'maxlength="24"' : ''}></textarea>` : '<div id="editor" contenteditable="true"></div>';
  return `<!doctype html><meta charset="utf-8"><body data-coursebridge-exam-total="1"><section data-coursebridge-question><h3 data-question-title>${title(kind)}</h3><div role="toolbar"><input type="text" value="字号"></div>${body}</section><button onclick="document.body.dataset.submits=String(+(document.body.dataset.submits||0)+1)">交卷</button>
  <style>iframe,textarea,#editor{width:700px;height:220px}textarea[hidden]{display:none}</style>
  <script>
  window.savedText='';window.inputEvents=0;window.pasteEvents=0;window.untrustedInputs=0;
  function wire(el) {
    el.addEventListener('paste',e=>{ window.pasteEvents++;e.preventDefault(); });
    el.addEventListener('beforeinput',e=>{if(e.inputType==='insertFromPaste'){window.pasteEvents++;e.preventDefault();}});
    el.addEventListener('input',e=>{ if(!e.isTrusted){window.untrustedInputs++;return;}window.inputEvents++;window.savedText=el.value===undefined?el.innerText:el.value; });
  }
  const editor=document.querySelector('#editor');if(editor)wire(editor);
  const iframe=document.querySelector('iframe');if(iframe)iframe.onload=()=>{
    const el=iframe.contentDocument.body;wire(el);
    window.UE={instants:{testEditor:{body:el,textarea:document.querySelector('#backing'),fireEvent(){},getContentTxt(){return el.innerText},sync(){this.textarea.value=el.innerText}}}};
    document.body.dataset.editorReady='yes';
  };
  </script>`;
}
(async () => {
  let context, characterDelay = 0;
  const typer = createTextTyper({ getContext: () => context, get characterDelay() { return characterDelay; } });
  const bridge = createBridge({ dataDir: fs.mkdtempSync(path.join(work, 'data-')), port: 17349, textInput: typer.request });
  const errors = [], passed = [];
  try {
    await bridge.listen();
    bridge.importBank(['rich','iframe','design','plain','limited','manual','pause','changed','preview'].map(kind => ({ question: title(kind), type: 'essay', answers: [answer] })));
    context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work, 'profile-')), { executablePath: process.env.COURSEBRIDGE_CHROME, headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions'] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); await worker.evaluate(token => chrome.storage.local.set({ token }), bridge.snapshot().token);
    await context.route('https://typing.chaoxing.com/**', route => {
      const url = new URL(route.request().url());
      const body = url.pathname === '/editor' ? `<!doctype html><meta charset="utf-8"><body ${url.searchParams.get('kind') === 'design' ? '' : 'contenteditable="true"'}><script>${url.searchParams.get('kind') === 'design' ? "document.designMode='on'" : ''}</script>` : fixture(url.searchParams.get('kind'), url.pathname.endsWith('/preview'));
      return route.fulfill({ contentType: 'text/html', body });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const open = async (kind, enabled = true, preview = false) => {
      bridge.control('pause'); await page.goto(`https://typing.chaoxing.com/${preview ? 'exam-ans/mooc2/exam/preview' : 'exam-ans/exam/test/reVersionTestStartNew'}?kind=${kind}`);
      if (enabled) bridge.update({ enabled: true, autoAnswer: true, autoSubmit: true, autoNext: true, lookupMode: 'local' });
    };
    for (const kind of ['rich','iframe','design','plain']) {
      await open(kind);
      try { await page.waitForFunction(() => document.body.dataset.submits === '1', null, { timeout: 30000 }); }
      catch (error) { console.error(kind, bridge.snapshot().frames.map(f => ({ path: f.framePath, status: f.status }))); throw error; }
      const saved = await page.evaluate(() => ({ text: window.savedText, inputs: window.inputEvents, pastes: window.pasteEvents, untrusted: window.untrustedInputs, backing: document.querySelector('#backing')?.value }));
      assert.equal(norm(saved.text), norm(answer)); assert.equal(saved.pastes, 0); assert.equal(saved.untrusted, 0); assert.ok(saved.inputs >= Array.from(norm(answer)).length);
      if (saved.backing !== undefined) assert.equal(norm(saved.backing), norm(answer));
      await page.waitForTimeout(500); assert.equal(await page.getAttribute('body','data-submits'), '1');
      passed.push(kind + ':逐字输入、无粘贴、模型保存一致、仅提交一次'); console.log('PASS', passed.at(-1));
    }
    await open('manual', false); await page.locator('#editor').fill('这是用户手动写下的内容。'); bridge.update({ enabled: true, autoAnswer: true, autoSubmit: true }); await page.waitForTimeout(1500);
    assert.equal(await page.locator('#editor').innerText(),'这是用户手动写下的内容。'); assert.equal(await page.getAttribute('body','data-submits'),null); passed.push('手动正文保留');
    await open('limited'); await page.waitForFunction(() => window.inputEvents >= 24); await page.waitForTimeout(1200);
    assert.equal((await page.locator('#editor').inputValue()).length,24); assert.equal(await page.getAttribute('body','data-submits'),null);
    const inputs = await page.evaluate(() => window.inputEvents); await page.waitForTimeout(1000); assert.equal(await page.evaluate(() => window.inputEvents),inputs); passed.push('输入限制拒绝后停止、不循环重填、不交卷');
    for (const kind of ['pause','changed']) {
      await open(kind); await page.waitForFunction(() => window.inputEvents >= 40);
      if(kind === 'pause') bridge.control('pause'); else await page.locator('h3').evaluate(el => el.textContent = '页面已经切换到另一道题');
      await page.waitForTimeout(350); const saved = await page.locator('#editor').innerText(); await page.waitForTimeout(800);
      assert.equal(await page.locator('#editor').innerText(),saved); assert.ok(norm(saved).length < norm(answer).length); assert.equal(await page.getAttribute('body','data-submits'),null); passed.push(kind + ':中途停止并保留已输入正文');
    }
    await open('preview',true,true); await page.waitForTimeout(1400); assert.equal(await page.locator('#editor').innerText(),''); assert.equal(await page.getAttribute('body','data-submits'),null); passed.push('整卷预览只读');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(work,'result.json'), JSON.stringify({ passed: true, checks: passed, realExamAccessed: false, paidAPICalls: 0, clipboardUsed: false }, null, 2)); console.log('PASS', passed.slice(4));
  } finally { typer.close(); await context?.close(); await bridge.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
