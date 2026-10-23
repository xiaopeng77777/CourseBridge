const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { matchAnswers } = require('../extension/rules.js');
const { createLibrary, readImport } = require('../desktop/library.cjs');
const { parseCompletion, createDeepSeek } = require('../desktop/deepseek.cjs');
const { matchRemote } = require('../desktop/enncy.cjs');
const { createBridge } = require('../desktop/bridge.cjs');
const root = path.join(__dirname, '..', 'work', 'text-tests'); fs.mkdirSync(root, { recursive: true });
const blank = { title: '【填空题】测试两个空', type: 'blank', blankCount: 2, options: [] };
const essay = { title: '【论述题】结合我的专业设计未来人居环境（1000字以上）', type: 'essay', blankCount: 1, minLength: 1000, options: [], major: '人工智能技术应用' };
const completion = (answers, finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { content: JSON.stringify({ answers, uncertain: false }) } }] });
const body = value => ({ ok: true, text: async () => JSON.stringify(value) });
function folder() { return fs.mkdtempSync(path.join(root, 'case-')); }
test('文本题保留空的顺序和正文段落，专业不同不复用个性化答案', () => {
  assert.deepEqual(matchAnswers(blank, [{ question: blank.title, type: 'blank', answers: ['乙', '甲'] }]).textAnswers, ['乙', '甲']);
  assert.equal(matchAnswers(blank, [{ question: blank.title, type: 'blank', answers: ['甲'] }]).status, 'ambiguous');
  assert.equal(matchAnswers({ ...blank, blankCount:1 }, [{ question:blank.title,type:'blank',answers:['1.2'] }, { question:blank.title,type:'blank',answers:['2'] }]).status,'conflict','数值正文不能按选项序号清洗');
  const answer = '人工智能的人居环境构想。'.repeat(120) + '\n结语。';
  const bank = [{ question: essay.title, type: 'essay', answers: [answer], major: essay.major }];
  assert.equal(matchAnswers(essay, bank).textAnswers[0], answer);
  assert.equal(matchAnswers({ ...essay, major: '土木工程' }, bank).status, 'missing');
  assert.equal(parseCompletion(essay, completion(['太短'])).status, 'missing');
  assert.equal(parseCompletion(essay, completion([answer], 'length')).status, 'missing');
  assert.equal(parseCompletion(essay, completion([answer])).textAnswers[0], answer);
  assert.equal(matchRemote(blank, { question: blank.title, answer: '乙###甲' }).status, 'matched');
  assert.equal(matchRemote(essay, { question: essay.title, answer }).status, 'missing');
});
test('非选择题自动收集、在线存回、备份导入、重复空值及专业区分', () => {
  const library = createLibrary({ dataDir: folder() });
  library.capture([blank, essay], '测试');
  assert.equal(library.list().total, 2);
  library.storeRemote(blank, { status: 'matched', source: 'deepseek', ai: true, textAnswers: ['相同', '相同'] });
  const answer = '智能传感与环境控制的构想。'.repeat(120);
  library.storeRemote(essay, { status: 'matched', source: 'deepseek', ai: true, textAnswers: [answer] });
  assert.equal(matchAnswers(essay, library.matcherBank()).textAnswers[0], answer);
  library.storeRemote({ ...essay, major: '土木工程' }, { status: 'matched', source: 'deepseek', textAnswers: ['土木工程方案。'.repeat(200)] });
  assert.equal(library.list().total, 3);
  const second = createLibrary({ dataDir: folder() }); second.import(readImport(JSON.stringify(library.export()), '.json'));
  assert.deepEqual(matchAnswers(blank, second.matcherBank()).textAnswers, ['相同', '相同']);
  assert.equal(matchAnswers(essay, second.matcherBank()).textAnswers[0], answer);
  library.import([{ question: blank.title, type: 'blank', blankCount: 2, answers: ['甲', '乙'] }]);
  library.import([{ question: blank.title, type: 'blank', blankCount: 2, answers: ['乙', '甲'] }]);
  assert.equal(library.hasConflict(blank), true);
});
test('DeepSeek 文本按专业分别缓存，提示词包含字数要求，缺专业不收费查询', async t => {
  const requests = [], service = createDeepSeek({ dataDir: folder(), requestGap: 0, fetchImpl: async (url, init) => {
    if (!init.body) return body({ is_available: true, balance_infos: [] });
    const payload = JSON.parse(init.body); requests.push(payload);
    return body(completion(['方案与应用。'.repeat(250)]));
  }}); t.after(() => service.close());
  await service.configure({ apiKey: 'test-private-key', enabled: true });
  assert.match(service.resolve({ ...essay, major: '' }, true).detail, /专业/);
  assert.equal(requests.length, 0);
  for (const major of [essay.major, '土木工程']) {
    service.resolve({ ...essay, major }, true);
    for (let i=0; i<100 && service.snapshot().pending; i++) await new Promise(r => setTimeout(r, 5));
    assert.equal(service.resolve({ ...essay, major }, true).status, 'matched');
  }
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[0].messages[1].content).major, essay.major);
  assert.equal(JSON.parse(requests[0].messages[1].content).minLength, 1000);
  assert.ok(requests[0].max_tokens >= 4096);
});
test('同步链路接收文本题并隔离未就绪编辑器与本地专业设置', async t => {
  let queries = 0;
  const bridge = createBridge({ dataDir: folder(), port: 0, deepseekOptions: { requestGap: 0, fetchImpl: async (url, init) => {
    if (!init.body) return body({ is_available: true, balance_infos: [] });
    queries++; assert.equal(JSON.parse(JSON.parse(init.body).messages[1].content).major, essay.major);
    return body(completion(['方案与应用。'.repeat(250)]));
  }}}); t.after(() => bridge.close()); await bridge.listen();
  await bridge.configureDeepSeek({ apiKey: 'test-private-key', enabled: true });
  bridge.update({ enabled: true, autoAnswer: true, lookupMode: 'deepseek', major: essay.major });
  const send = async ready => (await fetch(`http://127.0.0.1:${bridge.snapshot().port}/v1/sync`, { method: 'POST', headers: { Authorization: 'Bearer ' + bridge.snapshot().token }, body: JSON.stringify({ clientId: 'text-test', tabId: 1, frameId: 0, state: { visible: true, assessment: true, questions: 1, questionTotal: 1 }, questions: [{ ...essay, id: '0', editorReady: ready, major: '不可信客户端专业' }] }) })).json();
  assert.match((await send(false)).answers[0].detail, /编辑器/); assert.equal(queries, 0);
  await send(true); let result;
  for (let i=0; i<100; i++) { await new Promise(r => setTimeout(r, 5)); result = await send(true); if (result.answers[0].status === 'matched') break; }
  assert.equal(result.answers[0].status, 'matched'); assert.equal(queries, 1);
  assert.equal(bridge.exportBank().questions.find(q => q.answers.length).major, essay.major);
  assert.ok(!JSON.stringify(bridge.exportBank()).includes('test-private-key'));
});
test('正文太短最多补写一次，校验通过才采用，并累计两次实际用量', async t => {
  let queries=0;const messages=[];
  const service=createDeepSeek({dataDir:folder(),requestGap:0,fetchImpl:async(url,init)=>{
    if(!init.body)return body({is_available:true,balance_infos:[]});
    queries++;messages.push(JSON.parse(init.body));
    return body({...completion([queries===1?'不足字数。':'基于专业的设计构想。'.repeat(150)]),usage:{total_tokens:100}});
  }});t.after(()=>service.close());await service.configure({apiKey:'fake-only',enabled:true});service.resolve(essay,true);
  for(let i=0;i<100&&service.snapshot().pending;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(service.resolve(essay,true).status,'matched');assert.equal(queries,2);assert.equal(service.snapshot().sessionRequests,2);assert.equal(service.snapshot().sessionTokens,200);
  assert.match(messages[1].messages.at(-1).content,/至少 1000 字/);
  for(let i=0;i<10;i++)service.resolve(essay,true);assert.equal(queries,2);
});
test('补写仍不足时明确报告字数，后续心跳不再重复收费请求', async t => {
  let queries=0;const service=createDeepSeek({dataDir:folder(),requestGap:0,fetchImpl:async(url,init)=>{
    if(!init.body)return body({is_available:true,balance_infos:[]});queries++;return body(completion(['只有这几个字。']));
  }});t.after(()=>service.close());await service.configure({apiKey:'fake-only',enabled:true});service.resolve(essay,true);
  for(let i=0;i<100&&service.snapshot().pending;i++)await new Promise(r=>setTimeout(r,5));
  const result=service.resolve(essay,true);assert.equal(result.status,'missing');assert.equal(result.issue,'too-short');assert.match(result.detail,/至少 1000 字.*已补写一次/);
  for(let i=0;i<20;i++)service.resolve(essay,true);assert.equal(queries,2);
  assert.equal(parseCompletion(essay,{choices:[{finish_reason:'stop',message:{content:JSON.stringify({answer:'设计构想。'.repeat(250),uncertain:false})}}]}).status,'matched');
});
test('正文不完整的格式和空数分别报告原因，不误报缺少题库',()=>{
  assert.match(parseCompletion(blank,completion(['仅一个'])).detail,/要求 2 个/);
  assert.equal(parseCompletion(essay,completion([''])).issue,'text-format');
  assert.equal(parseCompletion(essay,completion(['尚未输出完'],'length')).issue,'truncated');
});
