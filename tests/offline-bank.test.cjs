const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openOfflineBank } = require('../desktop/offline-bank.cjs');
const { readQuestionRows } = require('../desktop/sql-data.cjs');
const { normalize } = require('../extension/rules.js');
const { createBridge } = require('../desktop/bridge.cjs');
const root = path.join(__dirname, '..', 'work', 'offline-tests'); fs.mkdirSync(root, { recursive: true });
function dataset(t) {
  const dataDir = fs.mkdtempSync(path.join(root, 'case-'));
  const db = new DatabaseSync(path.join(dataDir, 'offline-bank.sqlite'));
  db.exec('CREATE TABLE entries (source_id INTEGER, question TEXT, answer TEXT, type INTEGER, normalized TEXT); CREATE INDEX ix ON entries(normalized);');
  const insert = db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?)');
  [['测试单选', '乙', 1], ['测试多选', '甲\x01丙', 2], ['只提供字母', 'B', 1], ['答案冲突', '甲', 1], ['答案冲突', '乙', 1]].forEach(([question, answer, type], i) => insert.run(i, question, answer, type, normalize(question)));
  db.close();
  t.after(() => { for (const name of fs.readdirSync(dataDir)) fs.unlinkSync(path.join(dataDir, name)); fs.rmdirSync(dataDir); });
  return dataDir;
}
test('离线库只按题干和选项内容匹配，拒绝纯字母和冲突答案；支持本地搜索', t => {
  const dataDir = dataset(t), bank = openOfflineBank(dataDir);
  try {
    assert.equal(bank.count, 5);
    assert.deepEqual(bank.match({ title: '测试单选', options: ['乙', '甲'] }).indices, [0]);
    assert.deepEqual(bank.match({ title: '测试多选', options: ['丙', '乙', '甲'], multiple: true }).indices, [2, 0]);
    assert.equal(bank.match({ title: '只提供字母', options: ['甲', '乙'] }).status, 'missing');
    assert.equal(bank.match({ title: '答案冲突', options: ['甲', '乙'] }).status, 'conflict');
    assert.equal(bank.search({ search: '测试' }).total, 2);
    assert.equal(bank.search({ search: '%' }).total, 0);
    assert.equal(bank.search({ search: "' OR 1=1 --" }).total, 0);
    assert.equal(bank.match({ title: '测试单选', options: ['丙', '丁'] }).status, 'missing');
  } finally { bank.close(); bank.close(); }
});
test('原始 SQL 作为字符串解析，转义与多选分隔保留，不接受表达式', () => {
  const input = "DROP TABLE other; INSERT INTO `tk` (`id`, `tm`, `da`, `type`, `newtm`) VALUES\n(1, '题目\\\'引号', '甲\\n乙', 2, '题目'),\n(2, 'abc', '甲\x01乙', 2, 'abc');";
  const rows = [...readQuestionRows(input)];
  assert.equal(rows.length, 2); assert.equal(rows[0][1], "题目'引号"); assert.equal(rows[0][2], '甲\n乙'); assert.equal(rows[1][2], '甲\x01乙');
  assert.throws(() => [...readQuestionRows("INSERT INTO `tk` (`id`, `tm`, `da`, `type`, `newtm`) VALUES (1, sleep(1), 'a', 1, 'b');")]);
});
test('离线库默认不参与自动答题，开启后补充匹配，个人答案冲突不被覆盖', async t => {
  const dataDir = dataset(t), bridge = createBridge({ dataDir, port: 0 });
  await bridge.listen();
  try {
    const sync = async () => (await (await fetch(`http://127.0.0.1:${bridge.snapshot().port}/v1/sync`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.snapshot().token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: 'offline-test', tabId: 1, frameId: 0, state: {}, questions: [{ id: 'q', title: '测试单选', options: ['甲', '乙'], multiple: false }] }) })).json()).answers[0];
    assert.equal((await sync()).status, 'missing');
    bridge.update({ useOfflineBank: true });
    assert.deepEqual((await sync()).indices, [1]);
    assert.equal((await sync()).verified, false);
    bridge.importBank([{ question: '测试单选', answers: ['甲'] }]);
    assert.deepEqual((await sync()).indices, [0]);
    bridge.importBank([{ question: '测试单选', answers: ['乙'] }]);
    assert.equal((await sync()).status, 'conflict');
  } finally { await bridge.close(); }
});
