(function (root) {
  function summarizeSessions(frames, enabled) {
    const groups = new Map();
    for (const frame of frames) {
      if (frame.visible === false) continue;
      if (!groups.has(frame.tabKey)) groups.set(frame.tabKey, []);
      groups.get(frame.tabKey).push(frame);
    }
    return [...groups.values()].map(group => {
      const main = group.find(frame => frame.frameId === 0) || group[0];
      const useful = group.filter(frame => frame.media > 0 || frame.questions > 0);
      const score = frame => (/请先|超时|加载|失败|等待.*资源/.test(frame.status) ? 100 : 0) + (frame.questions > 0 ? 20 : 0) + (frame.media > 0 ? 10 : 0);
      const active = [...useful].sort((a, b) => score(b) - score(a))[0];
      const media = group.reduce((sum, frame) => sum + (Number(frame.media) || 0), 0);
      const questions = group.reduce((sum, frame) => sum + (Number(frame.questions) || 0), 0);
      const legacy = group.some(frame => !frame.extensionVersion || ['0.1.0', '0.1.1', '0.1.2', '0.1.3'].includes(frame.extensionVersion));
      let status = enabled ? (/秒后|已切换|未找到下一|测验留待|等待测验|题库匹配|未识别到|已填写|保留测验|字体尚未|尚未解锁|目录末尾|视频弹题|浏览课件|全部资源|本课时|课程内容页面连接/.test(main.status) ? main.status : active?.status || main.status) : '已连接 · 已暂停';
      let detail = `已连接 ${group.length} 个内容页面 · 发现 ${media} 个媒体、${questions} 道题目`;
      if (legacy) detail += ' · 请在扩展管理中重新加载课桥插件';
      else if (enabled && !active && main.iframeCount && group.length === 1) status = '播放器内容页面尚未连接，请刷新课程页并检查插件站点权限';
      return { tabKey: main.tabKey, title: main.title, chapter: main.chapter || active?.chapter || '', status, detail, media, questions, assessment: group.some(f => f.assessment || f.stepKind === 'assessment'), connectedFrames: group.length, legacy };
    });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { summarizeSessions };
  else root.CourseBridgeSessions = { summarizeSessions };
})(globalThis);
