// Independent support for a single-question view of an examination paper.
(function (root) {
  const MAX_QUESTIONS = 200;
  const controls = doc => [...doc.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button],[onclick]')];
  const label = el => String(el.textContent || el.value || '').replace(/[\s\u200b]/g, '');
  const usable = el => root.CourseBridgeAdapter.visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.matches('.disabled,[disabled]');
  const isPreview = () => /\/exam(?:-ans)?\/(?:mooc\d+\/)?exam\/preview(?:\/|$)/i.test(location.pathname);
  const isExam = (doc = document) => isPreview() || /\/exam(?:-ans)?\/(?:exam\/)?test\//i.test(location.pathname) || doc.body?.dataset.coursebridgeExam === 'true';
  function info(doc = document) {
    if (!isExam(doc)) return { exam: false, bulk: false, total: 0, next: null, last: null };
    const all = root.CourseBridgeAdapter.questionElements(doc, true);
    const visible = all.filter(root.CourseBridgeAdapter.visible);
    const summary = (doc.body?.innerText || '').match(/(?:题量|总题数)\s*[:：]?\s*(\d{1,4})/);
    const marked = Number(doc.body?.dataset.coursebridgeExamTotal || summary?.[1]);
    const total = marked > 0 && marked <= MAX_QUESTIONS ? marked : 0;
    const bulk = all.length > visible.length && all.length > 1 && total > 0 && all.length === total;
    const next = controls(doc).find(el => usable(el) && /^(?:下一题|下一道题|下题)$/.test(label(el))) || null;
    const nextStep = controls(doc).find(el => usable(el) && label(el) === '下一步') || null;
    const lastButtons = controls(doc).filter(el => usable(el) && total > 0 && label(el) === String(total) && !all.some(question => question.contains(el)));
    return { exam: true, preview: isPreview(), bulk, total, next, nextStep, last: lastButtons.length === 1 ? lastButtons[0] : null, loaded: all.length, current: visible.length === 1 ? all.indexOf(visible[0]) + 1 : 0 };
  }
  function fingerprint(value) {
    let hash = 14695981039346656037n;
    for (let index = 0; index < value.length; index++) hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(index))) * 1099511628211n);
    return hash.toString(16).padStart(16, '0');
  }
  const identity = () => {
    const url = new URL(location.href);
    for (const key of [...url.searchParams.keys()]) if (/^(?:start|questionId|questionNum|questionIndex|index|page|pageNum|num|_t|timestamp)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    // Store only a digest of the page identity, never URL credentials or answers.
    return `coursebridge:exam:v2:${fingerprint(url.origin + url.pathname + url.search + ':' + document.title)}`;
  };
  const questionKey = q => fingerprint(JSON.stringify([q.title, q.options, q.multiple, q.type || '', q.blankCount || 0]));
  let memoryKey, memory;
  function ledger() {
    const key = identity();
    if (memoryKey !== key) {
      memoryKey = key; memory = { time: Date.now(), questions: [] };
      try {
        const saved = JSON.parse(sessionStorage.getItem(key));
        if (saved && Date.now() - saved.time < 6 * 60 * 60 * 1000 && Array.isArray(saved.questions)) memory = { time: saved.time, questions: saved.questions.filter(s => /^[0-9a-f]{16}$/.test(s)).slice(0, MAX_QUESTIONS) };
      } catch { /* Without session storage, retain progress only in this page. */ }
    }
    return memory;
  }
  function remember(questions, answers) {
    const progress = ledger(), known = new Set(progress.questions);
    for (const q of questions) {
      // Hidden controls can share a native radio group or a page-level event handler.
      // Only the active view provides evidence that this answer was applied.
      if (!root.CourseBridgeAdapter.visible(q.element)) continue;
      const answer = answers.find(a => a.id === q.id);
      const valid = root.CourseBridgeAdapter.answerApplied(q, answer);
      if (valid) known.add(questionKey(q));
      else known.delete(questionKey(q));
    }
    progress.questions = [...known].slice(0, MAX_QUESTIONS); progress.time = Date.now();
    try { sessionStorage.setItem(memoryKey, JSON.stringify(progress)); } catch { /* Keep the in-page ledger. */ }
    return progress.questions.length;
  }
  function covered(questions, page) {
    return ledger().questions.length;
  }
  function canSubmit(questions, page) {
    return page.exam && page.total > 0 && covered(questions, page) >= page.total;
  }
  function independent(questions) {
    // Custom option handlers can target a global current-question variable.
    // Multiple visible questions are writable only for independent native groups.
    const groups = [];
    for (const question of questions) {
      if (root.CourseBridgeRules.isTextQuestion(question)) return false;
      if (!question.inputs.every(input => input instanceof HTMLInputElement)) return false;
      for (const input of question.inputs) {
        if (input.type !== 'radio' || !input.name) continue;
        if (groups.some(group => group.name === input.name && group.form === input.form && group.question !== question)) return false;
        groups.push({ name: input.name, form: input.form, question });
      }
    }
    return true;
  }
  root.CourseBridgeExam = { info, isExam, remember, covered, canSubmit, independent, includeHidden: doc => info(doc).bulk };
})(globalThis);
