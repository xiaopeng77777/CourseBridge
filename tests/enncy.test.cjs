const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const { createEnncy, matchRemote } = require('../desktop/enncy.cjs');
const root = path.join(__dirname, '..', 'work', 'enncy-tests');
fs.mkdirSync(root, { recursive: true });
const secret = 'test-credential-never-export';
const question = { title: '【单选题】测试题', options: ['甲', '乙'], multiple: false };
const response = body => ({ ok: true, text: async () => JSON.stringify(body) });
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function settled(service) { for (let i = 0; i < 100; i++) { if (!service.snapshot().pending) return; await pause(); } throw new Error('queue did not settle'); }
function setup(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(root, 'case-'));
  const requests = [];
  const { fetchImpl: customFetch, ...rest } = options;
  const service = createEnncy({ dataDir, requestGap: 0, ...rest, fetchImpl: async (url, init) => { requests.push(new URL(url)); return customFetch ? customFetch(url, init) : response({ code: 1, data: new URL(url).pathname === '/info' ? { times: 10, user_times: 4, success_times: 3 } : { question: question.title, answer: '乙', times: 9 } }); } });
  t.after(() => { service.close(); assert.ok(path.resolve(dataDir).startsWith(path.resolve(root) + path.sep)); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return { service, dataDir, requests };
}
test('逐字匹配题干和答案文字，兼容多选和判断，不猜选项字母', () => {
  assert.deepEqual(matchRemote(question, { question: question.title, answer: '乙' }).indices, [1]);
  assert.equal(matchRemote(question, { question: '别的题', answer: '乙' }).status, 'missing');
  assert.equal(matchRemote(question, { question: question.title, answer: 'B' }).status, 'ambiguous');
  assert.deepEqual(matchRemote({ ...question, multiple: true }, { question: question.title, answer: '甲###乙', ai: true }), { status: 'matched', indices: [0, 1], source: 'enncy', ai: true });
  assert.deepEqual(matchRemote({ title: '【判断题】验证', options: ['对', '错'], multiple: false }, { question: '【判断题】验证', answer: '错误' }).indices, [1]);
});
test('默认无请求；只查询缺题，心跳复用结果，剩余额度随查题更新', async t => {
  const { service, dataDir, requests } = setup(t);
  assert.equal(service.snapshot().enabled, false);
  assert.equal(service.resolve(question, true), null);
  assert.equal(requests.length, 0);
  await service.configure({ token: secret, enabled: true });
  assert.equal(service.snapshot().remaining, 10);
  assert.equal(service.snapshot().used, 4);
  assert.equal(service.resolve(question, false), null);
  assert.equal(service.resolve(question, true).status, 'pending');
  assert.equal(service.resolve(question, true).status, 'pending');
  await settled(service);
  assert.equal(service.snapshot().remaining, 9);
  assert.deepEqual(service.resolve(question, true).indices, [1]);
  assert.equal(requests.filter(x => x.pathname === '/query').length, 1);
  assert.equal(requests[1].searchParams.get('options'), '甲\n乙');
  assert.equal(requests[1].searchParams.get('type'), 'single');
  assert.equal(JSON.stringify(service.snapshot()).includes(secret), false);
  assert.equal(fs.readFileSync(path.join(dataDir, 'enncy-config.json'), 'utf8').includes(secret), false);
  assert.equal(service.snapshot().persisted, false);
});
test('系统加密保存，重启读取；清除凭证后旧结果和额度失效', async t => {
  const key = randomBytes(32);
  const secureStorage = { isEncryptionAvailable: () => true,
    encryptString(value) { const iv = randomBytes(16), cipher = createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([iv, cipher.update(value), cipher.final()]); },
    decryptString(value) { const cipher = createDecipheriv('aes-256-cbc', key, value.subarray(0, 16)); return Buffer.concat([cipher.update(value.subarray(16)), cipher.final()]).toString(); }
  };
  const { service, dataDir } = setup(t, { secureStorage });
  await service.configure({ token: secret, enabled: true });
  assert.equal(service.snapshot().persisted, true);
  assert.equal(fs.readFileSync(path.join(dataDir, 'enncy-config.json'), 'utf8').includes(secret), false);
  const next = createEnncy({ dataDir, secureStorage });
  t.after(() => next.close());
  assert.equal(next.snapshot().configured, true);
  assert.equal(next.snapshot().enabled, true);
  await next.configure({ clear: true, enabled: false });
  assert.equal(next.snapshot().configured, false);
  assert.equal(next.snapshot().remaining, null);
  assert.equal(next.resolve(question, true), null);
});
test('额度为0、无效凭证不请求查题；失败记录缓存，只有显式重试才再次查询', async t => {
  const zero = setup(t, { fetchImpl: async () => response({ code: 1, data: { times: 0 } }) });
  await zero.service.configure({ token: secret, enabled: true });
  assert.match(zero.service.resolve(question, true).detail, /剩余次数为 0/);
  assert.equal(zero.requests.filter(x => x.pathname === '/query').length, 0);
  const invalid = setup(t, { fetchImpl: async () => response({ code: 0, message: 'token 无效' }) });
  await invalid.service.configure({ token: secret, enabled: true });
  assert.match(invalid.service.resolve(question, true).detail, /凭证无效/);
  assert.equal(invalid.requests.filter(x => x.pathname === '/query').length, 0);
  let queries = 0;
  const failed = setup(t, { fetchImpl: async url => {
    if (new URL(url).pathname === '/info') return response({ code: 1, data: { times: 10 } });
    queries++; throw new Error('network includes token=' + secret);
  } });
  await failed.service.configure({ token: secret, enabled: true });
  failed.service.resolve(question, true); await settled(failed.service);
  for (let i = 0; i < 3; i++) failed.service.resolve(question, true);
  assert.equal(queries, 1);
  assert.equal(JSON.stringify(failed.service.snapshot()).includes(secret), false);
  failed.service.retry(); failed.service.resolve(question, true); await settled(failed.service);
  assert.equal(queries, 2);
});
test('超时结束等待；暂停或关闭中断请求，不复用被取消的响应', async t => {
  const { service } = setup(t, { requestTimeout: 30, fetchImpl: async (url, init) => {
    if (new URL(url).pathname === '/info') return response({ code: 1, data: { times: 10 } });
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  await service.configure({ token: secret, enabled: true });
  service.resolve(question, true); await settled(service);
  assert.match(service.resolve(question, true).detail, /超时/);
  service.retry(); service.resolve(question, true); service.cancelPending(); await pause();
  assert.equal(service.snapshot().pending, 0);
  assert.equal(service.resolve(question, false), null);
});
test('旧账户刷新结果不会覆盖查题后更新的剩余额度', async t => {
  let release, infoCalls = 0, clock = 10000;
  const { service } = setup(t, { now: () => clock, fetchImpl: async url => {
    if (new URL(url).pathname === '/info') { infoCalls++; if (infoCalls > 1) return new Promise(resolve => { release = () => resolve(response({ code: 1, data: { times: 10 } })); }); return response({ code: 1, data: { times: 10 } }); }
    return response({ code: 1, data: { question: question.title, answer: '乙', times: 9 } });
  } });
  await service.configure({ token: secret, enabled: true });
  clock += 6000;
  const refreshing = service.refresh({ force: true });
  service.resolve(question, true); await settled(service);
  release(); await refreshing;
  assert.equal(service.snapshot().remaining, 9);
});
