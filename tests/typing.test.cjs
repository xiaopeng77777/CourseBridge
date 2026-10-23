const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { createBridge } = require('../desktop/bridge.cjs');
const { createTextTyper } = require('../desktop/typing.cjs');
const { assessmentProgress } = require('../desktop/progression.cjs');
const work = path.resolve(__dirname, '../work/typing-unit'); fs.mkdirSync(work, { recursive: true });
test('长篇正文输入期间不因测验等待超时跳走', () => {
  const result = assessmentProgress([{ textInputPending: true, textInputReason: '正在逐字输入 1000/5000 字', matchSummary: { total: 1, matched: 1, filled: 0 } }], { autoAnswer: true, skipUnanswered: true }, 120000);
  assert.equal(result.ready, false); assert.match(result.reason, /1000\/5000/);
});
test('文本输入接口沿用配对与浏览器隔离，只有当前可见且运行的作答页可输入', async t => {
  let calls = 0, latestAllowed;
  const bridge = createBridge({ dataDir: fs.mkdtempSync(path.join(work, 'data-')), port: 0, textInput: (input, { allowed }) => { calls++; latestAllowed = allowed; return { status: allowed() ? 'pending' : 'blocked' }; } });
  await bridge.listen(); t.after(() => bridge.close()); bridge.useClient('managed-client');
  const request = async (route, input, token = bridge.snapshot().token, origin) => {
    const result = await fetch(`http://127.0.0.1:${bridge.snapshot().port}/v1/${route}`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ clientId: 'managed-client', tabId: 4, frameId: 0, ...input }) });
    return { code: result.status, body: await result.json() };
  };
  const state = { visible: true, paperMode: 'exam', paperQuestions: 1, questions: 1 };
  const typing = { typing: { operation: 'start', requestId: randomUUID() }, url: 'https://mooc1.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew' };
  assert.equal((await request('type', typing, 'wrong-token')).code, 401);
  assert.equal((await request('type', typing, undefined, 'https://unrelated.example')).code, 403);
  assert.equal((await request('type', { ...typing, clientId: 'other-client' })).code, 409); assert.equal(calls, 0);
  bridge.update({ enabled: true, autoAnswer: true });
  assert.equal((await request('type', typing)).body.status, 'blocked');
  await request('sync', { state }); assert.equal((await request('type', typing)).body.status, 'pending'); assert.equal(latestAllowed(), true);
  bridge.control('pause'); assert.equal(latestAllowed(), false);
  bridge.update({ enabled: true });
  for (const change of [{ visible: false }, { paperMode: 'preview' }, { confirmed: true }]) {
    await request('sync', { state: { ...state, ...change } }); assert.equal((await request('type', typing)).body.status, 'blocked');
  }
});
test('原生输入重复请求不重复执行，关闭或缺少专用浏览器时不写入', async () => {
  let contexts = 0;
  const typer = createTextTyper({ getContext: () => { contexts++; return undefined; } });
  const input = { operation: 'start', requestId: randomUUID(), questionMarker: randomUUID(), targetMarker: randomUUID(), text: '正文', rawTitle: '题干', url: 'https://mooc1.chaoxing.com/test' };
  const options = { owner: 'one', allowed: () => true };
  typer.request(input, options); await new Promise(resolve => setImmediate(resolve));
  assert.equal(typer.request(input, options).status, 'blocked'); assert.equal(contexts, 1);
  assert.match(typer.request({ ...input, operation: 'status' }, options).detail, /专用课程浏览器/);
  assert.match(typer.request({ ...input, operation: 'status' }, { ...options, owner: 'other' }).detail, /失效/);
  typer.close(); assert.equal(typer.request({ ...input, requestId: randomUUID() }, options).status, 'busy');
});
