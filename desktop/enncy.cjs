const fs = require('node:fs');
const path = require('node:path');
const { questionKey, normalize, answerKey, isTextQuestion, needsMajor, textAnswersValid } = require('../extension/rules.js');

const ORIGIN = 'https://tk.enncy.cn';
const INFO_INTERVAL = 60000;
const number = value => ['number', 'string'].includes(typeof value) && value !== '' && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
function questionType(q) {
  if (/[【\[(]\s*判断题\s*[】\])]/.test(q.title)) return 'judgement';
  return q.multiple ? 'multiple' : 'single';
}
// Use complete answer text, never assume stored letters refer to the current option order.
function matchRemote(question, data) {
  if (!data || questionKey(data.question) !== questionKey(question.title)) return { status: 'missing', indices: [], detail: '言溪返回的题干与当前题目不一致' };
  const raw = typeof data.answer === 'string' ? data.answer.trim() : '';
  if (!raw || raw.length > 32000) return { status: 'missing', indices: [], detail: '言溪未返回可用答案' };
  if (isTextQuestion(question)) {
    if (needsMajor(question)) return { status: 'missing', indices: [], detail: '此题需要结合个人专业，通用题库答案不直接采用' };
    const values = question.type === 'blank' && question.blankCount > 1 ? raw.split(/\s*#{1,3}\s*|\r?\n|\|/).map(a => a.trim()).filter(Boolean) : [raw];
    if (!textAnswersValid(question, values) || /<\/?(?:script|iframe|html|body)\b/i.test(raw)) return { status: 'ambiguous', indices: [], detail: '言溪文本答案不符合空数或字数要求' };
    return { status: 'matched', indices: [], textAnswers: values, source: 'enncy', ai: data.ai === true };
  }
  const key = value => answerKey(question, value);
  const find = text => question.options.map((option, i) => key(option) === key(text) ? i : -1).filter(i => i >= 0);
  const whole = find(raw);
  let indices;
  if (whole.length === 1) indices = whole;
  else if (question.multiple) {
    for (const separator of [/\s*#{1,3}\s*/, /\r?\n/, /\s*[;；]\s*/, /\s*[|、]\s*/]) {
      const parts = raw.split(separator).map(x => x.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const matches = parts.map(find);
      if (matches.every(x => x.length === 1) && new Set(matches.flat()).size === parts.length) { indices = matches.flat(); break; }
    }
  }
  if (!indices) return { status: 'ambiguous', indices: [], detail: '言溪答案无法与当前选项文字准确对应' };
  return { status: 'matched', indices, source: 'enncy', ai: data.ai === true };
}

function createEnncy({ dataDir, secureStorage, fetchImpl = (...args) => globalThis.fetch(...args), now = Date.now, requestTimeout = 12000, requestGap = 1200 } = {}) {
  const file = path.join(dataDir, 'enncy-config.json');
  const canEncrypt = () => !!secureStorage?.isEncryptionAvailable();
  let token = '', enabled = false, active = true, persisted = false, generation = 0, disposed = false;
  let queryController, infoController, infoPromise, queryBusy = false, wakeTimer;
  let lastInfoAttempt = 0, lastQueryAt = 0, infoSerial = 0, quotaRevision = 0;
  const cache = new Map(), queue = [];
  const state = { remaining: null, used: null, succeeded: null, updatedAt: null, accountUpdatedAt: null, refreshing: false, error: '', lastResult: '' };
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.encryptedToken && canEncrypt()) {
      token = secureStorage.decryptString(Buffer.from(saved.encryptedToken, 'base64'));
      enabled = saved.enabled === true;
      persisted = true;
    } else if (saved.encryptedToken) state.error = '当前系统无法解密凭证，请重新填写';
  } catch (error) { if (error.code !== 'ENOENT') state.error = '凭证读取失败，请重新填写'; }
  const snapshot = () => ({ enabled, active, configured: !!token, persisted, ...state, pending: [...cache.values()].filter(x => x.status === 'pending').length });
  function persist() {
    const encryptedToken = token && canEncrypt() ? secureStorage.encryptString(token).toString('base64') : '';
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ enabled: !!encryptedToken && enabled, encryptedToken }, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
    persisted = !!encryptedToken;
  }
  function cancelPending() {
    generation++;
    clearTimeout(wakeTimer);
    queryController?.abort();
    queue.length = 0;
    for (const [key, value] of cache) if (value.status === 'pending') cache.delete(key);
  }
  async function request(endpoint, params, controller) {
    const url = new URL(endpoint, ORIGIN);
    url.search = new URLSearchParams({ token, ...params }).toString();
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    try {
      const response = await fetchImpl(url.href, { signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('http');
      const text = await response.text();
      if (text.length > 262144) throw new Error('size');
      return JSON.parse(text);
    } finally { clearTimeout(timer); }
  }
  function failure(body) {
    const message = String(body?.message || '') + String(body?.data?.answer || '');
    if (/(次数|额度|余额|配额).{0,12}(不足|用完|耗尽|为.?0)|无可用次数/.test(message)) return '言溪可用次数不足，请到官网查看额度';
    if (/token|凭证|过期|未登录|无效|授权|登录/i.test(message)) return '言溪凭证无效或已过期，请重新填写';
    if (/未找到|搜.*不到|未收录|没有找到/.test(message)) return '言溪未找到本题答案';
    return '言溪未返回可用答案，请到官网查看账户或稍后重试';
  }
  function unavailable() {
    if (state.remaining === 0) return '言溪剩余次数为 0，请到官网查看额度';
    if (/凭证无效|可用次数不足/.test(state.error)) return state.error;
    return '';
  }
  function updateQuota(data) {
    const remaining = number(data?.times);
    if (remaining !== null) { state.remaining = remaining; state.updatedAt = now(); quotaRevision++; }
  }
  async function refresh({ force = false } = {}) {
    if (disposed || !token) return snapshot();
    if (infoPromise) return infoPromise;
    if (!force && now() - lastInfoAttempt < INFO_INTERVAL) return snapshot();
    if (force && lastInfoAttempt && now() - lastInfoAttempt < 5000) return snapshot();
    lastInfoAttempt = now();
    const serial = ++infoSerial, currentToken = token, revision = quotaRevision;
    infoController = new AbortController();
    state.refreshing = true;
    infoPromise = (async () => {
      try {
        const body = await request('/info', {}, infoController);
        if (disposed || serial !== infoSerial || currentToken !== token) return snapshot();
        if (Number(body.code) !== 1 || number(body.data?.times) === null) { state.error = failure(body); return snapshot(); }
        // An older /info response must not overwrite a newer query balance.
        if (revision === quotaRevision) updateQuota(body.data);
        state.used = number(body.data.user_times);
        state.succeeded = number(body.data.success_times);
        state.accountUpdatedAt = now();
        state.error = '';
      } catch {
        if (!disposed && serial === infoSerial && currentToken === token) state.error = '言溪账户刷新失败，显示的是上次获取的额度';
      } finally {
        if (serial === infoSerial) { state.refreshing = false; infoPromise = null; }
      }
      return snapshot();
    })();
    return infoPromise;
  }
  async function configure(input = {}) {
    if (typeof input !== 'object' || !input) throw new Error('题库配置格式不正确');
    const nextToken = input.clear ? '' : typeof input.token === 'string' ? input.token.trim() : token;
    if (nextToken.length > 2000 || /[\s\x00-\x1f\x7f]/.test(nextToken)) throw new Error('凭证格式不正确，请只粘贴 Token');
    if (input.enabled === true && !nextToken) throw new Error('请先填写言溪凭证');
    cancelPending();
    if (nextToken !== token) {
      infoController?.abort(); infoSerial++; infoPromise = null;
      cache.clear(); lastInfoAttempt = 0;
      Object.assign(state, { remaining: null, used: null, succeeded: null, updatedAt: null, accountUpdatedAt: null, refreshing: false, error: '', lastResult: '' });
    }
    token = nextToken;
    enabled = !!token && (typeof input.enabled === 'boolean' ? input.enabled : enabled);
    persist();
    if (token) await refresh({ force: true });
    return snapshot();
  }
  const cacheKey = q => JSON.stringify([questionKey(q.title), q.options.map(normalize), q.multiple, q.type, q.blankCount, q.minLength]);
  function resolve(question, canRequest) {
    if (!enabled || !active || !token || disposed) return null;
    if (isTextQuestion(question) && needsMajor(question)) return { status: 'missing', indices: [], detail: '此题需要结合个人专业，通用题库答案不直接采用' };
    const key = cacheKey(question);
    const cached = cache.get(key);
    if (cached) return { ...cached, indices: [...cached.indices] };
    if (!canRequest) return null;
    if (unavailable()) return { status: 'missing', indices: [], detail: unavailable() };
    if (cache.size >= 300) { for (const [id, item] of cache) if (item.status !== 'pending') { cache.delete(id); break; } }
    if (cache.size >= 300) return { status: 'missing', indices: [], detail: '言溪查题队列已满，请稍后重试' };
    const result = { status: 'pending', indices: [], detail: '正在等待言溪查题' };
    cache.set(key, result);
    queue.push({ key, question, generation });
    pump();
    return { ...result };
  }
  async function pump() {
    if (queryBusy || disposed || !enabled || !active || !queue.length) return;
    const delay = lastQueryAt ? requestGap - (now() - lastQueryAt) : 0;
    if (delay > 0) { clearTimeout(wakeTimer); wakeTimer = setTimeout(pump, delay); wakeTimer.unref?.(); return; }
    const job = queue.shift();
    if (job.generation !== generation) { pump(); return; }
    queryBusy = true;
    queryController = new AbortController();
    const currentController = queryController;
    lastQueryAt = now();
    try {
      let result;
      if (unavailable()) result = { status: 'missing', indices: [], detail: unavailable() };
      else {
        const body = await request('/query', { title: job.question.title, options: job.question.options.join('\n'), ...(!isTextQuestion(job.question) ? { type: questionType(job.question) } : {}) }, currentController);
        if (disposed || job.generation !== generation) return;
        updateQuota(body.data);
        if (number(body.data?.times) !== null) state.error = '';
        result = Number(body.code) === 1 ? matchRemote(job.question, body.data) : { status: 'missing', indices: [], detail: failure(body) };
        if (/凭证无效|可用次数不足/.test(result.detail || '')) state.error = result.detail;
      }
      if (job.generation === generation && !disposed) {
        cache.set(job.key, result);
        state.lastResult = result.status === 'matched' ? `言溪已匹配${result.ai ? '（AI 生成参考答案）' : '参考答案'}` : result.detail;
      }
    } catch {
      if (!disposed && job.generation === generation) {
        const result = { status: 'missing', indices: [], detail: currentController.signal.aborted ? '言溪查题超时，请检查网络或稍后重试' : '言溪连接失败，请检查网络或稍后重试' };
        cache.set(job.key, result); state.lastResult = result.detail;
      }
    } finally { queryBusy = false; queryController = null; pump(); }
  }
  // Quota polling does not query questions and never puts the credential in snapshots.
  const interval = setInterval(() => { if (enabled && active) void refresh(); }, INFO_INTERVAL);
  interval.unref?.();
  return { snapshot, configure, refresh, resolve, cancelPending,
    setActive(value) { if (active && !value) cancelPending(); active = !!value; },
    retry() { cancelPending(); for (const [key, value] of cache) if (value.status !== 'matched') cache.delete(key); state.lastResult = ''; },
    start() { if (enabled && active) void refresh({ force: true }); },
    close() { disposed = true; cancelPending(); infoController?.abort(); clearInterval(interval); }
  };
}
module.exports = { createEnncy, matchRemote, questionType };
