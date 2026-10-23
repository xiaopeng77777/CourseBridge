const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeSettings, validateBank, matchAnswers, isTextQuestion, needsMajor } = require('../extension/rules.js');
const { summarizeSessions } = require('./ui/sessions.js');
const { createLibrary } = require('./library.cjs');
const { openOfflineBank } = require('./offline-bank.cjs');
const { assessmentProgress } = require('./progression.cjs');
const { createFontDecoder } = require('./font.cjs');
const { createEnncy } = require('./enncy.cjs');
const { createDeepSeek } = require('./deepseek.cjs');
const { onlineChain, resolveOnline } = require('./answer-routing.cjs');

const PORT = 17328;
function createBridge({ dataDir, port = PORT, token: suppliedToken, now = Date.now, secureStorage, enncyOptions = {}, deepseekOptions = {}, textInput } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const statePath = path.join(dataDir, 'settings.json');
  let saved = {};
  if (fs.existsSync(statePath)) saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const token = suppliedToken || saved.token || randomBytes(16).toString('hex');
  let settings = sanitizeSettings({ ...saved.settings, enabled: false });
  const library = createLibrary({ dataDir, seed: validateBank(saved.bank || []) });
  const offline = openOfflineBank(dataDir);
  const decodeFont = createFontDecoder(dataDir);
  const enncy = createEnncy({ ...enncyOptions, dataDir, secureStorage, now });
  const deepseek = createDeepSeek({ ...deepseekOptions, dataDir, secureStorage, now });
  const providers = { enncy, deepseek };
  const route = () => { for (const [name, provider] of Object.entries(providers)) provider.setActive(onlineChain(settings.lookupMode).includes(name)); };
  const cancelOnline = () => { enncy.cancelPending(); deepseek.cancelPending(); };
  route();
  let bank = library.matcherBank();
  const frames = new Map();
  const assessmentWaits = new Map();
  const logs = [];
  let activeClientId = null;
  let command = { revision: 0, action: 'pause' };
  const persist = () => fs.writeFileSync(statePath, JSON.stringify({ token, settings: { ...settings, enabled: false }, bank }, null, 2), { mode: 0o600 });
  const log = (message, level = 'info') => {
    const previous = logs[0];
    if (previous?.message === message && now() - previous.time < 10000) return;
    logs.unshift({ time: now(), message: String(message).slice(0, 500), level });
    logs.splice(150);
  };
  persist();
  const snapshot = () => ({ version: '0.1.25', token, port: server.address()?.port || port, settings, enncy: enncy.snapshot(), deepseek: deepseek.snapshot(), ...library.stats(), offlineBankCount: offline.count, frames: [...frames.values()].filter(f => now() - f.seen < 12000 && (!activeClientId || f.tabKey.startsWith(activeClientId + ':'))), logs });
  const saveDiagnostic = () => {
    const recent = snapshot();
    fs.writeFileSync(path.join(dataDir, 'last-status.json'), JSON.stringify({ version: recent.version, time: now(), enabled: settings.enabled, sessions: summarizeSessions(recent.frames, settings.enabled), frames: recent.frames.map(({ title, chapter, status, media, questions, complete, iframeCount, iframeOrigins, frameHost, framePath, extensionVersion, frameId, visible, assessment, confirmed, taskComplete, stepKind, matchSummary, submitState }) => ({ title, chapter, status, media, questions, complete, iframeCount, iframeOrigins, frameHost, framePath, extensionVersion, frameId, visible, assessment, confirmed, taskComplete, stepKind, matchSummary, submitState })) }, null, 2));
  };
  const update = (input) => {
    assessmentWaits.clear();
    const previousMode = settings.lookupMode;
    settings = sanitizeSettings({ ...settings, ...input });
    if (!settings.enabled || !settings.autoAnswer || previousMode !== settings.lookupMode) cancelOnline();
    route();
    persist();
    log(settings.enabled ? '任务已启动' : '任务已暂停');
    return snapshot();
  };
  const control = (action) => {
    if (!['start', 'pause', 'next'].includes(action)) throw new Error('未知操作');
    if (action === 'next') cancelOnline();
    if (action !== 'next') update({ enabled: action === 'start' });
    command = { revision: command.revision + 1, action };
    if (action === 'next') log('已请求切换下一章节');
    return snapshot();
  };
  const respond = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return respond(res, 403, { error: '不允许的来源' });
    if (req.headers.host !== `127.0.0.1:${server.address().port}`) return respond(res, 403, { error: '不允许的主机' });
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      return respond(res, 204, {});
    }
    if (req.url === '/health' && req.method === 'GET') return respond(res, 200, { name: 'CourseBridge', version: '0.1.25' });
    const provided = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (Buffer.byteLength(provided) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(provided), Buffer.from(token))) return respond(res, 401, { error: '配对码不正确' });
    if (req.method !== 'POST' || !['/v1/sync','/v1/font','/v1/type'].includes(req.url)) return respond(res, 404, { error: '接口不存在' });
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > (req.url === '/v1/font' ? 524288 : 131072)) { respond(res, 413, { error: '消息过大' }); req.destroy(); return; } chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || typeof input.clientId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(input.clientId) || !Number.isInteger(input.tabId) || !Number.isInteger(input.frameId)) return respond(res, 400, { error: '消息格式错误' });
      if (activeClientId && input.clientId !== activeClientId) return respond(res, 409, { error: '请使用课桥打开的专用课程浏览器' });
      if (req.url === '/v1/font') return respond(res, 200, decodeFont(input.font));
      if (req.url === '/v1/type') {
        const owner = `${input.clientId}:${input.tabId}:${input.frameId}`;
        const allowed = () => {
          const frame = frames.get(owner);
          return settings.enabled && settings.autoAnswer && (!activeClientId || input.clientId === activeClientId) && !!frame && frame.visible && !frame.confirmed && frame.paperMode !== 'preview' && frame.questions > 0 && now() - frame.seen < 12000;
        };
        if (typeof textInput !== 'function') return respond(res, 200, { status: 'blocked', detail: '请更新桌面端，并使用课桥专用浏览器进行文本输入' });
        return respond(res, 200, textInput({ ...input.typing, url: String(input.url || '') }, { owner, allowed }));
      }
      if (input.action) control(input.action);
      const key = `${input.clientId}:${input.tabId}:${input.frameId}`;
      const raw = input.state || {};
      const entry = { key, tabKey: `${input.clientId}:${input.tabId}`, title: String(raw.title || '课程页面').slice(0, 200), chapter: String(raw.chapter || '').slice(0, 200), status: String(raw.status || '已连接').slice(0, 160), media: Number(raw.media) || 0, questions: Number(raw.questions) || 0, questionsReady: raw.questionsReady === true, complete: raw.complete === true, seen: now(), frameId: input.frameId };
      entry.extensionVersion = String(raw.extensionVersion || '').slice(0, 20);
      entry.textInputPending = raw.textInputPending === true;
      entry.textInputReason = String(raw.textInputReason || '').slice(0, 180);
      entry.visible = raw.visible !== false;
      entry.assessment = raw.assessment === true;
      entry.confirmed = raw.confirmed === true;
      entry.taskComplete = raw.taskComplete === true;
      entry.resourceProtocol = raw.resourceProtocol === 2 ? 2 : 0;
      entry.resourceReady = raw.resourceReady === true;
      entry.resourceCount = Math.min(200, Math.max(0, Number(raw.resourceCount) || 0));
      entry.resourceReason = String(raw.resourceReason || '').slice(0, 160);
      entry.videoQuiz = raw.videoQuiz === true;
      entry.checkpointRejected = raw.checkpointRejected === true;
      entry.resourceQuiz = raw.resourceQuiz === true;
      entry.taskFinished = input.frameId === 0 && raw.taskFinished === true;
      entry.stepKind = ['media', 'assessment'].includes(raw.stepKind) ? raw.stepKind : 'unknown';
      entry.paperMode = ['exam', 'preview'].includes(raw.paperMode) ? raw.paperMode : '';
      if (entry.paperMode) entry.questions = Math.min(200, Math.max(0, Number(raw.paperQuestions) || entry.questions));
      entry.stepKey = String(raw.stepKey || '').slice(0, 300);
      entry.filled = Math.min(60, Math.max(0, Number(raw.filled) || 0));
      entry.submitState = ['not-found', 'clicked', 'waiting'].includes(raw.submitState) ? raw.submitState : '';
      entry.iframeCount = Math.min(100, Math.max(0, Number(raw.iframeCount) || 0));
      entry.iframeOrigins = Array.isArray(raw.iframeOrigins) ? raw.iframeOrigins.slice(0, 12).map(origin => { try { const url = new URL(String(origin)); return url.origin === 'null' ? url.protocol : url.origin; } catch { return 'unknown'; } }) : [];
      entry.frameHost = String(raw.frameHost || '').slice(0, 200).replace(/[^a-zA-Z0-9.:-]/g, '');
      entry.framePath = String(raw.framePath || '').split(/[?#]/)[0].slice(0, 300);
      if (input.tabId >= 0) {
        const previous=frames.get(key);
        if(entry.frameId===0 && previous?.stepKey && entry.stepKey && previous.stepKey!==entry.stepKey) {
          for(const [id,frame] of frames)if(frame.tabKey===entry.tabKey&&frame.frameId!==0)frames.delete(id);
          assessmentWaits.delete(entry.tabKey);
        }
        frames.set(key, entry);
      }
      for (const [id, frame] of frames) if (now() - frame.seen > 30000) frames.delete(id);
      if (raw.event) log(`${entry.title}：${String(raw.event).slice(0, 200)}`);
      const tabFrames = [...frames.values()].filter(f => f.tabKey === entry.tabKey && f.visible !== false && now() - f.seen < 6000);
      const mediaFrames = tabFrames.filter(f => f.media > 0);
      const main = tabFrames.find(f => f.frameId === 0);
      const checkpointFrames = tabFrames.filter(f => f.videoQuiz);
      const videoQuizBlocked = checkpointFrames.length > 0 || main?.resourceQuiz === true;
      const assessmentFrames = tabFrames.filter(f => !f.videoQuiz && (f.assessment || f.questions > 0));
      const inAssessment = main?.stepKind === 'assessment' || (main?.stepKind !== 'media' && mediaFrames.length === 0 && assessmentFrames.length > 0);
      const inPaper = !!(main?.paperMode || entry.paperMode);
      const confirmed = assessmentFrames.some(f => f.confirmed || f.taskComplete) || (main?.stepKind === 'assessment' && main.taskComplete);
      const mediaTaskComplete = !inAssessment && !videoQuizBlocked && (main?.resourceProtocol === 2 ? main.resourceReady && mediaFrames.length > 0 : mediaFrames.length <= 1 && tabFrames.some(f => f.taskComplete && !f.assessment));
      const mediaComplete = (mediaFrames.length > 0 && mediaFrames.every(f => f.complete)) || mediaTaskComplete;
      const questions = (Array.isArray(input.questions) ? input.questions.slice(0, 60) : []).filter(q => q && typeof q === 'object').map(q => ({
        id: String(q.id || '').slice(0, 100), title: String(q.title || '').slice(0, 4000),
        options: Array.isArray(q.options) ? q.options.slice(0, 30).map(o => String(o).slice(0, 4000)) : [],
        multiple: q.multiple === true, encoded: q.encoded === true,
        ...(isTextQuestion(q) ? { type: q.type, blankCount: Math.max(1, Math.min(30, Number(q.blankCount) || 1)), minLength: Math.max(0, Math.min(5000, Number(q.minLength) || 0)), editorReady: q.editorReady !== false, major: needsMajor(q) ? settings.major : '' } : {})
      }));
      if (settings.collectQuestions && input.tabId >= 0 && entry.visible) {
        if (library.capture(questions.filter(q=>q.encoded !== true), (entry.chapter || entry.title).replace(/\s+/g, ' ').trim())) log('新题目已收集到“我的题库 · 待补充”');
      }
      let remoteSaved = 0;
      const answers = questions.map(q => {
        if (q.encoded === true) return { id: String(q.id || '').slice(0,100), status:'encoded',indices:[] };
        const question = q;
        if (isTextQuestion(question) && question.editorReady === false) return { id: q.id, status: 'missing', indices: [], detail: '文本编辑器尚未就绪或暂不支持，未发起在线查题' };
        const local = library.hasConflict(question) ? { status: 'conflict', indices: [] } : matchAnswers(question, bank);
        let result = local.status === 'missing' && settings.useOfflineBank && !isTextQuestion(question) ? offline.match(question) : local;
        const canRequest = settings.enabled && settings.autoAnswer && entry.visible && (entry.videoQuiz || (inAssessment && !confirmed)) && input.tabId >= 0;
        if (local.status === 'missing' && ['missing', 'ambiguous'].includes(result.status)) result = resolveOnline(question, { mode: settings.lookupMode, providers, canRequest }) || result;
        if (canRequest && settings.saveOnlineAnswers && result.status === 'matched' && ['enncy', 'deepseek'].includes(result.source)) {
          try {
            const stored = library.storeRemote(question, result);
            if (stored.saved) remoteSaved++;
            if (stored.conflict) result = { status: 'conflict', indices: [], detail: stored.reason };
            else if (stored.reason) log(stored.reason, 'warning');
          } catch { log('在线答案暂未写入本地，请检查存储空间或稍后手动保存', 'warning'); }
        }
        const { texts, ...publicResult } = result;
        return { id: String(q.id || '').slice(0, 100), ...publicResult };
      });
      if (remoteSaved) { bank = library.matcherBank(); log(`已将 ${remoteSaved} 道在线参考答案存入本地，来源已标注，未经人工核验`); }
      const recognized = questions.length;
      const unsupported = Math.max(0, Math.min(60, Number(raw.questionTotal) || 0) - recognized);
      entry.matchSummary = { total: recognized + unsupported, matched: 0, missing: 0, conflict: 0, ambiguous: 0, encoded: 0, pending: 0, unsupported, filled: Math.min(recognized, entry.filled) };
      entry.remoteIssue = answers.find(answer => answer.detail && answer.status !== 'pending')?.detail || '';
      entry.pendingSource = answers.find(answer => answer.status === 'pending' && answer.pendingSource === 'deepseek') ? 'deepseek' : 'enncy';
      for (const answer of answers) if (answer.status in entry.matchSummary) entry.matchSummary[answer.status]++;
      const counts = (videoQuizBlocked ? checkpointFrames : assessmentFrames).map(f=>f.matchSummary).filter(Boolean);
      const canConfirmSubmit = settings.enabled && settings.autoAnswer && settings.autoSubmit && (videoQuizBlocked || (inAssessment && !confirmed)) && counts.some(c=>c.total>0) && counts.every(c=>c.total===c.matched && c.filled===c.total && !c.unsupported && !c.encoded && !c.missing && !c.conflict && !c.ambiguous);
      let assessment = { ready: false, reason: '' };
      if (inAssessment && !confirmed && !inPaper) {
        const signature = JSON.stringify([main?.stepKey || entry.tabKey, settings.autoAnswer, settings.autoSubmit, settings.useOfflineBank, assessmentFrames.map(f => [f.key, f.matchSummary?.total, f.matchSummary?.matched, f.matchSummary?.missing, f.matchSummary?.conflict, f.matchSummary?.ambiguous, f.matchSummary?.encoded, f.matchSummary?.unsupported, f.matchSummary?.pending]).sort()]);
        let wait = assessmentWaits.get(entry.tabKey);
        if (!wait || wait.signature !== signature) { wait = { signature, since: now(), logged: false }; assessmentWaits.set(entry.tabKey, wait); }
        assessment = assessmentProgress(assessmentFrames, settings, settings.enabled ? now() - wait.since : 0);
        if (assessment.skipped && !wait.logged && settings.enabled) { log(`${(main?.chapter || main?.title || entry.title).replace(/\s+/g, ' ').slice(0, 160)}：${assessment.reason}，该测验仍未完成`, 'warning'); wait.logged = true; }
      } else assessmentWaits.delete(entry.tabKey);
      for (const key of assessmentWaits.keys()) if (![...frames.values()].some(f => f.tabKey === key)) assessmentWaits.delete(key);
      const ready = !inPaper && !videoQuizBlocked && (inAssessment ? (confirmed || assessment.ready) : main?.resourceProtocol === 2 ? main.resourceReady : mediaComplete && (main?.stepKind === 'media' || (!settings.autoAnswer && settings.skipUnanswered) || tabFrames.every(f => !f.questions || f.confirmed)));
      const advance = ready && settings.enabled && settings.autoNext;
      const checkpointReason = checkpointFrames.some(f => f.checkpointRejected) ? '参考答案未通过视频校验，请手动作答或核对题库；视频保持暂停' : videoQuizBlocked ? assessmentProgress(checkpointFrames, { ...settings, skipUnanswered: false }, 0).reason : '';
      const waitReason = inPaper ? (confirmed ? '试卷已提交，等待查看结果' : main?.status || entry.status || '试卷已连接，等待题目同步') : videoQuizBlocked ? `视频弹题：${checkpointReason || '等待题目加载并通过后续播'}` : inAssessment ? (confirmed ? '测验已提交，准备下一课时' : assessment.reason) : mediaTaskComplete ? '本课时媒体资源已完成，准备进入下一内容页' : main?.resourceReason || '';
      // Mirror the aggregated reason onto the top frame so the desktop and course badge agree.
      if (main && waitReason) main.status = waitReason;
      if (input.tabId >= 0) saveDiagnostic();
      const activeMedia = mediaFrames.filter(f => !f.complete).sort((a,b) => a.frameId-b.frameId)[0];
      return respond(res, 200, { settings, command, advance, waitReason, answers, canConfirmSubmit, mediaTaskComplete, videoQuizBlocked, playMedia: !activeMedia || activeMedia.key === entry.key });
    } catch { if (!res.headersSent) respond(res, 400, { error: '消息无法解析' }); }
  });
  return {
    server, snapshot, update, control,
    async configureEnncy(input) { await enncy.configure(input); assessmentWaits.clear(); log(enncy.snapshot().enabled ? '已开启言溪第三方题库；本地缺答案时联网查询' : '言溪第三方题库已关闭'); return snapshot(); },
    async refreshEnncy() { await enncy.refresh({ force: true }); return snapshot(); },
    retryEnncy() { enncy.retry(); assessmentWaits.clear(); log('已清除言溪未命中和失败记录，下次同步将重新查题'); return snapshot(); },
    async configureDeepSeek(input) { await deepseek.configure(input); assessmentWaits.clear(); log(deepseek.snapshot().enabled ? '已开启 DeepSeek；按查题策略处理本地缺题' : 'DeepSeek 已关闭'); return snapshot(); },
    async refreshDeepSeek() { await deepseek.refresh({ force: true }); return snapshot(); },
    retryDeepSeek() { deepseek.retry(); assessmentWaits.clear(); log('已允许重试 DeepSeek 未命中的题目，可能产生 API 费用'); return snapshot(); },
    useClient(id) { activeClientId = id || null; },
    importBank(input) { library.import(input); bank = library.matcherBank(); persist(); log('题库已合并导入；冲突答案留待核对'); return snapshot(); },
    listBank(query) { return library.list(query); },
    saveQuestion(input) { library.save(input); bank = library.matcherBank(); persist(); log('本地题目已保存'); return snapshot(); },
    exportBank() { return library.export(); },
    offlineReference(question) { return offline.match(question); },
    searchOffline(query) { return { ...library.stats(), ...offline.search(query) }; },
    listen() { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); log('本机连接服务已就绪'); enncy.start(); deepseek.start(); resolve(snapshot()); }); }); },
    close() { enncy.close(); deepseek.close(); return new Promise(resolve => { server.close(() => { offline.close(); resolve(); }); server.closeAllConnections(); }); }
  };
}
module.exports = { createBridge, PORT };
