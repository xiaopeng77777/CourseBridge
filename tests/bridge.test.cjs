const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createBridge } = require('../desktop/bridge.cjs');
const testRoot = path.join(__dirname, '..', 'work', 'tests');
fs.mkdirSync(testRoot, { recursive: true });
const token = 'a'.repeat(32);
test('考试和预览保留自身状态，不显示课程缺题继续，不触发下一课时',async t=>{
  const {bridge,sync}=await setup(t);bridge.update({enabled:true,autoAnswer:true,autoNext:true,skipUnanswered:true});
  for(const paperMode of ['exam','preview']){
    const status=paperMode==='preview'?'整卷预览已读取 85 题，已匹配 85/85':'当前页已填写 1/1；本次已验证 47/85 道';
    const result=await sync({paperMode,paperQuestions:85,questions:25,questionTotal:25,status,assessment:true});
    assert.equal(result.advance,false);assert.equal(result.waitReason,status);assert.equal(bridge.snapshot().frames[0].questions,85);
    assert.doesNotMatch(result.waitReason,/准备下一课时|保留测验/);
  }
});

test('只有整份可见测验全部匹配并填写，开启自动提交才允许跨框架确认', async t=>{
  const {bridge,sync}=await setup(t);
  bridge.importBank([{question:'跨框架提交验证',answer:'乙'}]);
  bridge.update({enabled:true,autoAnswer:true,autoSubmit:true,autoNext:true,skipUnanswered:false});
  const q={id:'q',title:'跨框架提交验证',options:['甲','乙']};
  const child=state=>sync({assessment:true,questions:1,questionTotal:1,filled:1,...state},1,{questions:[q]});
  await sync({stepKind:'assessment'});
  await child({filled:0});assert.equal((await sync({stepKind:'assessment'})).canConfirmSubmit,false);
  await child({});assert.equal((await sync({stepKind:'assessment'})).canConfirmSubmit,true);
  await child({questionTotal:2});assert.equal((await sync({stepKind:'assessment'})).canConfirmSubmit,false);
  await child({});bridge.update({autoSubmit:false});assert.equal((await sync({stepKind:'assessment'})).canConfirmSubmit,false);
  bridge.update({autoSubmit:true});assert.equal((await sync({stepKind:'media'})).canConfirmSubmit,false);
  await child({visible:false});assert.equal((await sync({stepKind:'assessment'})).canConfirmSubmit,false);
  await child({confirmed:true});assert.equal((await sync({stepKind:'assessment'})).canConfirmSubmit,false);
  bridge.update({enabled:false});assert.equal((await sync({stepKind:'assessment'})).canConfirmSubmit,false);
});

test('视频任务点完成时未播完也可切换；旧视频完成标记不能确认测验提交',async t=>{
  const {bridge,sync}=await setup(t);bridge.update({enabled:true,autoAnswer:true,autoSubmit:true,skipUnanswered:false});
  await sync({stepKind:'media'});
  let result=await sync({media:1,complete:false,taskComplete:true},1);
  assert.equal(result.mediaTaskComplete,true);assert.equal(result.advance,true);
  result=await sync({stepKind:'assessment'});
  assert.equal(result.mediaTaskComplete,false);assert.equal(result.advance,false);
  assert.equal(result.canConfirmSubmit,false);
});
test('主页面进入新的章节后，旧内容框架完成标记立即失效',async t=>{
  const {bridge,sync}=await setup(t);bridge.control('start');
  await sync({stepKind:'media',stepKey:'chapter-a::0'});
  assert.equal((await sync({media:1,complete:false,taskComplete:true},1)).advance,true);
  const next=await sync({stepKind:'media',stepKey:'chapter-b::0'});
  assert.equal(next.advance,false);assert.equal(next.mediaTaskComplete,false);
});
async function setup(t, extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(testRoot, 'bridge-'));
  const bridge = createBridge({ dataDir, port: 0, token, ...extra });
  const state = await bridge.listen();
  t.after(async () => { await bridge.close(); for (const name of ['settings.json', 'last-status.json', 'question-library.json', 'enncy-config.json', 'deepseek-config.json']) if (fs.existsSync(path.join(dataDir, name))) fs.unlinkSync(path.join(dataDir, name)); fs.rmdirSync(dataDir); });
  const request = (body, options = {}) => fetch(`http://127.0.0.1:${state.port}/v1/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token || token}`, ...options.headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const sync = async (state, frameId = 0, other = {}) => (await request({ clientId: 'test-client', tabId: 1, frameId, state, ...other })).json();
  return { bridge, sync, request, dataDir };
}

test('新资源协议只在主页面汇总全部完成后切换；单个完成标记不能跳过其他资源', async t => {
  const {bridge,sync}=await setup(t); bridge.update({enabled:true,autoAnswer:true});
  await sync({resourceProtocol:2,resourceCount:2,resourceReady:false,taskComplete:true});
  await sync({media:1,complete:true,taskComplete:true,resourceProtocol:2},1);
  let result=await sync({media:1,complete:false,resourceProtocol:2},2);
  assert.equal(result.advance,false); assert.equal(result.mediaTaskComplete,false); assert.equal(result.playMedia,true);
  result=await sync({resourceProtocol:2,resourceCount:2,resourceReady:true});
  assert.equal(result.advance,true);
  assert.equal((await sync({resourceProtocol:2,resourceReady:false,stepKey:'next-card'})).advance,false);
});

test('视频弹题阻止切换并允许单独查题确认；即使开启缺题继续也不会跳过视频弹题', async t => {
  const {bridge,sync}=await setup(t); bridge.importBank([{question:'视频检查点',answer:'乙'}]);
  bridge.update({enabled:true,autoAnswer:true,autoSubmit:true,skipUnanswered:true});
  await sync({stepKind:'media',resourceProtocol:2,resourceReady:true});
  const result=await sync({videoQuiz:true,media:1,questions:1,questionTotal:1,filled:1},1,{questions:[{id:'q',title:'视频检查点',options:['甲','乙']}]});
  assert.equal(result.answers[0].status,'matched'); assert.equal(result.canConfirmSubmit,true);
  assert.equal(result.advance,false); assert.equal(result.videoQuizBlocked,true);
  const missing=await sync({videoQuiz:true,media:1,questions:1,questionTotal:1},1,{questions:[{id:'q',title:'视频检查点没有答案',options:['甲','乙']}]});
  assert.equal(missing.advance,false); assert.match(missing.waitReason,/视频弹题.*未找到答案/); assert.doesNotMatch(missing.waitReason,/秒后/);
  const rejected=await sync({videoQuiz:true,checkpointRejected:true,media:1,questions:1,questionTotal:1,filled:1},1,{questions:[{id:'q',title:'视频检查点',options:['甲','乙']}]});
  assert.equal(rejected.advance,false); assert.match(rejected.waitReason,/未通过视频校验/);
});

test('仅主框架可报告课程目录已结束，进入下一内容后清除结束状态', async t=>{
  const {bridge,sync}=await setup(t);
  await sync({taskFinished:true,stepKey:'last::1'});
  await sync({taskFinished:true},1);
  assert.equal(bridge.snapshot().frames.find(f=>f.frameId===0).taskFinished,true);
  assert.equal(bridge.snapshot().frames.find(f=>f.frameId===1).taskFinished,false);
  await sync({stepKey:'last::0'});
  assert.equal(bridge.snapshot().frames.find(f=>f.frameId===0).taskFinished,false);
});
test('只绑定回环地址，拒绝错误配对码与网页来源', async t => {
  const { bridge, request } = await setup(t);
  assert.equal(bridge.server.address().address, '127.0.0.1');
  assert.equal((await request({}, { token: 'wrong' })).status, 401);
  assert.equal((await request({}, { headers: { Origin: 'https://example.com' } })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: bridge.snapshot().port, path: '/v1/sync', method: 'POST', headers: { Host: 'attacker.invalid', Authorization: `Bearer ${token}` } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(hostStatus, 403);
  assert.equal((await request('{bad json')).status, 400);
  assert.equal((await request({ clientId: '../bad', tabId: 1, frameId: 0 })).status, 400);
});
test('所有媒体结束且题目完成后才允许切换章节', async t => {
  const { bridge, sync } = await setup(t);
  bridge.update({ skipUnanswered: false });
  bridge.control('start');
  await sync({ media: 1, complete: false }, 1);
  assert.equal((await sync({ media: 1, complete: true }, 2)).advance, false);
  assert.equal((await sync({ media: 1, complete: true }, 1)).advance, true);
  await sync({ media: 0, questions: 1, questionsReady: false }, 3);
  assert.equal((await sync({ media: 0 }, 0)).advance, false);
  await sync({ media: 0, questions: 1, questionsReady: true, confirmed: true }, 3);
  assert.equal((await sync({ media: 0 }, 0)).advance, true);
  bridge.control('pause');
  assert.equal((await sync({ media: 0 }, 0)).advance, false);
});
test('不同标签页独立聚合，旧帧会过期', async t => {
  let clock = 1000;
  const { bridge, sync } = await setup(t, { now: () => clock });
  bridge.control('start');
  await sync({ media: 1, complete: false }, 1);
  assert.equal((await sync({ media: 1, complete: true }, 0, { tabId: 2 })).advance, true);
  clock += 13000;
  assert.equal(bridge.snapshot().frames.length, 0);
});
test('暂不答题时，测验页无需媒体和题库也能继续', async t => {
  const { bridge, sync } = await setup(t);
  bridge.control('start');
  const result = await sync({ stepKind: 'assessment', assessment: true, questions: 0 });
  assert.equal(result.advance, true);
  assert.match(result.waitReason, /留待处理/);
});
test('开启自动答题后，必须收到提交成功信号再跳转', async t => {
  const { bridge, sync } = await setup(t);
  bridge.update({ enabled: true, autoAnswer: true, skipUnanswered: true });
  assert.equal((await sync({ stepKind: 'assessment', assessment: true, questions: 4, questionsReady: true })).advance, false);
  assert.equal((await sync({ stepKind: 'assessment', assessment: true, questions: 4, confirmed: true })).advance, true);
});

test('自动答题缺答案等待后可继续，原因在主页面显示，关闭继续开关后不跳转', async t => {
  let clock = 1000;
  const { bridge, sync } = await setup(t, { now: () => clock });
  bridge.update({ enabled: true, autoAnswer: true, autoSubmit: true, skipUnanswered: true });
  const question = { id: 'q', title: '尚无答案的测验', options: ['甲','乙'] };
  const child = () => sync({ assessment: true, questions: 1, questionTotal: 1 }, 1, { questions: [question] });
  await child();
  let result = await sync({ stepKind: 'assessment', stepKey: 'chapter-22::1' });
  assert.equal(result.advance, false);
  assert.match(result.waitReason, /未找到答案.*离线库未开启/);
  // Keep both frames current while advancing the fake clock in 2-second heartbeats.
  for (let i=0;i<9;i++) { clock += 2000; await child(); result = await sync({stepKind:'assessment',stepKey:'chapter-22::1'}); }
  assert.equal(result.advance, true);
  assert.match(result.waitReason, /已保留测验/);
  assert.ok(bridge.snapshot().logs.some(log=>/该测验仍未完成/.test(log.message)));
  bridge.update({skipUnanswered:false});
  assert.equal((await sync({stepKind:'assessment',stepKey:'chapter-22::1'})).advance, false);
  await sync({stepKind:'assessment',stepKey:'chapter-23::1'});
  bridge.update({skipUnanswered:true});
  assert.equal((await sync({stepKind:'assessment',stepKey:'chapter-23::1'})).advance, false);
});

test('字体未还原时显示独立原因，不把乱码收进个人题库或用于填写', async t => {
  const {bridge,sync}=await setup(t);
  bridge.update({enabled:true,autoAnswer:true});
  const actual=await sync({assessment:true,questions:1,questionTotal:1},0,{questions:[{id:'font',title:'尚未还原的字符',options:['甲','乙'],encoded:true}]});
  assert.equal(actual.answers[0].status,'encoded');
  assert.match(actual.waitReason,/字体尚未还原/);
  assert.equal(bridge.snapshot().pendingCount,0);
});
test('隐藏的旧播放器不阻塞当前任务，平台完成标记可推动视频页切换', async t => {
  const { bridge, sync } = await setup(t);
  bridge.control('start');
  await sync({ media: 1, complete: false, visible: false }, 2);
  assert.equal((await sync({ media: 1, complete: true }, 1)).advance, true);
  assert.equal((await sync({ stepKind: 'media', taskComplete: true }, 0)).advance, true);
});
test('题库只返回选项索引，不向浏览器发送整个题库或配对码', async t => {
  const { bridge, sync } = await setup(t);
  bridge.importBank([{ question: '语言', answer: 'Python' }]);
  const result = await sync({}, 0, { questions: [{ id: 'q1', title: '语言', options: ['HTML', 'Python'] }] });
  assert.deepEqual(result.answers, [{ id: 'q1', status: 'matched', indices: [1] }]);
  assert.equal(result.token, undefined);
  assert.equal(result.bank, undefined);
});
test('配置落盘但重新启动不会自动开始任务', async t => {
  const { bridge, dataDir } = await setup(t);
  bridge.update({ enabled: true, autoAnswer: true });
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json')));
  assert.equal(saved.settings.enabled, false);
  assert.equal(saved.settings.autoAnswer, true);
  const second = createBridge({ dataDir, port: 0 });
  assert.equal(second.snapshot().settings.enabled, false);
  assert.equal(second.snapshot().token, token);
  await second.close();
});
test('诊断记录去除配对码、URL 参数和题目内容', async t => {
  const { sync, dataDir } = await setup(t);
  await sync({ frameHost: 'mooc1.chaoxing.com', framePath: '/mycourse/studentstudy?secret=value#private', iframeCount: 1, iframeOrigins: ['https://mooc1.chaoxing.com/path?secret=value'], extensionVersion: '0.1.1' });
  const raw = fs.readFileSync(path.join(dataDir, 'last-status.json'), 'utf8');
  const diagnostic = JSON.parse(raw);
  assert.equal(diagnostic.frames[0].framePath, '/mycourse/studentstudy');
  assert.equal(diagnostic.frames[0].iframeOrigins[0], 'https://mooc1.chaoxing.com');
  assert.equal(raw.includes('secret=value'), false);
  assert.equal(raw.includes(token), false);
});
test('专用浏览器启动后，其他浏览器的旧插件不会同时执行任务', async t => {
  const { bridge, request, sync } = await setup(t);
  bridge.control('start');
  bridge.useClient('managed-client');
  assert.equal((await request({ clientId: 'old-plugin', tabId: 1, frameId: 0, action: 'next' })).status, 409);
  const result = await sync({ media: 1, complete: false }, 0, { clientId: 'managed-client' });
  assert.equal(result.settings.enabled, true);
  assert.equal(bridge.snapshot().frames.length, 1);
});

test('真实同步请求先收集题目；关闭开关及隐藏帧不收集，确认答案后才返回匹配', async t => {
  const { bridge, sync } = await setup(t);
  const questions = [{ id: 'q1', title: '收集测试题', options: ['甲', '乙'], multiple: false }];
  const first = await sync({ assessment: true, visible: true, chapter: '章节 2.2' }, 1, { questions });
  assert.equal(first.answers[0].status, 'missing');
  assert.equal(bridge.snapshot().pendingCount, 1);
  await sync({ assessment: true }, 1, { questions });
  assert.equal(bridge.snapshot().pendingCount, 1);
  bridge.update({ collectQuestions: false });
  await sync({}, 1, { questions: [{ ...questions[0], title: '不收集' }] });
  assert.equal(bridge.snapshot().pendingCount, 1);
  bridge.update({ collectQuestions: true });
  await sync({ visible: false }, 1, { questions: [{ ...questions[0], title: '隐藏题目' }] });
  assert.equal(bridge.snapshot().pendingCount, 1);
  bridge.saveQuestion({ ...bridge.listBank().entries[0], answers: ['乙'] });
  assert.deepEqual((await sync({}, 1, { questions })).answers[0].indices, [1]);
});

test('言溪补查异步返回不阻塞心跳；关闭自动保存时远程答案不进入导出', async t => {
  let release;
  const requested = [];
  const secret = 'test-private-enncy-credential';
  const { bridge, sync, dataDir } = await setup(t, { enncyOptions: { requestGap: 0, fetchImpl: async url => {
    const parsed = new URL(url); requested.push(parsed.pathname);
    const body = parsed.pathname === '/info' ? { code: 1, data: { times: 100 } } : await new Promise(resolve => { release = () => resolve({ code: 1, data: { question: '在线缺题', answer: '乙', times: 99, ai: true } }); });
    return { ok: true, text: async () => JSON.stringify(body) };
  } } });
  await bridge.configureEnncy({ token: secret, enabled: true });
  bridge.importBank([{ question: '本地已有', answer: '甲' }]);
  bridge.update({ enabled: true, autoAnswer: true, autoSubmit: true, skipUnanswered: true, saveOnlineAnswers: false });
  const local = { id: 'local', title: '本地已有', options: ['甲', '乙'] };
  const remote = { id: 'remote', title: '在线缺题', options: ['甲', '乙'] };
  const state = { stepKind: 'assessment', assessment: true, questionTotal: 2, questions: 2 };
  const first = await sync(state, 0, { questions: [local, remote] });
  assert.deepEqual(first.answers.map(x => x.status), ['matched', 'pending']);
  assert.match(first.waitReason, /言溪正在查找/);
  assert.equal(first.advance, false); assert.equal(first.canConfirmSubmit, false);
  assert.equal(first.enncy, undefined); // Private account configuration is never returned to the plugin.
  assert.equal(JSON.stringify(first).includes(secret), false);
  release();
  for (let i = 0; i < 30 && bridge.snapshot().enncy.pending; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const next = await sync({ ...state, filled: 2 }, 0, { questions: [local, remote] });
  assert.deepEqual(next.answers[1].indices, [1]);
  assert.equal(next.answers[1].ai, true);
  assert.equal(next.canConfirmSubmit, true);
  assert.equal(bridge.snapshot().enncy.remaining, 99);
  assert.equal(requested.filter(x => x === '/query').length, 1);
  assert.equal(bridge.exportBank().questions.find(x => x.question === '在线缺题').answers.length, 0);
  for (const name of ['last-status.json', 'settings.json', 'enncy-config.json']) assert.equal(fs.readFileSync(path.join(dataDir, name), 'utf8').includes(secret), false);
  bridge.update({ enabled: false });
  await sync(state, 0, { questions: [{ ...remote, title: '暂停不查题' }] });
  assert.equal(requested.filter(x => x === '/query').length, 1);
});

test('真实同步按本地→言溪→DeepSeek回退，独立模式不调用另一来源，在线答案自动保存并复用', async t => {
  const calls = { enncy: [], deepseek: [] };
  const reply = body => ({ ok: true, text: async () => JSON.stringify(body) });
  const { bridge, sync, dataDir } = await setup(t, {
    enncyOptions: { requestGap: 0, fetchImpl: async url => {
      const u = new URL(url); if (u.pathname === '/info') return reply({ code: 1, data: { times: 50 } });
      const title = u.searchParams.get('title'); calls.enncy.push(title);
      return reply(title === '言溪有答案' ? { code: 1, data: { question: title, answer: '甲', times: 49 } } : { code: 0, data: { times: 48 }, message: '未找到答案' });
    } },
    deepseekOptions: { requestGap: 0, fetchImpl: async (url, init) => {
      if (url.endsWith('/user/balance')) return reply({ is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '3.00' }] });
      const body = JSON.parse(init.body); calls.deepseek.push(JSON.parse(body.messages[1].content).question);
      return reply({ choices: [{ finish_reason: 'stop', message: { content: '{"indices":[1],"uncertain":false}' } }], usage: { total_tokens: 80 } });
    } }
  });
  await bridge.configureEnncy({ token: 'test-enncy-secret', enabled: true });
  await bridge.configureDeepSeek({ apiKey: 'sk-test-secret', enabled: true });
  bridge.update({ enabled: true, autoAnswer: true, autoSubmit: false, lookupMode: 'enncy-deepseek', saveOnlineAnswers: true });
  const ask = async title => {
    let result;
    for (let i = 0; i < 80; i++) {
      result = await sync({ stepKind: 'assessment', assessment: true, questionTotal: 1, questions: 1 }, 0, { questions: [{ id: 'q', title, options: ['甲', '乙'] }] });
      if (result.answers[0].status !== 'pending') return result.answers[0];
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('lookup did not finish');
  };
  assert.deepEqual((await ask('言溪有答案')).indices, [0]);
  assert.deepEqual(calls.deepseek, []);
  assert.deepEqual((await ask('言溪无答案转AI')).indices, [1]);
  assert.deepEqual(calls.deepseek, ['言溪无答案转AI']);
  const ai = bridge.exportBank().questions.find(q => q.question === '言溪无答案转AI');
  assert.equal(ai.reviewed, false); assert.equal(ai.answerOrigin, 'deepseek'); assert.deepEqual(ai.answers, ['乙']);
  assert.equal((await ask('言溪无答案转AI')).source, 'local'); assert.equal(calls.deepseek.length, 1);
  bridge.update({ lookupMode: 'deepseek' }); const oldEnncy = calls.enncy.length;
  assert.equal((await ask('仅AI的新题')).source, 'deepseek'); assert.equal(calls.enncy.length, oldEnncy);
  bridge.update({ lookupMode: 'enncy' }); const oldAI = calls.deepseek.length;
  assert.equal((await ask('仅言溪无答案')).status, 'missing'); assert.equal(calls.deepseek.length, oldAI);
  bridge.update({ lookupMode: 'local' });
  assert.equal((await ask('本地模式新题')).status, 'missing'); assert.equal(calls.deepseek.length, oldAI);
  const callsBefore = JSON.stringify(calls);
  assert.equal((await ask('仅AI的新题')).source, 'local'); assert.equal(JSON.stringify(calls), callsBefore);
  const exported = JSON.stringify(bridge.exportBank());
  assert.equal(exported.includes('sk-test-secret'), false); assert.equal(exported.includes('test-enncy-secret'), false);
  assert.equal(fs.readFileSync(path.join(dataDir, 'last-status.json'), 'utf8').includes('sk-test-secret'), false);
});
