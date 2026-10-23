(function (root) {
  const visible = element => !!element && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const reviewed = (doc = document) => /\/work\/selectWorkQuestionYiPiYue(?:$|\/)/i.test(location.pathname) && /查看已批阅作业|查看已提交作业/.test(doc.title);
  function questionElements(doc = document, includeHidden = false) {
    const all = [...doc.querySelectorAll('[data-coursebridge-question], .TiMu, .questionLi, .question-item, .singleQuesId, .mark_table .whiteDiv, .tkItem')].filter(el => includeHidden || visible(el));
    return all.filter(el => !all.some(child => child !== el && el.contains(child))).slice(0, 200);
  }
  function optionSelected(element) {
    if (element.matches('input')) return element.checked;
    // LearningTong uses check_answer for single choice and check_answer_dx for
    // multiple choice. Check the row and its actual control, not only ARIA.
    const selected = '.checked,.selected,.check_answer,.check_answer_dx';
    return element.getAttribute('aria-checked') === 'true' || element.getAttribute('aria-selected') === 'true' || element.matches(selected) || !!element.querySelector(selected + ',input:checked,[aria-checked=true],[aria-selected=true]');
  }
  const answerAttempts = new Map();
  const resetAnswerAttempts = () => { answerAttempts.clear(); root.CourseBridgeText?.reset(); };
  function customInput(element, multiple) {
    return { type: multiple ? 'checkbox' : 'radio', get checked() { return optionSelected(element); }, click() { (element.querySelector('.num_option,.num_option_dx,[data-option-control]') || element.querySelector('label.before, .option-label') || element).click(); } };
  }
  function readQuestions(doc = document) {
    if (reviewed(doc)) return [];
    const includeHidden = root.CourseBridgeExam?.includeHidden(doc) === true;
    return questionElements(doc, includeHidden).map((element, index) => {
      const titleElement = element.querySelector('[data-question-title], .Zy_TItle, .mark_name, .question-title, .tkItem_title, h3');
      const titleText = root.CourseBridgeFont?.text(titleElement) || {value:titleElement?.textContent?.trim(),unresolved:false};
      const title = titleText.value;
      const native = [...element.querySelectorAll('input[type=radio], input[type=checkbox]')];
      const rows = [...element.querySelectorAll('.Zy_ulTop > li, .stem_answer > .answerBg, .stem_answer > div[role=radio], .stem_answer > div[role=checkbox], [role=radio], [role=checkbox]')].filter(el => (includeHidden || visible(el)) && !el.querySelector('[role=radio],[role=checkbox]'));
      const multiple = native.some(input => input.type === 'checkbox') || /多选题/.test(title || '') || rows.some(row => row.getAttribute('role') === 'checkbox');
      const inputs = native.length ? native : rows.map(row => customInput(row, multiple));
      const textOf = el => root.CourseBridgeFont?.text(el) || {value:el?.textContent?.trim() || '',unresolved:false};
      const optionTexts = native.length ? native.map(input => textOf(input.closest('.ans-videoquiz-opt') || input.closest('label') || (input.id && doc.querySelector(`label[for="${CSS.escape(input.id)}"]`)) || input.parentElement)) : rows.map(row => textOf(row.querySelector('a.after,.option-content,.answerText') || row));
      const options = optionTexts.map(item=>item.value);
      const base = { id: String(index), title, titleElement, options, multiple, encoded: titleText.unresolved || optionTexts.some(item=>item.unresolved), element, inputs };
      if (!inputs.length && root.CourseBridgeText) {
        const text = root.CourseBridgeText.read(element, title || '', includeHidden);
        return { ...base, ...text, editorReady: text.textFields.length > 0 };
      }
      return base;
    }).filter(q => q.title && (q.inputs.length || root.CourseBridgeRules.isTextQuestion(q)) && q.options.every(Boolean));
  }
  function applyAnswers(answers, questions) {
    let filled = 0;
    for (const answer of answers) {
      const question = questions.find(q => q.id === answer.id);
      if (!question || answer.status !== 'matched') continue;
      if (root.CourseBridgeExam?.isExam() && !visible(question.element)) continue;
      if (root.CourseBridgeRules.isTextQuestion(question)) { if (root.CourseBridgeText.apply(question, answer)) filled++; continue; }
      if (!answer.indices.length) continue;
      question.fillIssue = '';
      const key = JSON.stringify([question.id, question.element.id, question.title, question.options, question.multiple, answer.indices]);
      let attempted = answerAttempts.get(key);
      if (!attempted) {
        if (answerAttempts.size >= 500) answerAttempts.delete(answerAttempts.keys().next().value);
        attempted = new Set(); answerAttempts.set(key, attempted);
      }
      const changes = question.inputs.map((input, index) => ({ input, index, desired: answer.indices.includes(index) })).filter(({input, desired}) => input.checked !== desired && (input.type === 'checkbox' || desired));
      // A successful click may update classes asynchronously, or the website may
      // reject it. Never toggle the same option again on every heartbeat.
      if (changes.some(({index}) => attempted.has(index))) {
        question.fillIssue = '选项已点击，但网页选中状态未确认；已停止重复勾选，请检查后暂停再开始';
        continue;
      }
      for (const {input, index} of changes) { attempted.add(index); input.click(); }
      if (question.inputs.every((input, i) => input.checked === answer.indices.includes(i))) filled++;
      else question.fillIssue = '选项已点击，等待网页更新选中状态';
    }
    return filled;
  }
  function answerApplied(question, answer) {
    if (answer?.status !== 'matched') return false;
    if (root.CourseBridgeRules.isTextQuestion(question)) return root.CourseBridgeText.verified(question, answer);
    return answer.indices?.length > 0 && question.inputs.every((input, index) => input.checked === answer.indices.includes(index));
  }
  function findNext(doc = document) {
    const explicit = [...doc.querySelectorAll('[data-coursebridge-next], #prevNextFocusNext, #nextChapter, #next_chapter, .nextChapter, a.next, button.next')].find(el => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    if (explicit) return explicit;
    const candidates = [...doc.querySelectorAll('button, a, [role=button]')];
    return candidates.find(el => /^(下一节|下一章|下一个章节|下一章节|下一课)[\s›»>]*$/.test(el.textContent.trim()) && visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true') || null;
  }
  function navigation(doc = document) {
    let tabs = [...doc.querySelectorAll('#prev_tab .prev_ul li, .prev_ul li, [data-coursebridge-tab]')].filter(visible);
    if (!tabs.length) tabs = [...doc.querySelectorAll('[role=tab]')].filter(el => visible(el) && /视频|音频|测验|测试|课件|阅读/.test(el.textContent));
    const selected = el => el.matches('.active,.current,.curr,.on,[aria-selected=true],[data-current=true]');
    const tabIndex = tabs.findIndex(selected);
    const tabText = tabIndex >= 0 ? tabs[tabIndex].textContent.trim() : '';
    const kind = /测验|测试|作业|考试/.test(tabText) ? 'assessment' : /视频|音频/.test(tabText) ? 'media' : 'unknown';
    let chapters = [...doc.querySelectorAll('.posCatalog_name,[data-coursebridge-chapter]')];
    if (!chapters.length) chapters = [...doc.querySelectorAll('[onclick^="getTeacherAjax"]')];
    const chapterIndex = chapters.findIndex(el => el.closest('.posCatalog_active,[aria-current=page],[data-current=true]'));
    const chapter = chapterIndex >= 0 ? chapters[chapterIndex] : doc.querySelector('[data-current-chapter]');
    const key = `${chapter?.closest('[id]')?.id || chapter?.textContent?.trim() || new URL(location.href).searchParams.get('chapterId') || location.pathname}::${tabIndex}`;
    const active = chapter?.closest('.posCatalog_active,[aria-current=page],[data-current=true]');
    let completed = false;
    if (active) {
      const status = active.cloneNode(true);
      for (const label of status.querySelectorAll('.posCatalog_name,[data-coursebridge-chapter]')) label.remove();
      completed = /^(?:任务点)?已完成$/.test(status.textContent.replace(/[\s\u200b]/g,'')) || [...active.querySelectorAll('[title],[aria-label],[data-coursebridge-chapter-status]')].some(el => !chapter.contains(el) && visible(el) && /^(?:任务点)?已完成$/.test(String(el.getAttribute('title') || el.getAttribute('aria-label') || el.getAttribute('data-coursebridge-chapter-status') || '').replace(/\s/g,'')));
    }
    return { tabs, tabIndex, kind, chapters, chapterIndex, key, completed };
  }
  function nextAction(doc = document) {
    const nav = navigation(doc);
    if (!nav.completed && nav.tabIndex >= 0 && nav.tabIndex + 1 < nav.tabs.length) { const tab = nav.tabs[nav.tabIndex + 1]; return { type: 'tab', element: tab.querySelector('a,button,[onclick]') || tab }; }
    if (nav.chapterIndex >= 0 && nav.chapterIndex + 1 < nav.chapters.length) {
      const element = nav.chapters[nav.chapterIndex + 1];
      if (element.closest('[aria-disabled=true],.locked,.lockChapter')) return { type: 'locked', element: null };
      return { type: 'chapter', element };
    }
    const explicit = findNext(doc);
    return explicit ? { type: 'chapter', element: explicit } : { type: nav.chapterIndex >= 0 ? 'finished' : 'missing', element: null };
  }
  function assessmentState(doc = document) {
    const questionPage = !!doc.querySelector('[data-coursebridge-question],.TiMu,.questionLi,.question-item,.singleQuesId,.mark_title') || /\/(work|exam|paper)\//i.test(location.pathname);
    const confirmed = reviewed(doc) || doc.body?.dataset.coursebridgeSubmitted === 'yes' || doc.body?.dataset.coursebridgeSubmitted === 'true' || doc.body?.dataset.submitted === 'yes' || [...doc.querySelectorAll('.submit-success,.work-status,.exam-status,[data-coursebridge-result]')].some(el => visible(el) && /提交成功|已提交|已交卷|测验已完成/.test(el.textContent));
    return { assessment: questionPage, confirmed, taskComplete: taskCompleted(doc) };
  }
  function taskCompleted(scope = document) {
    const doc = scope.ownerDocument || scope;
    const elements = selector => [...(scope.matches?.(selector) ? [scope] : []), ...scope.querySelectorAll(selector)];
    return elements('.ans-job-finished,[data-coursebridge-task-status="complete"]').some(visible) || elements('[data-coursebridge-task-status],.task-status,span,div,p').some(el => {
      if(!visible(el))return false;
      const label=el.textContent.replace(/[\s\u200b]/g,'');
      if(label.length>80 || !label.includes('任务点') || !label.includes('已完成'))return false;
      const walker=doc.createTreeWalker(el,4);let node,readable='';
      while((node=walker.nextNode())) {
        const parent=node.parentElement;
        if(visible(parent)&&!parent.closest('i,svg,[aria-hidden=true],.iconfont'))readable+=node.textContent;
      }
      return readable.replace(/[\s\u200b]/g,'')==='任务点已完成';
    });
  }
  function findSubmit(doc = document) {
    const checkpoint = [...doc.querySelectorAll('.tkTopic,[data-coursebridge-video-quiz]')].find(visible);
    if (checkpoint) return [...checkpoint.querySelectorAll('a.ans-videoquiz-submit:not(#videoquiz-submitting),[data-coursebridge-submit],button')].find(el => visible(el) && !el.disabled && /^(提交|提交答案)$/.test(el.textContent.trim())) || null;
    return [...doc.querySelectorAll('[data-coursebridge-submit], button, a, input[type=submit]')].find(el => /^(提交|提交答案|提交作业|提交测验|提交试卷|提交考试|交卷)$/.test(String(el.textContent || el.value || '').trim()) && visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true') || null;
  }
  function findSubmitConfirmation(doc = document) {
    const text = el => String(el.textContent || el.value || '').replace(/[\s\u200b]/g,'');
    const prompt = value => /^(?:请)?确认(?:提交|交卷)(?:作业|测验|答案|试卷|考试)?[?？。!！]?$/.test(value) || /^是否(?:确认)?(?:提交|交卷)(?:作业|测验|答案|试卷|考试)?[?？]$/.test(value);
    const controls = scope => [...scope.querySelectorAll('button,a,input[type=button],input[type=submit],[role=button]')].filter(el=>visible(el)&&!el.disabled&&el.getAttribute('aria-disabled')!=='true');
    const ownText=el=>[...el.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent).join('').replace(/[\s\u200b]/g,'');
    for(const message of [...doc.querySelectorAll('p,span,div,[role=dialog],dialog')].filter(el=>visible(el)&&el.textContent.length<80&&(prompt(text(el))||prompt(ownText(el))))) {
      let scope=message;
      for(let depth=0;scope&&scope!==doc.body&&scope!==doc.documentElement&&depth<7;depth++,scope=scope.parentElement) {
        const content=text(scope);
        if(content.length>500)break;
        if(/未(?:完成|作答|答)|缺少|删除|付款|支付|退出/.test(content))continue;
        const buttons=controls(scope);
        const submit=buttons.filter(el=>/^(?:提交|交卷|确定|确认|确认提交|确认交卷)$/.test(text(el)));
        if(submit.length===1 && buttons.some(el=>/^(?:取消|返回)$/.test(text(el))))return submit[0];
      }
    }
    return null;
  }
  function identify(doc = document) {
    const domain = location.hostname;
    if (/^(?:passport2(?:-api|-static)?|captcha|sso|login)\.chaoxing\.com$/i.test(domain) || /^\/(?:login|sso)(?:\/|$)/i.test(location.pathname)) return false;
    const isCourseHost = host => host === 'chaoxing.com' || host.endsWith('.chaoxing.com');
    if (isCourseHost(domain)) return true;
    if (/^(about:|blob:|data:)/.test(location.href)) {
      for (const origin of Array.from(location.ancestorOrigins || [])) {
        try { if (isCourseHost(new URL(origin).hostname)) return true; } catch { /* Opaque origins have no hostname. */ }
      }
      try { if (window !== window.parent && isCourseHost(window.parent.location.hostname)) return true; } catch { /* Cross-origin parent: ancestorOrigins is used above. */ }
    }
    return !!doc.querySelector('[data-coursebridge-demo], .posCatalog_select, .posCatalog_active, iframe[src*="chaoxing.com"], form[action*="chaoxing.com"]');
  }
  function mediaElements(doc = document) {
    const roots = [doc];
    const media = [];
    for (let index = 0; index < roots.length && index < 50; index++) {
      const scope = roots[index];
      media.push(...scope.querySelectorAll('video, audio'));
      for (const element of scope.querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
    }
    return [...new Set(media)];
  }
  function diagnose(doc = document) {
    const frames = [...doc.querySelectorAll('iframe, frame')];
    const origins = [];
    for (const frame of frames) {
      try { const url = new URL(frame.getAttribute('src') || 'about:blank', location.href); origins.push(url.origin === 'null' ? url.protocol : url.origin); } catch { /* Invalid source is reported only in the count. */ }
    }
    return { questionTotal: reviewed(doc) ? 0 : questionElements(doc, root.CourseBridgeExam?.includeHidden(doc) === true).length, iframeCount: frames.length, iframeOrigins: [...new Set(origins)].slice(0, 12), frameHost: location.hostname, framePath: location.protocol === 'about:' ? location.href : location.pathname };
  }
  function startPlayer(media) {
    const scope = media.closest('.video-js, .xgplayer, .prism-player, [data-coursebridge-player]') || media.parentElement;
    const button = [...(scope?.querySelectorAll('[data-coursebridge-play], .vjs-big-play-button, .prism-big-play-btn, .xgplayer-start') || [])].find(visible);
    if (button && !button.disabled) { button.click(); return true; }
    return false;
  }
  async function playWithTimeout(media, timeout = 1500) {
    let timer;
    try {
      await Promise.race([media.play(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('媒体加载超时')), timeout); })]);
      return true;
    } catch (error) { media.pause(); if (media.dataset) media.dataset.coursebridgePlayError = error.name || 'Error'; return false; }
    finally { clearTimeout(timer); }
  }
  root.CourseBridgeAdapter = { visible, questionElements, readQuestions, applyAnswers, answerApplied, resetAnswerAttempts, findNext, findSubmit, findSubmitConfirmation, identify, mediaElements, diagnose, startPlayer, playWithTimeout, navigation, nextAction, assessmentState, taskCompleted };
})(globalThis);
