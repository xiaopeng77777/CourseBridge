(function () {
  const adapter = globalThis.CourseBridgeAdapter;
  const resources = globalThis.CourseBridgeResources;
  const exams = globalThis.CourseBridgeExam;
  if (!adapter.identify()) return;
  let settings = { ...CourseBridgeRules.defaults };
  let busy = false;
  let revision = null;
  let status = '等待连接';
  let pendingNext;
  let lastNext = 0;
  let completeSince = 0;
  let submitted = false;
  let questionsReady = false;
  let filled = 0;
  let submitState = '';
  let questionSet = '';
  let previouslyFilled = new Set();
  let examSettled = '';
  let examMoved = '';
  let lastTaskEnabled = false;
  const viewKey = list => JSON.stringify(list.map(q => [q.id, q.title, q.options, q.type, q.blankCount]));
  let event = '';
  let currentStep = '';
  let frameVisible = window === top;
  let diagnosticOnly = new URL(location.href).searchParams.get('__cb_diagnostic') === '1';
  const visibilityNonce = crypto.randomUUID();
  window.addEventListener('message', message => {
    if (message.data?.type === 'coursebridge:visibility-probe') {
      const frame = [...document.querySelectorAll('iframe,frame')].find(el => el.contentWindow === message.source);
      if (frame) message.source.postMessage({ type: 'coursebridge:visibility-result', nonce: message.data.nonce, visible: frameVisible && adapter.visible(frame), diagnosticOnly, ...resources.contextFor(frame) }, '*');
    } else if (message.source === window.parent && message.data?.type === 'coursebridge:visibility-result' && message.data.nonce === visibilityNonce) {frameVisible = message.data.visible === true;diagnosticOnly = message.data.diagnosticOnly === true;resources.setContext(message.data.resourceEpoch, message.data.resourceComplete, message.data.resourceChapterComplete);}
  });
  const ownedMedia = new WeakSet();
  const submittedSignatures = new Set();
  let confirmedButtons = new WeakSet();
  let taskFinished = false;
  let hadVideoQuiz = false;
  let badge;
  if (window === top) {
    const host = document.createElement('div');
    host.id = 'coursebridge-panel';
    host.style.cssText = 'position:fixed;right:22px;bottom:22px;z-index:2147483646';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<style>:host{all:initial}button{font:12px/1.6 system-ui;color:#566bbc;background:#fff;border:1px solid #dfe4f4;border-radius:10px;padding:10px 15px;box-shadow:0 4px 20px #23345b17;cursor:pointer;max-width:320px;text-align:left}button:focus-visible{outline:3px solid #b5bef8;outline-offset:3px}small{display:block;color:#8c98b2;margin-top:4px}</style><button>课桥 · 0.1.23<small>等待连接桌面端</small></button>';
    badge = shadow.querySelector('small');
    shadow.querySelector('button').onclick = () => {
      chrome.runtime.sendMessage({ type: 'sync', action: settings.enabled ? 'pause' : 'start', state: { title: document.title } }, result => {
        if (chrome.runtime.lastError) return;
        if (result?.settings) settings = result.settings;
      });
    };
    document.documentElement.append(host);
  }
  function mediaState() {
    const media = frameVisible ? adapter.mediaElements().filter(adapter.visible) : [];
    const complete = media.length > 0 && media.every(el => el.ended || resources.completedFor(el));
    return { media, complete };
  }
  function cancelNext() { clearTimeout(pendingNext); pendingNext = undefined; completeSince = 0; }
  function next(manual = false) {
    if (window !== top || Date.now() - lastNext < 2500) return;
    if (!manual && resources.blocked()) { cancelNext(); return; }
    const action = adapter.nextAction();
    const target = action.element;
    if (!target) { taskFinished = action.type === 'finished'; status = taskFinished ? '已到课程目录末尾，仍有测验可留待处理' : action.type === 'locked' ? '下一课时尚未解锁，请先完成前置任务' : '未找到下一课时入口，请检查右侧目录'; event = status; return; }
    if (submitted || manual) {
      lastNext = Date.now(); cancelNext(); target.scrollIntoView({ block: 'nearest' }); target.click();
      status = action.type === 'tab' ? '已切换至下一内容页' : '已切换至下一课时'; event = status; submitted = false;
    }
  }
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      if (window !== top) window.parent.postMessage({ type: 'coursebridge:visibility-probe', nonce: visibilityNonce }, '*');
      const { media, complete } = mediaState();
      const diagnostic = adapter.diagnose();
      const nav = adapter.navigation();
      const assessment = adapter.assessmentState();
      if (window === top && currentStep !== nav.key) { currentStep = nav.key; cancelNext(); confirmedButtons = new WeakSet(); taskFinished = false; }
      if (frameVisible) await CourseBridgeFont.prepare();
      const questions = frameVisible ? adapter.readQuestions() : [];
      globalThis.CourseBridgeText?.setContext({ active: settings.enabled && settings.autoAnswer && frameVisible && !diagnosticOnly && !exams?.info()?.preview, questions });
      const examPage = exams?.info() || { exam: false };
      let activeQuestions = examPage.exam ? questions.filter(q => adapter.visible(q.element)) : questions;
      const activeKey = viewKey(activeQuestions);
      const questionSignature = JSON.stringify(questions.map(q => ({ title: q.title, options: q.options, type: q.type, blankCount: q.blankCount, elementId: q.element.id })));
      if (questionSet !== questionSignature) {
        questionSet = questionSignature; filled = 0; submitState = ''; previouslyFilled.clear();
        examSettled = ''; examMoved = ''; taskFinished = false; confirmedButtons = new WeakSet(); cancelNext();
      }
      const resource = resources.state({ enabled: settings.enabled && frameVisible && !diagnosticOnly && settings.autoNext, media, questions, stepKey: nav.key, chapterComplete: nav.completed });
      const videoQuiz = !!resources.checkpoint();
      if (hadVideoQuiz && !videoQuiz) for (const signature of submittedSignatures) if (signature.includes(':checkpoint:')) submittedSignatures.delete(signature);
      hadVideoQuiz = videoQuiz;
      const reportedStatus = status + (questions.some(q=>q.encoded) ? '；字体检查：' + CourseBridgeFont.status() : '');
      const message = { type: 'sync', state: { ...diagnostic, ...assessment, paperMode: examPage.preview ? 'preview' : examPage.exam ? 'exam' : '', paperQuestions: questions.length, resourceProtocol: 2, resourceReady: resource.ready, resourceCount: resource.count, resourceReason: resource.reason, videoQuiz, checkpointRejected: resources.checkpointRejected(), resourceQuiz: resource.quiz, filled, submitState, taskFinished, visible: frameVisible, stepKind: nav.kind, stepKey: nav.key, extensionVersion: chrome.runtime.getManifest().version, title: document.title, chapter: document.querySelector('.posCatalog_active, [data-current-chapter]')?.textContent?.trim() || '', status:reportedStatus, media: media.length, complete, questions: questions.length, questionsReady: assessment.confirmed, event }, questions: questions.map(({ id, title, options, multiple, encoded, type, blankCount, minLength, editorReady }) => ({ id, title, options, multiple, encoded, type, blankCount, minLength, editorReady })) };
      let response;
      Object.assign(message.state, globalThis.CourseBridgeText?.progress(questions));
      if (questions.length > 30) {
        const answers = [];
        // Keep each request within the existing desktop protocol's bounded batch size.
        for (let offset = 0; offset < message.questions.length; offset += 30) {
          const batch = message.questions.slice(offset, offset + 30);
          const unsupported = offset + 30 >= questions.length ? Math.max(0, diagnostic.questionTotal - questions.length) : 0;
          response = await chrome.runtime.sendMessage({ ...message, questions: batch, state: { ...message.state, questions: batch.length, questionTotal: batch.length + unsupported, filled: batch.filter(q => previouslyFilled.has(q.id)).length, event: offset ? '' : message.state.event } });
          if (response?.error || !response?.settings?.enabled) break;
          answers.push(...(response.answers || []));
        }
        if (response && !response.error) response.answers = answers;
      } else response = await chrome.runtime.sendMessage(message);
      event = '';
      if (response?.error) {
        cancelNext(); settings.enabled = false;
        for (const element of media) if (ownedMedia.has(element)) element.pause();
        status = response.error;
        return;
      }
      settings = response.settings;
      if (settings.enabled && !lastTaskEnabled) adapter.resetAnswerAttempts?.();
      lastTaskEnabled = settings.enabled;
      globalThis.CourseBridgeText?.setContext({ active: settings.enabled && settings.autoAnswer && frameVisible && !diagnosticOnly && !examPage.preview, questions });
      // A lookup can finish after the user or the website has changed questions.
      // Never apply a response against a different or detached view.
      if (examPage.exam) {
        const fresh = adapter.readQuestions().filter(q => adapter.visible(q.element));
        if (activeKey !== viewKey(fresh) || activeQuestions.some(q => !q.element.isConnected) || fresh.some((q, i) => q.element !== activeQuestions[i]?.element)) {
          examSettled = ''; status = '题目已切换，正在同步当前题目'; return;
        }
        activeQuestions = fresh;
      }
      if (diagnosticOnly) {settings={...settings,enabled:false};if(window===top && nav.kind!=='assessment'){const quiz=nav.tabs.find(el=>/章节测验/.test(el.textContent));if(quiz)quiz.click();}}
      if (!frameVisible) {
        cancelNext();
        for (const element of adapter.mediaElements()) if (ownedMedia.has(element) || (settings.enabled && settings.autoNext)) element.pause();
        status = '非当前内容页，已暂停';
        return;
      }
      if (revision === null) revision = response.command.revision;
      else if (revision !== response.command.revision) { revision = response.command.revision; if (response.command.action === 'next') next(true); }
      if (!settings.enabled) {
        cancelNext();
        for (const element of media) if (ownedMedia.has(element)) element.pause();
        status = '已连接 · 已暂停';
        return;
      }
      if (examPage.preview) {
        cancelNext(); filled = 0; submitState = ''; previouslyFilled.clear();
        const answers = response.answers || [], matched = answers.filter(answer => answer.status === 'matched').length;
        const pending = answers.filter(answer => answer.status === 'pending').length;
        status = `整卷预览已读取 ${questions.length} 题，已匹配 ${matched}/${questions.length}${pending ? `，${pending} 题正在查询` : ''}；请返回逐题作答页自动填写`;
        return;
      }
      status = media.length ? (complete ? '当前媒体播放结束' : '正在播放课程') : (questions.length ? `识别到 ${questions.length} 道题目` : diagnostic.iframeCount ? '课程主页面已连接，等待内嵌播放器' : '当前页面未发现音视频或题目，请进入具体课时');
      let playbackIssue = '';
      const skipFinishedVideo = settings.autoNext && complete;
      const nextMedia = media.find(element => !element.ended && !resources.completedFor(element));
      for (const element of media) {
        if(skipFinishedVideo || videoQuiz || response.videoQuizBlocked || response.playMedia === false || element !== nextMedia){element.pause();continue;}
        if (element.ended) continue;
        element.muted = settings.muted;
        try { element.playbackRate = settings.playbackRate; }
        catch { playbackIssue = `播放器不支持 ${settings.playbackRate} 倍速，请在任务设置中降低速度`; continue; }
        if (element.paused) {
          if (!element.currentSrc && !element.src && !element.querySelector('source[src]')) adapter.startPlayer(element);
          if (!element.currentSrc && !element.src && !element.querySelector('source[src]')) { status = '已识别播放器，等待课程媒体资源'; continue; }
          if (await adapter.playWithTimeout(element)) ownedMedia.add(element);
          else playbackIssue = element.error ? '媒体加载失败，请先确认网页中能手动播放' : element.dataset.coursebridgePlayError === 'NotAllowedError' ? '浏览器限制自动播放，请先手动点击一次播放' : '播放器尚未开始播放，请手动播放后重试';
        }
      }
      if (playbackIssue) status = playbackIssue;
      if(skipFinishedVideo)status='视频任务点已完成，正在进入下一内容页';
      let answered = questions.length === 0;
      let examStatus = '';
      let examCanConfirm = false;
      filled = 0;
      submitState = '';
      questionsReady = assessment.confirmed;
      if (questions.length && settings.autoAnswer && !(examPage.exam && assessment.confirmed)) {
        const writable = examPage.exam ? activeQuestions : questions;
        // Batch lookup is independent from page writes: hidden questions may share controls.
        const isolated = !examPage.exam || writable.length === 1 || exams.independent(writable);
        filled = isolated ? adapter.applyAnswers(response.answers || [], writable) : 0;
        previouslyFilled = new Set(writable.filter(q => {
          const answer = (response.answers || []).find(a => a.id === q.id);
          return adapter.answerApplied(q, answer);
        }).map(q => q.id));
        answered = writable.length > 0 && filled === writable.length && (examPage.exam || diagnostic.questionTotal === questions.length);
        status = `题库匹配 ${filled}/${questions.length}`;
        const signature = JSON.stringify(questions.map(q => ({ title: q.title, options: q.options })));
        const submissionKey = `${currentStep}:${videoQuiz ? 'checkpoint:' : ''}${signature}`;
        if (examPage.exam) {
          if (isolated) exams.remember(writable, response.answers || []);
          const coverage = exams.covered(questions, examPage);
          const prefix = `${examPage.bulk ? `已批量读取 ${questions.length} 道；` : ''}当前页已填写 ${filled}/${writable.length}；本次已验证 ${coverage}/${examPage.total || '?'} 道`;
          examStatus = prefix;
          const currentAnswers = (response.answers || []).filter(a => writable.some(q => q.id === a.id));
          const missing = currentAnswers.filter(a => !['matched', 'pending'].includes(a.status));
          const pending = currentAnswers.filter(a => a.status === 'pending');
          if (!isolated) examStatus += '；题目共用控件，请切回逐题作答，已停止填写以避免覆盖';
          else if (!answered && writable.some(q => q.fillIssue)) examStatus += '；' + writable.find(q => q.fillIssue).fillIssue;
          else if (!answered) examStatus += pending.length ? `；正在查找 ${pending.length} 道，等待结果` : `；${missing.length || diagnostic.questionTotal - filled} 道缺答案或暂不支持，等待补充${missing.find(a => a.detail)?.detail ? '；' + missing.find(a => a.detail).detail : ''}`;
          else if (examSettled !== activeKey) { examSettled = activeKey; examStatus += '；正在等待页面保存答案'; }
          else {
            const submit = adapter.findSubmit();
            const fullyCovered = exams.canSubmit(questions, examPage);
            const move = examPage.next || (fullyCovered && !submit && settings.autoSubmit ? examPage.nextStep : null);
            const moveKey = `${activeKey}:${examPage.current || ''}`;
            if (move) {
              if (!settings.autoNext) examStatus += '；自动下一步未开启';
              else if (examMoved !== moveKey) {
                examMoved = moveKey; if (move === examPage.nextStep && fullyCovered && settings.autoSubmit) { submittedSignatures.add(submissionKey); submitState = 'clicked'; } move.click();
                examStatus += '；已填写，正在切换下一题';
                event = examStatus;
              } else examStatus += '；已请求切换，等待页面加载，请勿重复点击';
            } else if (!fullyCovered) examStatus += '；尚未验证整份试卷，不自动交卷';
            else if (!settings.autoSubmit) examStatus += '；已到最后一题，等待你交卷';
            else if (!submit) examStatus += '；整卷已填写，未找到交卷入口';
            else if (!submittedSignatures.has(submissionKey)) {
              submittedSignatures.add(submissionKey); submit.click(); submitState = 'clicked';
              examStatus += '；已点击交卷，等待确认'; event = '整份试卷均已匹配并填写，已点击交卷';
            } else { submitState = 'waiting'; examStatus += '；等待交卷确认'; }
            examCanConfirm = fullyCovered && settings.autoSubmit && submittedSignatures.has(submissionKey);
          }
        } else if (answered && settings.autoSubmit && !submittedSignatures.has(submissionKey)) {
          const submit = adapter.findSubmit();
          if (submit) { submittedSignatures.add(submissionKey); submit.click(); submitState = 'clicked'; event = '已点击提交全部匹配的题目'; }
          else submitState = 'not-found';
        }
        else if (!examPage.exam && answered && settings.autoSubmit) submitState = 'waiting';
        questionsReady = adapter.assessmentState().confirmed;
      }
      if (videoQuiz && answered && filled > 0 && settings.autoAnswer && settings.autoSubmit) resources.continueCheckpoint();
      if(examPage.exam ? examCanConfirm : response.canConfirmSubmit) {
        const confirmation=adapter.findSubmitConfirmation();
        if(confirmation && !confirmedButtons.has(confirmation)) {
          confirmedButtons.add(confirmation);confirmation.click();
          event='已自动确认提交全部匹配并填写的题目';status='已确认提交，等待网页返回结果';
        }
      }
      submitted = true;
      if (examPage.exam) {
        cancelNext();
        taskFinished = adapter.assessmentState().confirmed;
        status = taskFinished ? '试卷已提交，等待你查看结果' : examStatus || (settings.autoAnswer ? '考试页面正在识别题目，请稍候' : '自动填写未开启，等待你作答');
        return;
      }
      if (window === top && settings.autoNext && response.advance) {
        completeSince ||= Date.now();
        const fast = response.mediaTaskComplete && nav.kind==='media';
        if (!pendingNext && Date.now() - completeSince >= (fast ? 0 : 4000)) {
          const delay=fast?1:settings.nextDelay;
          status = fast ? '视频任务点已完成，正在进入章节后续内容' : `${delay} 秒后进入下一内容页或课时`;
          pendingNext = setTimeout(() => { pendingNext = undefined; if (settings.enabled && settings.autoNext) next(); }, delay * 1000);
        }
      } else { cancelNext(); if (response.waitReason) status = response.waitReason; }
    } catch {
      cancelNext(); settings.enabled = false;
      for (const element of mediaState().media) if (ownedMedia.has(element)) element.pause();
      status = '连接中断，请检查桌面端';
    } finally { if (badge) badge.textContent = status; busy = false; }
  }
  window.addEventListener('pagehide', () => { cancelNext(); globalThis.CourseBridgeText?.reset(); });
  window.addEventListener('coursebridge:checkpoint-block', cancelNext);
  setInterval(tick, 2000);
  tick();
})();
