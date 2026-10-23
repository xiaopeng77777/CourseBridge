const UNANSWERED_WAIT = 15000;
function assessmentProgress(frames, settings, elapsed) {
  const totals = { total: 0, matched: 0, missing: 0, conflict: 0, ambiguous: 0, encoded: 0, pending: 0, unsupported: 0, filled: 0 };
  for (const frame of frames) for (const key of Object.keys(totals)) totals[key] += frame.matchSummary?.[key] || 0;
  const { total, matched, missing, conflict, ambiguous, encoded, pending, unsupported, filled } = totals;
  let reason = '', unresolved = false;
  if (!settings.autoAnswer) return { ready: settings.skipUnanswered, reason: settings.skipUnanswered ? '测验留待处理，准备进入下一课时' : '自动填写未开启，等待你完成测验', totals };
  if (frames.some(frame => frame.textInputPending)) return { ready: false, reason: frames.find(frame => frame.textInputPending).textInputReason || '正在输入正文，等待输入并核对保存完成', totals };
  if (pending) return { ready: false, reason: `题库匹配 ${matched}/${total}；${frames.some(f => f.pendingSource === 'deepseek') ? 'DeepSeek 正在分析' : '言溪正在查找'} ${pending} 道题目，查询完成后继续`, totals };
  if (!total) { reason = '测验页已连接，但未识别到可填写题目'; unresolved = true; }
  else if (missing || conflict || ambiguous || encoded || unsupported) {
    const parts = [`题库匹配 ${matched}/${total}`];
    if (missing) parts.push(`${missing} 道未找到答案${settings.useOfflineBank ? '' : '（离线库未开启）'}`);
    if (conflict) parts.push(`${conflict} 道答案冲突`);
    if (ambiguous) parts.push(`${ambiguous} 道选项无法确认`);
    if (encoded) parts.push(`${encoded} 道题目字体尚未还原`);
    if (unsupported) parts.push(`${unsupported} 道题型暂不支持`);
    const remoteIssue = frames.find(frame => frame.remoteIssue)?.remoteIssue;
    if (remoteIssue) parts.push(remoteIssue);
    reason = parts.join('；'); unresolved = true;
  } else if (filled < matched) {
    reason = `题库匹配 ${matched}/${total}，已填写 ${filled}/${total}；${frames.find(frame => frame.textInputReason)?.textInputReason || '正在检查填写状态'}`;
    unresolved = elapsed >= 30000;
  } else if (!settings.autoSubmit) reason = `已填写 ${filled}/${total}，自动提交未开启，等待你提交`;
  else if (frames.some(f => f.submitState === 'not-found')) { reason = `已填写 ${filled}/${total}，未找到提交按钮`; unresolved = elapsed >= 30000; }
  else { reason = `已填写 ${filled}/${total}，正在处理提交确认，等待网页确认提交成功`; unresolved = elapsed >= 60000; }
  if (unresolved && settings.skipUnanswered) {
    const left = Math.max(0, Math.ceil((UNANSWERED_WAIT - elapsed) / 1000));
    return { ready: left === 0, skipped: left === 0, reason: `${reason}；${left ? `${left} 秒后保留测验并继续` : '已保留测验，准备下一课时'}`, totals };
  }
  return { ready: false, reason: reason + (unresolved ? '；已设置等待处理' : ''), totals };
}
module.exports = { assessmentProgress, UNANSWERED_WAIT };
