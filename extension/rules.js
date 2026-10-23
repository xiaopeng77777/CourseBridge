/* Original CourseBridge implementation; shared between the extension and Node. */
(function (root) {
  const defaults = Object.freeze({ enabled: false, keepAwake: true, autoNext: true, autoAnswer: false, autoSubmit: false, skipUnanswered: true, collectQuestions: true, useOfflineBank: false, saveOnlineAnswers: true, lookupMode: 'enncy-deepseek', muted: true, playbackRate: 1, nextDelay: 5 });
  function normalize(value) {
    return String(value ?? '').normalize('NFKC').replace(/^\s*(?:第?\d+[题、.．)]|[A-H][.．、)）])\s*/i, '').replace(/[\s\u200b]+/g, '').toLowerCase();
  }
  function questionKey(value) {
    const text = String(value ?? '').normalize('NFKC').replace(/^\s*(?:第?\d+\s*[.、)题]?\s*)?[【\[(]\s*(?:单选题|多选题|判断题|填空题|简答题|论述题)\s*[】\])]\s*/, '');
    return normalize(text);
  }
  function sanitizeSettings(input = {}) {
    const result = { ...defaults };
    result.major = typeof input.major === 'string' ? input.major.trim().slice(0, 80) : '';
    for (const key of ['enabled', 'keepAwake', 'autoNext', 'autoAnswer', 'autoSubmit', 'skipUnanswered', 'collectQuestions', 'useOfflineBank', 'saveOnlineAnswers', 'muted']) if (typeof input[key] === 'boolean') result[key] = input[key];
    if (['local', 'enncy', 'deepseek', 'enncy-deepseek'].includes(input.lookupMode)) result.lookupMode = input.lookupMode;
    for (const [key, low, high] of [['playbackRate', 0.5, 16], ['nextDelay', 2, 60]]) {
      if (typeof input[key] === 'number' && Number.isFinite(input[key])) result[key] = Math.max(low, Math.min(high, input[key]));
    }
    return result;
  }
  const isTextQuestion = question => ['blank', 'short', 'essay'].includes(question?.type);
  const needsMajor = question => /(?:我的|你的|本人|所学|你所在|自己|学生所学).{0,8}专业|结合.{0,10}专业|专业视角/.test(question?.title || question?.question || '');
  function textAnswersValid(question, answers) {
    const count = question.type === 'blank' ? Math.max(1, Math.min(30, Number(question.blankCount) || 1)) : 1;
    return Array.isArray(answers) && answers.length === count && answers.every(a => typeof a === 'string' && a.trim() && a.length <= 16000) && answers.join('').replace(/\s/g, '').length >= (Number(question.minLength) || 0);
  }
  function validateBank(input) {
    if (!Array.isArray(input) || input.length > 10000) throw new Error('题库需要是最多 10000 条的 JSON 数组');
    return input.map((item, i) => {
      if (!item || typeof item.question !== 'string' || !item.question.trim() || item.question.length > 4000) throw new Error(`第 ${i + 1} 条题目不完整`);
      const answers = Array.isArray(item.answers) ? item.answers : [item.answer];
      if (!answers.length || answers.length > 30 || answers.some(a => typeof a !== 'string' || !a.trim() || a.length > (isTextQuestion(item) ? 16000 : 4000))) throw new Error(`第 ${i + 1} 条答案不完整`);
      return { question: item.question.trim(), answers: answers.map(a => a.trim()), ...(isTextQuestion(item) ? { type: item.type, blankCount: item.blankCount, major: item.major || '' } : {}) };
    });
  }
  function matchAnswers(question, bank) {
    const optionKey = options => JSON.stringify((options || []).map(normalize).sort());
    const text = isTextQuestion(question);
    const found = bank.filter(item => questionKey(item.question) === questionKey(question.title) && (text ? isTextQuestion(item) && item.type === question.type && (!needsMajor(question) || !item.major || item.major === question.major) : !isTextQuestion(item)) && (!item.options?.length || optionKey(item.options) === optionKey(question.options)));
    if (!found.length) return { status: 'missing', indices: [] };
    const key = value => text ? String(value).normalize('NFKC').replace(/[\s\u200b]+/g, '') : answerKey(question, value);
    const variants = new Set(found.map(item => JSON.stringify(text ? item.answers.map(key) : item.answers.map(key).sort())));
    if (variants.size !== 1) return { status: 'conflict', indices: [] };
    const answers = found[0].answers;
    if (text) {
      if (!textAnswersValid(question, answers)) return { status: 'ambiguous', indices: [], detail: '文本答案的空数或字数不符合当前题目要求' };
      const item = found[0];
      return { status: 'matched', indices: [], textAnswers: [...answers], ...(item.answerOrigin && item.answerOrigin !== 'manual' ? { source: 'local', origin: item.answerOrigin, ai: item.aiGenerated === true, reviewed: item.reviewed === true } : {}) };
    }
    const options = question.options || [];
    const indices = answers.map(answer => {
      const exact = options.map((option, i) => key(option) === key(answer) ? i : -1).filter(i => i >= 0);
      return exact.length === 1 ? exact[0] : -1;
    });
    if (indices.some(i => i < 0) || new Set(indices).size !== indices.length || (!question.multiple && indices.length !== 1)) return { status: 'ambiguous', indices: [] };
    const origin = found[0].answerOrigin;
    return { status: 'matched', indices, ...(['enncy', 'deepseek'].includes(origin) ? { source: 'local', origin, ai: found[0].aiGenerated === true, reviewed: found[0].reviewed === true } : {}) };
  }
  function answerKey(question, value) {
    const text = normalize(value);
    if (/[【\[(]\s*判断题\s*[】\])]/.test(String(question?.title || ''))) {
      if (['正确','对','是','true','√','✓','✔'].includes(text)) return 'judgment:true';
      if (['错误','错','否','false','×','✗','✘'].includes(text)) return 'judgment:false';
    }
    return text;
  }
  const api = { defaults, normalize, questionKey, answerKey, sanitizeSettings, validateBank, matchAnswers, isTextQuestion, needsMajor, textAnswersValid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CourseBridgeRules = api;
})(globalThis);
