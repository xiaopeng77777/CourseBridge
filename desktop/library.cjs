const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { normalize, questionKey, matchAnswers, isTextQuestion, textAnswersValid } = require('../extension/rules.js');
const MAX = 10000;
const equalAnswers = (a, b, ordered = false) => {
  const key = value => ordered ? String(value).normalize('NFKC').replace(/[\s\u200b]+/g, '') : normalize(value);
  return JSON.stringify(ordered ? a.map(key) : a.map(key).sort()) === JSON.stringify(ordered ? b.map(key) : b.map(key).sort());
};
function texts(value, name, max = 30, length = 4000) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || value.some(x => typeof x !== 'string' || !x.trim() || x.length > length)) throw new Error(`${name}格式不正确`);
  return value.map(x => x.trim());
}
function clean(raw, source = '手动添加') {
  if (!raw || typeof raw.question !== 'string' || !raw.question.trim() || raw.question.length > 4000) throw new Error('请填写题干，最长 4000 个字符');
  const text = isTextQuestion(raw);
  const type = text ? raw.type : raw.multiple ? 'multiple' : 'single';
  const major = text && typeof raw.major === 'string' ? raw.major.trim().slice(0, 80) : '';
  const options = texts(raw.options, '选项');
  const answers = texts(raw.answers ?? (raw.answer === undefined ? [] : [raw.answer]), '答案', 30, text ? 16000 : 4000);
  if (!text && new Set(answers.map(normalize)).size !== answers.length) throw new Error('答案存在重复项');
  if (!text && raw.multiple === false && answers.length > 1) throw new Error('单选题只能填写一个答案');
  if (options.length && answers.some(answer => options.filter(option => normalize(option) === normalize(answer)).length !== 1)) throw new Error('答案必须与某一个选项的完整文字匹配，请核对重复选项');
  const id = createHash('sha256').update(JSON.stringify([questionKey(raw.question), options.map(normalize).sort(), ...(text ? [type, major] : [])])).digest('hex').slice(0, 24);
  const conflict = raw.conflict === true;
  const answerOrigin = ['enncy', 'deepseek'].includes(raw.answerOrigin) ? raw.answerOrigin : 'manual';
  const aiGenerated = answerOrigin === 'deepseek' || raw.aiGenerated === true;
  const reviewed = answers.length > 0 && (typeof raw.reviewed === 'boolean' ? raw.reviewed : answerOrigin === 'manual');
  const answerVariants = conflict && Array.isArray(raw.answerVariants) ? raw.answerVariants.slice(0, 30).map(value => texts(value, '冲突答案', 30, text ? 16000 : 4000)) : [];
  return { id, type, major, blankCount: type === "blank" ? Math.max(1, Math.min(30, Number(raw.blankCount) || answers.length || 1)) : 1, question: raw.question.trim(), options, answers, multiple: typeof raw.multiple === 'boolean' ? raw.multiple : answers.length > 1, verified: answers.length > 0 && raw.verified !== false && !conflict, reviewed, answerOrigin, aiGenerated, answerModel: typeof raw.answerModel === 'string' ? raw.answerModel.slice(0, 100) : '', conflict, answerVariants, source: String(raw.source || source).slice(0, 200), createdAt: Number(raw.createdAt) || Date.now() };
}
// CSV supports quoted commas, escaped quotes, CRLF, and quoted multiline cells.
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell) quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(x => x.trim())) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  if (!rows.length) throw new Error('题库文件为空');
  const headers = rows.shift().map(x => x.trim().toLowerCase());
  const index = names => headers.findIndex(x => names.includes(x));
  const question = index(['question', 'title', '题目', '题干']);
  const answer = index(['answers', 'answer', '答案']);
  const options = index(['options', '选项']);
  const type = index(['type', '题型']);
  if (question < 0) throw new Error('CSV 需要“题目”或 question 列');
  const split = value => !value?.trim() ? [] : value.trim().startsWith('[') ? JSON.parse(value) : value.split('|').map(x => x.trim()).filter(Boolean);
  return rows.map(row => ({ question: row[question], answers: split(row[answer]), options: split(row[options]), ...(type < 0 ? {} : { multiple: /^(多选|multiple)$/i.test(row[type]?.trim()), ...({ '填空': 'blank', '填空题': 'blank', '简答': 'short', '简答题': 'short', '论述': 'essay', '论述题': 'essay', blank: 'blank', short: 'short', essay: 'essay' }[row[type]?.trim()] ? { type: { '填空': 'blank', '填空题': 'blank', '简答': 'short', '简答题': 'short', '论述': 'essay', '论述题': 'essay', blank: 'blank', short: 'short', essay: 'essay' }[row[type]?.trim()] } : {}) }) }));
}
function readImport(text, extension) {
  if (extension.toLowerCase() === '.csv') return parseCSV(text);
  const parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  const entries = Array.isArray(parsed) ? parsed : parsed?.questions;
  if (!Array.isArray(entries)) throw new Error('JSON 需要题目数组，或包含 questions 数组的备份文件');
  return entries;
}
function createLibrary({ dataDir, seed = [] }) {
  const file = path.join(dataDir, 'question-library.json');
  let entries = new Map(); let revision = 0;
  const persist = (items = entries, version = revision) => { const temporary = file + '.tmp'; fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 1, revision: version, entries: [...items.values()] }, null, 2), { mode: 0o600 }); fs.renameSync(temporary, file); };
  function merge(next, raw, source) {
    const item = clean(raw, source);
    const old = next.get(item.id);
    if (!old) { next.set(item.id, item); return; }
    if (old.answers.length && item.answers.length && !equalAnswers(old.answers, item.answers, isTextQuestion(item))) {
      const variants = [...old.answerVariants, old.answers, item.answers].filter((value, index, all) => all.findIndex(other => equalAnswers(value, other, isTextQuestion(item))) === index).slice(0, 30);
      next.set(old.id, { ...old, verified: false, conflict: true, answerVariants: variants }); return;
    }
    if (!old.answers.length && item.answers.length) next.set(old.id, { ...old, answers: item.answers, multiple: item.multiple, verified: item.verified && !old.conflict, reviewed: item.reviewed, answerOrigin: item.answerOrigin, aiGenerated: item.aiGenerated, answerModel: item.answerModel, source: item.answerOrigin !== 'manual' ? item.source : old.source, conflict: old.conflict || item.conflict });
  }
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.schemaVersion !== 1 || !Array.isArray(saved.entries) || saved.entries.length > MAX) throw new Error('本地题库格式不正确，请从备份恢复');
    for (const item of saved.entries) merge(entries, item);
    revision = Number(saved.revision) || 0;
  } else { for (const item of seed) merge(entries, item, '原有本地题库'); persist(); }
  const matcherBank = () => [...entries.values()].filter(item => item.verified && !item.conflict).map(({ question, answers, options, answerOrigin, aiGenerated, reviewed, answerModel, type, blankCount, major }) => ({ question, answers, options, answerOrigin, aiGenerated, reviewed, answerModel, type, blankCount, major }));
  const stats = () => ({ bankCount: [...entries.values()].filter(item => item.verified && !item.conflict).length, pendingCount: [...entries.values()].filter(item => !item.verified || item.conflict).length, unreviewedCount: [...entries.values()].filter(item => item.answers.length && !item.reviewed && !item.conflict).length, libraryRevision: revision });
  const commit = next => { persist(next, revision + 1); entries = next; revision++; };
  return {
    stats, matcherBank,
    hasConflict(question) { return [...entries.values()].some(item => item.conflict && (!isTextQuestion(question) ? !isTextQuestion(item) : item.type === question.type && (!item.major || item.major === question.major)) && questionKey(item.question) === questionKey(question.title) && (!item.options.length || JSON.stringify(item.options.map(normalize).sort()) === JSON.stringify((question.options || []).map(normalize).sort()))); },
    list({ search = '', filter = 'all', offset = 0 } = {}) {
      const query = normalize(String(search).slice(0, 4000));
      const all = [...entries.values()].filter(item => (!query || normalize(item.question).includes(query) || item.options.some(option => normalize(option).includes(query))) && (filter === 'ready' ? item.verified && !item.conflict : filter === 'pending' ? !item.verified || item.conflict : filter === 'unreviewed' ? item.answers.length && !item.reviewed && !item.conflict : true)).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      offset = Math.max(0, Math.floor(Number(offset) || 0));
      return { entries: all.slice(offset, offset + 30), total: all.length, ...stats() };
    },
    save(input) {
      const original = entries.get(input?.id);
      const item = clean({ ...input, answerOrigin: original?.answerOrigin || 'manual', aiGenerated: original?.aiGenerated || false, answerModel: original?.answerModel || '', reviewed: !!input?.answers?.length, verified: !!input?.answers?.length, conflict: false });
      if (input.id && !entries.has(input.id)) throw new Error('题目已不存在，请刷新列表');
      const next = new Map(entries);
      if (input.id) next.delete(input.id);
      if (next.has(item.id)) throw new Error('已有相同题干与选项，请编辑已有题目');
      if (next.size >= MAX) throw new Error('本地题库最多支持 10000 道题目');
      const old = entries.get(input.id);
      next.set(item.id, { ...item, source: old?.source || item.source, createdAt: old?.createdAt || item.createdAt });
      commit(next); return stats();
    },
    import(input) {
      if (!Array.isArray(input) || input.length > MAX) throw new Error('题库需要是最多 10000 条的数组');
      const next = new Map(entries);
      for (const item of input) merge(next, item, '文件导入');
      if (next.size > MAX) throw new Error('合并后超过 10000 道题目，未导入');
      commit(next); return stats();
    },
    storeRemote(question, result) {
      if (result?.status !== 'matched' || !['enncy', 'deepseek'].includes(result.source) || (isTextQuestion(question) ? !textAnswersValid(question, result.textAnswers) : (!Array.isArray(result.indices) || !result.indices.length || result.indices.some(i => !Number.isInteger(i) || i < 0 || i >= question.options.length) || new Set(result.indices).size !== result.indices.length || (!question.multiple && result.indices.length !== 1)))) throw new Error('在线参考答案无法保存');
      const answers = isTextQuestion(question) ? result.textAnswers : result.indices.map(i => question.options[i]);
      const source = result.source === 'deepseek' ? 'DeepSeek AI 参考答案' : result.ai ? '言溪题库 · AI 参考答案' : '言溪在线题库';
      const item = clean({ question: question.title, options: question.options, multiple: question.multiple, type: question.type, blankCount: question.blankCount, major: question.major, answers, source, answerOrigin: result.source, aiGenerated: result.ai === true, answerModel: result.model || '', reviewed: false, verified: true });
      const old = entries.get(item.id);
      if (old?.conflict) return { saved: false, reason: '本地答案冲突，未自动覆盖' };
      if (old?.answers.length) {
        if (equalAnswers(old.answers, item.answers, isTextQuestion(item))) return { saved: false };
        const next = new Map(entries); merge(next, item, source); commit(next);
        return { saved: false, conflict: true, reason: '在线答案与本地不同，已保留冲突候选等待核对' };
      }
      // A general manually recorded answer must not be replaced by an option-specific reference.
      if ([...entries.values()].some(entry => entry.answers.length && questionKey(entry.question) === questionKey(question.title) && !entry.options.length && !isTextQuestion(question))) return { saved: false, reason: '已有本地答案，未自动覆盖' };
      if (!old && entries.size >= MAX) return { saved: false, reason: '本地题库已满，在线答案仍可用于本次匹配' };
      const next = new Map(entries);
      next.set(item.id, { ...item, createdAt: old?.createdAt || item.createdAt });
      commit(next); return { saved: true };
    },
    capture(questions, source) {
      const next = new Map(entries); const ready = matcherBank();
      for (const question of questions) {
        try {
          if (!question.title?.trim() || !Array.isArray(question.options) || (!isTextQuestion(question) && question.options.length < 2) || matchAnswers(question, ready).status === 'matched') continue;
          const item = clean({ question: question.title, options: question.options, multiple: question.multiple, type: question.type, blankCount: question.blankCount, major: question.major, answers: [], verified: false }, source);
          if (!next.has(item.id) && next.size < MAX) next.set(item.id, item);
        } catch { /* A malformed page question must not interrupt playback or overwrite the library. */ }
      }
      if (next.size !== entries.size) { commit(next); return true; }
      return false;
    },
    export() { return { schemaVersion: 1, questions: [...entries.values()] }; }
  };
}
module.exports = { createLibrary, readImport, parseCSV };
