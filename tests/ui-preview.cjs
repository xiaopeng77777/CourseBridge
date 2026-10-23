const { chromium } = require('playwright-core');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const output = path.join(root, 'outputs');
(async () => {
  fs.mkdirSync(output, { recursive: true });
  if (!process.env.COURSEBRIDGE_CHROME) throw new Error('请设置 COURSEBRIDGE_CHROME');
  const browser = await chromium.launch({ executablePath: process.env.COURSEBRIDGE_CHROME, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 1 });
    const screenshot = async name => {
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForFunction(() => !document.querySelector('#toast').classList.contains('show'));
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(output, name), fullPage: true });
    };
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const state = {
        bankCount: 0, frames: [], logs: [],
        browser: { status: '尚未打开课程浏览器', running: false, version: '', updatePending: false },
        settings: { enabled: false, autoNext: true, muted: true, autoAnswer: false, autoSubmit: false, skipUnanswered: true, playbackRate: 1, nextDelay: 5 }
      };
      window.coursebridge = {
        snapshot: async () => structuredClone(state),
        control: async action => { if (action !== 'next') state.settings.enabled = action === 'start'; state.logs.unshift({ time: Date.now(), message: action === 'start' ? '任务已启动' : action === 'pause' ? '任务已暂停' : '已请求下一步' }); return structuredClone(state); },
        settings: async settings => { Object.assign(state.settings, settings); return structuredClone(state); },
        copyToken: async () => true, openExtension: async () => true,
        openLearning: async () => { Object.assign(state.browser, { status: '浏览器已连接 · 插件已自动配对', running: true, version: '0.1.4' }); return structuredClone(state.browser); },
        importBank: async () => { state.bankCount = 2; return structuredClone(state); }
      };
      window.setPreviewState = patch => { Object.assign(state, patch); };
    });
    await page.goto(pathToFileURL(path.join(root, 'desktop', 'ui', 'index.html')).href);
    await page.waitForSelector('#course-empty:not([hidden])');
    assert.equal(await page.locator('#pause').isDisabled(), true);
    assert.equal(await page.locator('#next').isDisabled(), true);
    await screenshot('新版界面-未连接.png');
    await page.click('#open-learning');
    await page.waitForFunction(() => document.querySelector('#browser-badge').textContent === '已连接');
    await page.click('#start');
    await page.waitForFunction(() => document.querySelector('#task-state').textContent === '等待内容');
    assert.equal(await page.locator('#start').isDisabled(), true);
    await page.evaluate(() => window.setPreviewState({ frames: [
      { tabKey: 'preview:1', frameId: 0, title: '学生学习页面', chapter: '2.2  脑机接口技术的应用与挑战\n\t1个待完成任务点1', status: '课程主页面已连接，等待内嵌播放器', media: 0, questions: 0, extensionVersion: '0.1.4', iframeCount: 2 },
      { tabKey: 'preview:1', frameId: 1, title: '课程视频', chapter: '', status: '正在播放课程', media: 1, questions: 0, extensionVersion: '0.1.4' }
    ] }));
    await page.waitForFunction(() => document.querySelector('#task-state').textContent === '运行中');
    assert.equal(await page.locator('#course-empty').isVisible(), false);
    assert.equal(await page.locator('.session h3').textContent(), '2.2 脑机接口技术的应用与挑战');
    assert.match(await page.locator('#answer-mode').textContent(), /暂不答题/);
    await screenshot('新版界面-总览.png');
    await page.click('#pause');
    await page.waitForFunction(() => document.querySelector('#task-state').textContent === '已暂停');
    assert.equal(await page.locator('#start').isDisabled(), false);
    await page.click('[data-page=settings]');
    await page.check('#autoAnswer');
    assert.equal(await page.locator('#skipUnanswered').isDisabled(), true);
    assert.match(await page.locator('#save-note').textContent(), /未保存/);
    for (const rate of ['4', '8', '16']) await page.selectOption('#playbackRate', rate);
    await page.click('#save-settings');
    await page.waitForFunction(() => document.querySelector('#save-note').textContent.startsWith('已保存'));
    await screenshot('新版界面-设置.png');
    await page.click('[data-page=overview]');
    assert.match(await page.locator('#runtime-settings').textContent(), /16/);
    assert.match(await page.locator('#answer-mode').textContent(), /等待你提交/);
    await page.click('[data-page=bank]'); await page.click('#import-bank');
    assert.equal(await page.locator('#bank-total').textContent(), '2 道题目');
    await page.click('[data-page=extension]');
    assert.equal(await page.locator('.manual-connect').getAttribute('open'), null);
    assert.match(await page.locator('#extension').textContent(), /无需另外安装谷歌/);
    await screenshot('新版界面-连接.png');
    await page.locator('.manual-connect > summary').click();
    await page.click('#copy-token'); await page.click('#open-extension');
    await page.click('[data-page=logs]'); assert.ok(await page.locator('.log-row').count());
    for (const width of [1180, 980]) {
      await page.setViewportSize({ width, height: width === 980 ? 680 : 800 });
      for (const name of ['overview', 'settings', 'bank', 'extension', 'logs']) {
        await page.click(`[data-page=${name}]`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px ${name} 页面不应横向溢出`);
        if (name === 'overview') {
          await page.evaluate(() => scrollTo(0, 0));
          const action = await page.locator('#start').boundingBox();
          assert.ok(action.y + action.height <= page.viewportSize().height, `${width}px 开始按钮应在首屏内`);
        }
      }
    }
    await page.click('[data-page=overview]');
    await screenshot('新版界面-紧凑窗口.png');
    assert.deepEqual(errors, []);
    console.log('PASS: 五个页面、空状态与课程状态、开始暂停、设置保存及摘要、手动连接入口、1180/980 像素布局检查通过。');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
