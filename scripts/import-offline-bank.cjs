const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readQuestionRows } = require('../desktop/sql-data.cjs');
const { questionKey } = require('../extension/rules.js');
const argumentsList = process.argv.slice(2);
const argument = name => { const index = argumentsList.indexOf(name); return index >= 0 ? argumentsList[index + 1] : undefined; };
if (!argument('--input') || !argument('--output')) throw new Error('用法：node scripts/import-offline-bank.cjs --input cxtk.sql --output offline-bank.sqlite');
const input = path.resolve(argument('--input'));
const output = path.resolve(argument('--output'));
const temporary = output + '.building';
if (fs.existsSync(output) || fs.existsSync(temporary)) throw new Error('输出或临时文件已存在，不覆盖');
if (fs.statSync(input).size > 512 * 1024 * 1024) throw new Error('当前导入器最多读取 512 MB 的 SQL 文本');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.closeSync(fs.openSync(temporary, 'wx'));
let db;
try {
  db = new DatabaseSync(temporary);
  db.exec('CREATE TABLE entries (source_id INTEGER, question TEXT NOT NULL, answer TEXT NOT NULL, type INTEGER, normalized TEXT NOT NULL); CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT); BEGIN;');
  const insert = db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?)');
  let count = 0, skipped = 0;
  for (const [id, question, answer, type] of readQuestionRows(fs.readFileSync(input, 'utf8'))) {
    if (!question?.trim() || !answer?.trim()) { skipped++; continue; }
    insert.run(id, question, answer, type, questionKey(question)); count++;
  }
  if (!count) throw new Error('没有找到受支持的 tk 表题目数据');
  db.exec('COMMIT; CREATE INDEX idx_entries_normalized ON entries(normalized);');
  const metadata = db.prepare('INSERT INTO metadata VALUES (?, ?)');
  metadata.run('source', argument('--source') || '本地 SQL 数据文件');
  metadata.run('verified', 'false');
  metadata.run('license', 'not specified');
  db.close(); db = undefined;
  fs.renameSync(temporary, output);
  console.log(JSON.stringify({ count, skipped, output }));
} catch (error) { db?.close(); fs.unlinkSync(temporary); throw error; }
