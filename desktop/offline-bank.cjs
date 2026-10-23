const fs = require('node:fs');
const path = require('node:path');
const { normalize, questionKey, answerKey, matchAnswers } = require('../extension/rules.js');
function openOfflineBank(dataDir) {
  const filename = path.join(dataDir, 'offline-bank.sqlite');
  if (!fs.existsSync(filename)) return { count: 0, match: () => ({ status: 'missing', indices: [] }), search: () => ({ entries: [], total: 0 }), close() {} };
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filename, { readOnly: true });
  const count = Number(db.prepare('SELECT COUNT(*) AS total FROM entries').get().total);
  const query = db.prepare('SELECT question, answer FROM entries WHERE normalized = ? LIMIT 61');
  const searchRows = db.prepare("SELECT source_id, question, answer, type FROM entries WHERE normalized LIKE ? ESCAPE '\\' LIMIT 30 OFFSET ?");
  const searchCount = db.prepare("SELECT COUNT(*) AS total FROM entries WHERE normalized LIKE ? ESCAPE '\\'");
  let closed = false;
  const plain = value => String(value).replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
  return {
    count,
    match(question) {
      if (!question || typeof question.title !== 'string' || question.title.length > 4000 || !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 30) return { status: 'missing', indices: [] };
      const key = value=>answerKey(question,value);
      const options = question.options.map(key);
      const rows = query.all(questionKey(question.title));
      if (rows.length > 60) return { status: 'ambiguous', indices: [] };
      const candidates = [];
      for (const row of rows) {
        const answer = plain(row.answer);
        // Letter-only answers cannot be mapped safely without the original option order.
        if (/^[A-H](?:[A-H\s#;,|、]*)$/i.test(answer)) continue;
        const answers = options.includes(key(answer)) ? [answer] : question.multiple ? answer.split(/[\x01\r\n#|;；]+/).map(plain).filter(Boolean) : [answer];
        if (!answers.length || answers.some(value => !options.includes(key(value))) || (!question.multiple && answers.length !== 1)) continue;
        candidates.push({ question: question.title, answers });
      }
      const result = matchAnswers(question, candidates);
      return { ...result, ...(result.status === 'matched' ? { source: '公开离线题库', verified: false, texts: result.indices.map(index => question.options[index]) } : {}) };
    },
    search({ search = '', offset = 0 } = {}) {
      const term = normalize(String(search).slice(0, 4000));
      if (term.length < 2) return { entries: [], total: 0 };
      const pattern = '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
      const entries = searchRows.all(pattern, Math.max(0, Math.floor(Number(offset) || 0))).map(row => ({ question: row.question, answers: row.answer.split('\x01').map(plain), options: [], multiple: row.type === 2, verified: false, conflict: false, source: `公开离线题库 · ${row.source_id}`, reference: true }));
      return { entries, total: Number(searchCount.get(pattern).total) };
    },
    close() { if (!closed) { closed = true; db.close(); } }
  };
}
module.exports = { openOfflineBank };
