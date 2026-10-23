const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLibrary, readImport } = require('../desktop/library.cjs');
const { matchAnswers } = require('../extension/rules.js');
const directory = path.join(__dirname, '..', 'work', 'library-tests');
fs.mkdirSync(directory, { recursive: true });
function setup(t, seed = []) {
  const dataDir = fs.mkdtempSync(path.join(directory, 'case-'));
  t.after(() => { for (const name of fs.readdirSync(dataDir)) fs.unlinkSync(path.join(dataDir, name)); fs.rmdirSync(dataDir); });
  return { library: createLibrary({ dataDir, seed }), dataDir };
}
const question = { title: '以下哪项是可再生能源？', options: ['煤炭', '太阳能'], multiple: false };
test('收集去重、选项换序仍是同题；待补充不参与自动匹配，补答案后可用', t => {
  const { library, dataDir } = setup(t);
  library.capture([question], '章节 2.2');
  library.capture([{ ...question, options: [...question.options].reverse() }], '章节 2.2');
  assert.equal(library.stats().pendingCount, 1);
  assert.equal(matchAnswers(question, library.matcherBank()).status, 'missing');
  const entry = library.list().entries[0];
  library.save({ ...entry, answers: ['太阳能'] });
  assert.deepEqual(matchAnswers(question, library.matcherBank()).indices, [1]);
  const reloaded = createLibrary({ dataDir });
  assert.equal(reloaded.stats().bankCount, 1);
  assert.equal(reloaded.list().entries[0].source, '章节 2.2');
});
test('相同题干但不同选项分别匹配，不能误用另一组答案', t => {
  const { library } = setup(t);
  library.import([{ question: '正确的一项', options: ['甲', '乙'], answers: ['甲'] }, { question: '正确的一项', options: ['丙', '丁'], answers: ['丁'] }]);
  assert.deepEqual(matchAnswers({ title: '正确的一项', options: ['丁', '丙'] }, library.matcherBank()).indices, [0]);
  assert.equal(matchAnswers({ title: '正确的一项', options: ['戊', '己'] }, library.matcherBank()).status, 'missing');
});
test('合并导入保留旧题；冲突答案保存候选并停止匹配，可手动核对恢复', t => {
  const { library } = setup(t, [{ question: '原有题目', answers: ['原答案'] }]);
  library.import([{ question: '新题目', answers: ['甲'] }]);
  library.import([{ question: '新题目', answers: ['乙'] }]);
  assert.equal(library.stats().bankCount, 1);
  const conflict = library.list({ filter: 'pending' }).entries[0];
  assert.equal(conflict.conflict, true);
  assert.deepEqual(conflict.answerVariants, [['甲'], ['乙']]);
  assert.equal(matchAnswers({ title: '新题目', options: ['甲', '乙'] }, library.matcherBank()).status, 'missing');
  library.save({ ...conflict, answers: ['乙'] });
  assert.equal(library.stats().pendingCount, 0);
});
test('JSON 备份往返保留待补充、选项及来源；非法导入原子失败', t => {
  const { library } = setup(t);
  library.capture([question], '课程来源');
  const backup = readImport(JSON.stringify(library.export()), '.json');
  const other = setup(t).library; other.import(backup);
  assert.equal(other.stats().pendingCount, 1);
  assert.equal(other.list().entries[0].source, '课程来源');
  const before = library.export();
  assert.throws(() => library.import([{ question: '有效', answers: ['答案'] }, { question: '' }]));
  assert.deepEqual(library.export(), before);
  assert.throws(() => library.save({ question: '题', options: ['甲', '乙'], answers: ['丙'] }));
});
test('CSV 支持中文表头、BOM、引号、换行及多答案；不执行文件内容', () => {
  const entries = readImport('\uFEFF题目,答案,选项,题型\r\n"题目,带逗号",甲|乙,甲|乙|丙,多选\r\n"两行\n题干",,,单选', '.csv');
  assert.deepEqual(entries[0].answers, ['甲', '乙']);
  assert.equal(entries[0].multiple, true);
  assert.equal(entries[1].question, '两行\n题干');
  assert.deepEqual(entries[1].answers, []);
  assert.throws(() => readImport('题目,答案\n"未闭合', '.csv'));
});

test('在线答案自动补齐待补充并去重，重启和导出保留未核验来源，选项换序仍可复用', t => {
  const { library, dataDir } = setup(t);
  library.capture([question], '课程章节');
  const result = { status: 'matched', indices: [1], source: 'deepseek', ai: true, model: 'deepseek-flash' };
  assert.equal(library.storeRemote(question, result).saved, true);
  assert.equal(library.storeRemote(question, result).saved, false);
  assert.equal(library.stats().bankCount, 1); assert.equal(library.stats().unreviewedCount, 1);
  const reloaded = createLibrary({ dataDir });
  const item = reloaded.list({ filter: 'unreviewed' }).entries[0];
  assert.equal(item.answerOrigin, 'deepseek'); assert.equal(item.reviewed, false); assert.equal(item.aiGenerated, true); assert.equal(item.answerModel, 'deepseek-flash');
  const matched = matchAnswers({ ...question, options: ['太阳能', '煤炭'] }, reloaded.matcherBank());
  assert.deepEqual(matched.indices, [0]); assert.equal(matched.ai, true); assert.equal(matched.source, 'local');
  const restored = setup(t).library; restored.import(readImport(JSON.stringify(reloaded.export()), '.json'));
  assert.equal(restored.list().entries[0].reviewed, false);
  restored.save({ ...restored.list().entries[0], answers: ['太阳能'] });
  assert.equal(restored.stats().unreviewedCount, 0);
  assert.equal(restored.list().entries[0].answerOrigin, 'deepseek');
});
test('言溪参考来源保留，不把自动保存当人工核验；不同答案不覆盖而保留冲突候选', t => {
  const { library } = setup(t);
  library.storeRemote(question, { status: 'matched', indices: [1], source: 'enncy', ai: false });
  assert.equal(library.list().entries[0].answerOrigin, 'enncy'); assert.equal(library.list().entries[0].reviewed, false);
  const result = library.storeRemote(question, { status: 'matched', indices: [0], source: 'deepseek', ai: true });
  assert.equal(result.conflict, true); const item = library.list().entries[0];
  assert.deepEqual(item.answers, ['太阳能']); assert.deepEqual(item.answerVariants, [['太阳能'], ['煤炭']]); assert.equal(item.verified, false);
  assert.equal(library.hasConflict(question), true);
});
