const { _electron: electron } = require('playwright-core');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'work', 'answer-chain-desktop');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const dataDir = fs.mkdtempSync(path.join(out, 'data-'));
  const env = { ...process.env, COURSEBRIDGE_TEST: '1', COURSEBRIDGE_TEST_PORT: '0', COURSEBRIDGE_DATA_DIR: dataDir }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.env.COURSEBRIDGE_TEST_EXE;
  let app;
  const launch = async () => {
    const application = await electron.launch({ executablePath: packaged || process.env.COURSEBRIDGE_ELECTRON || path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), args: packaged ? [] : [root], env });
    await application.evaluate(({ shell }) => {
      globalThis.testAnswerCalls = [];
      globalThis.testAnswerLinks = [];
      shell.openExternal = async url => { testAnswerLinks.push(url); };
      globalThis.fetch = async (url, init) => {
        const u = new URL(url);
        if (!['https://tk.enncy.cn', 'https://api.deepseek.com'].includes(u.origin)) throw new Error('Unexpected destination');
        let body;
        if (u.pathname === '/info') body = { code: 1, data: { times: 40 } };
        else if (u.pathname === '/user/balance') body = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '2.50' }] };
        else if (u.pathname === '/query') {
          const title = u.searchParams.get('title'); testAnswerCalls.push({ provider: 'enncy', title });
          body = title === '言溪已有' ? { code: 1, data: { question: title, answer: '甲', times: 39 } } : { code: 0, message: '未找到答案', data: { times: 38 } };
        } else if (u.pathname === '/chat/completions') {
          if (init.headers.Authorization !== 'Bearer sk-electron-fake-only') return { ok: false, status: 401 };
          const input = JSON.parse(init.body); testAnswerCalls.push({ provider: 'deepseek', title: JSON.parse(input.messages[1].content).question });
          body = { choices: [{ finish_reason: 'stop', message: { content: '{"indices":[1],"uncertain":false}' } }], usage: { total_tokens: 120 } };
        } else throw new Error('Unexpected endpoint');
        await new Promise(resolve => setTimeout(resolve, 60));
        if (init.signal.aborted) throw new Error('aborted');
        return { ok: true, text: async () => JSON.stringify(body) };
      };
    });
    return application;
  };
  try {
    app = await launch(); const page = await app.firstWindow(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.click('[data-page=bank]');await page.click('#bank-tab-services');await page.locator('#enncy-configuration > summary').click();await page.locator('#deepseek-configuration > summary').click();
    assert.equal(await page.locator('#lookupMode').inputValue(), 'enncy-deepseek');
    assert.equal(await page.locator('#saveOnlineAnswers').isChecked(), true);
    await page.fill('#enncy-token', 'fake-enncy-desktop-only'); await page.check('#enncy-enabled'); await page.click('#enncy-save');
    await page.waitForFunction(() => document.querySelector('#enncy-remaining').textContent === '40 次');
    await page.fill('#deepseek-key', 'sk-electron-fake-only'); await page.check('#deepseek-enabled'); await page.click('#deepseek-save');
    await page.waitForFunction(() => document.querySelector('#deepseek-balance').textContent === '¥2.50');
    assert.equal(await page.locator('#deepseek-key').inputValue(), '');
    let state = await page.evaluate(() => coursebridge.snapshot());
    assert.equal(state.deepseek.persisted, true); assert.equal(state.enncy.persisted, true);
    assert.equal(JSON.stringify(state).includes('sk-electron-fake-only'), false);
    for (const file of ['deepseek-config.json', 'enncy-config.json']) {
      const text = fs.readFileSync(path.join(dataDir, file), 'utf8'); assert.equal(text.includes('sk-electron-fake-only'), false); assert.equal(text.includes('fake-enncy-desktop-only'), false);
    }
    await page.click('#deepseek-keys'); await page.click('#deepseek-docs'); await page.click('#deepseek-account');
    assert.deepEqual(await app.evaluate(() => testAnswerLinks), ['https://platform.deepseek.com/api_keys', 'https://api-docs.deepseek.com/', 'https://platform.deepseek.com/']);
    await page.evaluate(() => coursebridge.settings({ enabled: true, autoAnswer: true, autoSubmit: false }));
    const ask = async (title, options = ['甲', '乙'], testPage = page) => {
      const current = await testPage.evaluate(() => coursebridge.snapshot());
      for (let i = 0; i < 250; i++) {
        const response = await fetch(`http://127.0.0.1:${current.port}/v1/sync`, { method: 'POST', headers: { Authorization: `Bearer ${current.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 'answer-chain-test', tabId: 1, frameId: 0, state: { stepKind: 'assessment', assessment: true, questions: 1, questionTotal: 1, extensionVersion: current.version }, questions: [{ id: 'q', title, options, multiple: false }] }) });
        const result = await response.json(); assert.equal(JSON.stringify(result).includes('sk-electron-fake-only'), false);
        if (result.answers[0].status !== 'pending') return result.answers[0];
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Answer lookup timeout');
    };
    assert.equal((await ask('言溪已有')).source, 'enncy');
    assert.equal((await app.evaluate(() => testAnswerCalls)).filter(x => x.provider === 'deepseek').length, 0);
    assert.equal((await ask('桌面缺题AI验证')).source, 'deepseek');
    await page.click('#bank-tab-local');await page.click('[data-bank-filter=unreviewed]');
    await page.waitForFunction(() => document.querySelectorAll('.library-row').length === 2);
    const row = page.locator('.library-row').filter({ hasText: '桌面缺题AI验证' });
    assert.match(await row.textContent(), /AI 参考.*未核验/);
    await row.locator('summary').click();await row.getByRole('button', { name: '核对答案', exact: true }).click();
    assert.match(await page.locator('#reference-note').textContent(), /未经人工核验/);
    await page.click('#save-question');
    await page.waitForFunction(() => document.querySelectorAll('.library-row').length === 1);
    await page.click('#bank-tab-services');await page.selectOption('#lookupMode', 'deepseek');
    await page.waitForFunction(() => document.querySelector('#enncy-status').textContent === '策略未使用');
    const before = (await app.evaluate(() => testAnswerCalls)).filter(x => x.provider === 'enncy').length;
    assert.equal((await ask('只用AI模式')).source, 'deepseek');
    assert.equal((await app.evaluate(() => testAnswerCalls)).filter(x => x.provider === 'enncy').length, before);
    await page.uncheck('#saveOnlineAnswers');
    await page.waitForFunction(() => document.querySelector('#routing-summary').textContent.includes('不自动保存'));
    assert.equal((await ask('不自动保存')).source, 'deepseek');
    const pending = await page.evaluate(() => coursebridge.listBank({ search: '不自动保存' })); assert.deepEqual(pending.entries[0].answers, []);
    await page.check('#saveOnlineAnswers');
    await page.selectOption('#lookupMode', 'enncy');
    await page.waitForFunction(() => document.querySelector('#deepseek-status').textContent === '策略未使用');
    const beforeAI = (await app.evaluate(() => testAnswerCalls)).filter(x => x.provider === 'deepseek').length;
    assert.equal((await ask('仅言溪未命中')).status, 'missing');
    assert.equal((await app.evaluate(() => testAnswerCalls)).filter(x => x.provider === 'deepseek').length, beforeAI);
    await page.selectOption('#lookupMode', 'local');
    await page.waitForFunction(() => document.querySelector('#routing-summary').textContent.startsWith('本地题库'));
    const local = await ask('只用AI模式', ['乙', '甲']); assert.equal(local.source, 'local'); assert.deepEqual(local.indices, [0]); assert.equal(local.ai, true);
    assert.equal((await app.evaluate(() => testAnswerCalls)).filter(x => x.provider === 'deepseek').length, beforeAI);
    for (const width of [980, 1180, 1440]) { await page.setViewportSize({ width, height: 860 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `width ${width}`); }
    await page.selectOption('#lookupMode', 'enncy-deepseek');
    await page.setViewportSize({ width: 1180, height: 860 });
    await page.evaluate(() => { scrollTo(0, 0); document.querySelector('#toast').classList.remove('show'); });
    await page.screenshot({ path: path.join(out, '查题策略与AI-桌面验证.png'), fullPage: true });
    await page.evaluate(async () => { await coursebridge.control('pause'); await coursebridge.settings({ lookupMode: 'local' }); await coursebridge.configureEnncy({ enabled: false }); await coursebridge.configureDeepSeek({ enabled: false }); });
    await page.click('[data-page=settings]');
    await page.fill('#major', '人工智能技术应用'); await page.click('#save-settings');
    assert.equal((await page.evaluate(() => coursebridge.snapshot())).settings.major, '人工智能技术应用');
    await page.click('[data-page=bank]'); await page.click('#bank-tab-local'); await page.click('#new-question');
    await page.fill('#question-text', '文本题桌面往返'); await page.selectOption('#question-type', 'essay');
    assert.equal(await page.locator('#question-options').isVisible(), false);
    await page.fill('#question-answers', '第一段正文。\n第二段正文。'); await page.click('#save-question');
    const textEntry = await page.evaluate(async () => (await coursebridge.listBank({search:'文本题桌面往返'})).entries[0]);
    assert.equal(textEntry.type, 'essay'); assert.deepEqual(textEntry.answers, ['第一段正文。\n第二段正文。']);
    assert.deepEqual(errors, []);
    await app.close(); app = await launch(); const restored = await app.firstWindow();
    await restored.click('[data-page=bank]');await restored.click('#bank-tab-services');await restored.locator('#deepseek-configuration > summary').click();await restored.locator('#enncy-configuration > summary').click();
    state = await restored.evaluate(() => coursebridge.snapshot());
    assert.equal(state.settings.major, '人工智能技术应用');
    assert.equal(state.deepseek.configured, true); assert.equal(state.deepseek.enabled, false); assert.equal(state.settings.lookupMode, 'local');
    const reused = await ask('只用AI模式', ['乙', '甲'], restored); assert.deepEqual(reused.indices, [0]); assert.equal(reused.source, 'local'); assert.equal(reused.ai, true);
    assert.deepEqual(await app.evaluate(() => testAnswerCalls), []);
    await restored.click('#deepseek-clear'); await restored.click('#enncy-clear');
    await restored.waitForFunction(() => document.querySelector('#deepseek-status').textContent === '未配置');
    const result = { passed: true, packagedExecutable: !!packaged, fallbackOrderVerified: true, selectedSourcesOnly: true, automaticSaveWithProvenance: true, humanReview: true, encryptedCredentials: true, localReuseAfterRestart: true, viewports: [980, 1180, 1440], actualAccountsUsed: false };
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
