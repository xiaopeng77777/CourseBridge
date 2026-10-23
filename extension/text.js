(function (root) {
  let jobs = new WeakMap(), active = true;
  const running = new Set();
  const normalize = value => String(value || '').replace(/[\s\u200b\ufeff]/gu, '');
  function read(element, title, includeHidden = false) {
    const usable = el => (includeHidden || root.CourseBridgeAdapter.visible(el)) && !el.disabled && !el.readOnly && !el.closest('[role=toolbar],.edui-editor-toolbarbox,.tox-toolbar,.cke_top,.ck-toolbar');
    const fields = [];
    for (const frame of element.querySelectorAll('iframe')) {
      if (!usable(frame)) continue;
      try { const doc = frame.contentDocument, body = doc?.body; if (body && (body.isContentEditable || doc.designMode === 'on')) fields.push({ element: body, frame, rich: true }); } catch { /* Cross-origin editors stay unsupported. */ }
    }
    for (const editable of element.querySelectorAll('[contenteditable=true],[contenteditable="plaintext-only"]')) {
      if (usable(editable) && !editable.parentElement.closest('[contenteditable=true],[contenteditable="plaintext-only"]')) fields.push({ element: editable, rich: true });
    }
    for (const input of element.querySelectorAll('textarea,input[type=text],input[type=number],input:not([type])')) if (usable(input)) fields.push({ element: input, rich: false });
    const type = /填空题/.test(title) ? 'blank' : /论述题|作文题|写作题|论述题目/.test(title) ? 'essay' : /简答题|问答题/.test(title) ? 'short' : fields.length > 1 ? 'blank' : fields.some(f => f.rich) ? 'essay' : 'short';
    // Editor content and toolbar text must not change the parsed requirements.
    const declared = element.cloneNode(true);
    for (const el of declared.querySelectorAll('iframe,textarea,input,[contenteditable],[role=toolbar],.edui-editor-toolbarbox,.tox-toolbar,.cke_top,.ck-toolbar')) el.remove();
    const length = String(title + '\n' + declared.textContent).match(/(?:不少于|至少|最低)\s*(\d{1,4})\s*字|(?:\(|（)?(\d{1,4})\s*字(?:以上|及以上|起)/);
    return { type, blankCount: type === 'blank' ? Math.max(1, fields.length) : 1, minLength: Math.min(5000, Number(length?.[1] || length?.[2]) || 0), textFields: fields };
  }
  const value = field => field.rich ? (typeof field.element.innerText === 'string' ? field.element.innerText : field.element.textContent || '') : field.element.value;
  async function request(job, operation) {
    return root.chrome.runtime.sendMessage({ type: 'text-input', typing: { requestId: job.requestId, operation, ...(operation === 'start' ? job.input : {}) } });
  }
  function cancel(job, reason) {
    if (job.state !== 'pending') return;
    job.state = 'blocked'; job.detail = reason; clearTimeout(job.timer); running.delete(job);
    void request(job, 'cancel').catch(() => {});
  }
  async function poll(job, operation) {
    try {
      const result = await request(job, operation);
      if (job.state !== 'pending') return;
      if (result?.error) throw Error(result.error);
      if (!['pending','done','blocked','busy'].includes(result?.status)) {
        job.state = 'blocked'; job.detail = '插件后台未返回输入状态，属于输入连接问题；请重新打开课桥课程浏览器后重试'; running.delete(job); return;
      }
      job.state = result?.status || 'blocked'; job.detail = result?.detail || ''; job.typed = Number(result?.typed) || 0;
      if (job.state === 'pending') job.timer = setTimeout(() => poll(job, 'status'), 300);
      else { running.delete(job); job.input = undefined; }
    } catch { job.state = 'blocked'; job.detail = '桌面端输入连接中断，已保留现有内容，请暂停后核对'; running.delete(job); }
  }
  function verified(question, answer) {
    return root.CourseBridgeRules.textAnswersValid(question, answer?.textAnswers) && question.textFields.length === answer.textAnswers.length && question.textFields.every((field, i) => {
      const job = jobs.get(field.element);
      return (!job || job.state === 'done') && normalize(value(field)) === normalize(answer.textAnswers[i]);
    });
  }
  function apply(question, answer) {
    question.fillIssue = '';
    if (!active) { question.fillIssue = '文本输入已暂停'; return false; }
    if (!root.CourseBridgeRules.textAnswersValid(question, answer.textAnswers)) { question.fillIssue = '答案空数或字数不符合要求'; return false; }
    if (question.textFields.length !== answer.textAnswers.length) { question.fillIssue = '文本编辑器尚未就绪或暂不支持'; return false; }
    // Check all fields first. Never clear a manual answer or restart partial text.
    for (let i = 0; i < question.textFields.length; i++) {
      const field = question.textFields[i], job = jobs.get(field.element), target = answer.textAnswers[i].trim();
      if (job && job.target !== target) { cancel(job, '参考答案已改变，已停止输入'); question.fillIssue = '参考答案已改变，保留原文，请核对后暂停再开始'; return false; }
      if (!job && normalize(value(field)) && normalize(value(field)) !== normalize(target)) { question.fillIssue = '已有手动内容，保留原文，请核对后继续'; return false; }
    }
    for (let i = 0; i < question.textFields.length; i++) {
      const field = question.textFields[i], target = answer.textAnswers[i].trim();
      let job = jobs.get(field.element);
      if (job?.state === 'busy') { jobs.delete(field.element); job = null; }
      if (!job && normalize(value(field)) === normalize(target)) continue;
      if (!job) {
        const questionMarker = question.element.getAttribute('data-coursebridge-typing-question') || crypto.randomUUID(), targetMarker = crypto.randomUUID();
        question.element.setAttribute('data-coursebridge-typing-question', questionMarker);
        field.element.setAttribute('data-coursebridge-typing-target', targetMarker);
        job = { requestId: crypto.randomUUID(), state: 'pending', target, typed: 0, field, question, rawTitle: question.titleElement?.textContent || '', input: { questionMarker, targetMarker, rawTitle: question.titleElement?.textContent || '', text: target } };
        jobs.set(field.element, job); running.add(job); void poll(job, 'start');
      }
      if (job.state !== 'done') {
        question.fillIssue = job.state === 'pending' ? `正在逐字输入 ${job.typed}/${Array.from(target).length} 字，输入完成后核对保存` : job.detail || '文本输入未完成，请手动核对';
        return false;
      }
    }
    const ok = verified(question, answer);
    if (!ok) question.fillIssue = '输入后的正文与参考答案不同，已停止自动操作，请手动核对';
    return ok;
  }
  function setContext({ active: enabled, questions = [] }) {
    active = enabled;
    for (const job of running) if (!active || !job.field.element.isConnected || !questions.some(q => q.element === job.question.element && q.titleElement?.textContent === job.rawTitle && q.textFields?.some(f => f.element === job.field.element))) cancel(job, '任务已暂停或题目已切换，已停止输入');
  }
  function reset() { for (const job of running) cancel(job, '已停止输入，保留现有内容'); jobs = new WeakMap(); }
  function progress(questions) {
    const current = questions.flatMap(q => (q.textFields || []).map(field => jobs.get(field.element))).filter(Boolean);
    const pending = current.find(job => ['pending','busy'].includes(job.state));
    return { textInputPending: !!pending, textInputReason: pending ? `正在逐字输入 ${pending.typed}/${Array.from(pending.target).length} 字，输入完成后核对保存` : current.find(job => job.state === 'blocked')?.detail || '' };
  }
  root.CourseBridgeText = { read, apply, verified, setContext, reset, progress };
})(globalThis);
