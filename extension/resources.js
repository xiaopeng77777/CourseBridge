(function (root) {
  const adapter = root.CourseBridgeAdapter;
  const children = new WeakMap();
  const traversals = new WeakMap();
  let epoch = '', inheritedComplete = false, parentEpoch = '', completedChapter = false;
  const started = Date.now();
  function frames() {
    return [...document.querySelectorAll('iframe,frame')].filter(el => adapter.visible(el) && !el.closest('.posCatalog,.catalog,.ai-chat,#coursebridge-panel'));
  }
  function hasFinished(scope) {
    return adapter.taskCompleted(scope);
  }
  // A completed marker belongs only to a container with one resource. It must
  // never complete the other video/document further down the same course card.
  function completedFor(element) {
    if (completedChapter) return true;
    if (inheritedComplete && frames().length + adapter.mediaElements().filter(adapter.visible).length <= 1) return true;
    for (let scope = element.parentElement; scope; scope = scope.parentElement) {
      const resources = [...scope.querySelectorAll('iframe,frame,video,audio')].filter(adapter.visible);
      if (resources.length > 1) return false;
      if (hasFinished(scope)) return true;
    }
    return false;
  }
  function pendingFor(element) {
    if (completedFor(element)) return false;
    for (let scope = element.parentElement; scope; scope = scope.parentElement) {
      if ([...scope.querySelectorAll('iframe,frame,video,audio')].filter(adapter.visible).length > 1) return false;
      if (hasFinished(scope)) return false;
      if ([...scope.querySelectorAll('.ans-job-icon:not(.ans-job-finished),[data-coursebridge-task-status="pending"]')].some(adapter.visible)) return true;
    }
    return false;
  }
  function checkpoint() {
    return [...document.querySelectorAll('.tkTopic,[data-coursebridge-video-quiz]')].find(adapter.visible) || null;
  }
  function continueCheckpoint() {
    const scope = checkpoint();
    if (checkpointRejected()) return false;
    // Only the player's own continue control; never use next chapter/back/skip.
    const button = scope && [...scope.querySelectorAll('.ans-videoquiz-continue')].find(el => adapter.visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
    if (button) { button.click(); return true; }
    return false;
  }
  function checkpointRejected() {
    const scope = checkpoint();
    return !!scope && [...scope.querySelectorAll('#spanNot,#spanNotBack,#spanNotBackPoint,.spanNot,.spanNotBack')].some(adapter.visible);
  }
  function receive(message) {
    if (message.data?.type !== 'coursebridge:resource-report') return;
    const frame = frames().find(el => el.contentWindow === message.source);
    if (!frame || message.data.epoch !== epoch) return;
    const state = message.data.state;
    if (!state || typeof state.ready !== 'boolean') return;
    children.set(frame, { epoch, time: Date.now(), src: frame.getAttribute('src'), state });
    if (state.quiz) window.dispatchEvent(new Event('coursebridge:checkpoint-block'));
  }
  window.addEventListener('message', receive);
  function setContext(nextEpoch, complete, chapterComplete = false) {
    if (epoch !== nextEpoch) { epoch = nextEpoch; }
    inheritedComplete = complete === true;
    completedChapter = chapterComplete === true;
    parentEpoch = nextEpoch;
  }
  function contextFor(frame) { return { resourceEpoch: epoch, resourceComplete: completedFor(frame), resourceChapterComplete: completedChapter }; }
  function traverse(element, enabled) {
    const images = [...element.querySelectorAll('img')].filter(adapter.visible);
    const loaded = images.every(img => img.complete && img.naturalWidth > 0);
    const size = `${element.scrollHeight}:${element.clientHeight}:${images.length}`;
    let state = traversals.get(element);
    if (!state || state.size !== size || state.epoch !== epoch) { state = { size, epoch, bottomSince: 0 }; traversals.set(element, state); }
    if (enabled && element.scrollHeight > element.clientHeight + 4 && element.scrollTop + element.clientHeight < element.scrollHeight - 4) {
      element.scrollTop = Math.min(element.scrollHeight, element.scrollTop + Math.max(200, element.clientHeight * .85));
      state.bottomSince = 0;
      return false;
    }
    const bottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
    if (!bottom || !loaded || document.readyState !== 'complete') { state.bottomSince = 0; return false; }
    state.bottomSince ||= Date.now();
    return Date.now() - state.bottomSince >= 4000;
  }
  function documentResources(enabled) {
    const documentPage = /\/(?:screen\/|ananas\/modules\/(?:pdf|ppt|doc|document)\/)/i.test(location.pathname);
    const explicit = [...document.querySelectorAll('[data-coursebridge-document],.pdfViewer,#viewerContainer')].filter(adapter.visible);
    if (!documentPage && !explicit.length) return [];
    // Wrapper pages delegate to the real, possibly cross-origin viewer frame.
    if (frames().length && !explicit.length) return [];
    const candidates = [...new Set([...explicit, ...document.querySelectorAll('div')])].filter(el => adapter.visible(el) && el.clientHeight > 100 && el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY));
    const scrollRoots = candidates.filter(el => !candidates.some(other => other !== el && el.contains(other)));
    if (!scrollRoots.length) scrollRoots.push(document.scrollingElement);
    return scrollRoots.filter(Boolean).map(el => ({ ready: completedChapter || inheritedComplete || traverse(el, enabled), kind: 'document' }));
  }
  function state({ enabled, media, questions, stepKey, chapterComplete = false }) {
    if (window === top) setContext(stepKey, false, chapterComplete);
    const childFrames = frames();
    const quiz = !!checkpoint();
    const results = media.map(el => ({ ready: el.ended || completedFor(el), kind: 'media' }));
    results.push(...documentResources(enabled));
    for (const frame of childFrames) {
      const report = children.get(frame);
      const valid = report && report.epoch === epoch && report.src === frame.getAttribute('src') && Date.now() - report.time < 8000;
      const waitingReceipt = valid && report.state.ready && pendingFor(frame);
      results.push({ ready: !!valid && report.state.ready && !waitingReceipt, kind: 'frame', quiz: !!valid && report.state.quiz, count: valid ? report.state.count : 1, reason: waitingReceipt ? '内容已浏览，等待平台确认任务点完成' : valid ? report.state.reason : '等待课程内容页面连接' });
    }
    const reading = document.querySelector('[data-coursebridge-reading],.ans-cc,.ans-richtext');
    const card = /\/knowledge\/cards(?:$|\/)/i.test(location.pathname);
    if (!results.length && !questions.length && !quiz && (reading || card)) {
      const scope = reading || document.body;
      const meaningful = scope && (scope.textContent.trim().length > 5 || [...scope.querySelectorAll('img')].some(img => img.width > 80));
      if (meaningful) results.push({ ready: completedChapter || traverse(document.scrollingElement, enabled), kind: 'reading' });
    }
    const count = results.reduce((sum, item) => sum + (item.count || 1), 0);
    const blocked = quiz || results.some(item => item.quiz);
    const ready = Date.now() - started >= 4000 && (completedChapter || (count > 0 && results.every(item => item.ready))) && !blocked && !questions.length;
    const docs = results.filter(item => item.kind === 'document');
    const childReason = results.find(item => !item.ready && item.reason)?.reason;
    const unfinishedMedia = media.filter(el => !el.ended && !completedFor(el));
    const mediaReason = unfinishedMedia.some(el => el.error) ? '媒体加载失败，请确认网页中能正常播放' : unfinishedMedia.some(el => el.paused && el.dataset.coursebridgePlayError === 'NotAllowedError') ? '浏览器限制自动播放，请点击一次播放' : unfinishedMedia.length ? `正在处理视频，剩余 ${unfinishedMedia.length} 个媒体资源` : '';
    const reason = blocked ? '视频中途弹题，等待作答并通过后继续播放' : completedChapter ? '本课时已完成，准备进入下一节' : docs.some(item => !item.ready) ? '正在逐页浏览课件，等待末页加载完成' : childReason || mediaReason || (results.some(item => item.kind === 'frame' && !item.ready) ? '正在处理本课时内容，等待全部资源完成' : '');
    const result = { ready, count, quiz: blocked, reason };
    if (window !== top) window.parent.postMessage({ type: 'coursebridge:resource-report', epoch: parentEpoch, state: result }, '*');
    return result;
  }
  function blocked() { return !!checkpoint() || frames().some(frame => children.get(frame)?.state.quiz); }
  root.CourseBridgeResources = { state, setContext, contextFor, checkpoint, checkpointRejected, continueCheckpoint, completedFor, blocked };
})(globalThis);
