const { chromium } = require('playwright-core');
const fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const { findChromium } = require('../desktop/browser.cjs');
const root = path.resolve(__dirname, '..');
(async () => {
  const executablePath = process.env.COURSEBRIDGE_CHROME || findChromium(path.join(root, 'runtime/browsers'));
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
    await page.addInitScript(() => {
      // Fictional data only. This preview never connects to a course or service.
      const state = { version: '0.1.25', token: 'preview-only', bankCount: 2, pendingCount: 1, offlineBankCount: 0, libraryRevision: 1,
        settings: { enabled: false, autoNext: true, muted: true, autoAnswer: false, autoSubmit: false, keepAwake: true, collectQuestions: true, useOfflineBank: false, lookupMode: 'local', saveOnlineAnswers: false, playbackRate: 1, nextDelay: 5 },
        power: { active: false, message: '任务已暂停，使用系统睡眠设置' },
        browser: { status: '浏览器已连接 · 插件已自动配对', version: '0.1.25', running: true, updatePending: false },
        frames: [{ tabKey: 'preview:1', frameId: 0, title: '演示课程', chapter: '1.2 多种资源的学习任务', status: '已连接，等待开始任务', media: 1, questions: 0, stepKind: 'media', extensionVersion: '0.1.25' }],
        logs: [{ time: Date.now(), level: 'info', message: '课程浏览器已连接，等待开始任务' }], enncy: {}, deepseek: {} };
      const entries = [ { id: 'demo-1', question: '示例：如何保留学习资料的来源？', options: ['记录来源与许可','忽略来源'], answers: ['记录来源与许可'], source: '原创演示数据', verified: true }, { id: 'demo-2', question: '示例：如何整理自己的章节笔记？', options: [], answers: [], source: '原创演示数据', verified: false } ];
      const snapshot = async () => structuredClone(state);
      window.coursebridge = { snapshot, listBank: async () => ({ entries: structuredClone(entries), total: entries.length, libraryRevision: 1 }), searchOffline: async () => ({ entries: [], total: 0 }), settings: snapshot, control: snapshot, openLearning: async () => state.browser, copyToken: async () => true, openExtension: async () => true };
    });
    await page.goto(pathToFileURL(path.join(root, 'desktop/ui/index.html')).href);
    await page.waitForSelector('.session'); await page.waitForTimeout(800);
    const target = path.join(root, 'docs/assets'); fs.mkdirSync(target, { recursive: true });
    await page.screenshot({ path: path.join(target, 'overview.png') });
    for (const name of ['settings', 'bank']) { await page.click(`[data-page=${name}]`); await page.waitForTimeout(400); await page.screenshot({ path: path.join(target, name + '.png') }); }
    console.log('Generated documentation screenshots using fictional data.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
