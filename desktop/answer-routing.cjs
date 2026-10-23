const MODES = { local: [], enncy: ['enncy'], deepseek: ['deepseek'], 'enncy-deepseek': ['enncy', 'deepseek'] };
function onlineChain(mode) { return MODES[mode] || MODES['enncy-deepseek']; }
function resolveOnline(question, { mode, providers, canRequest }) {
  let last = null;
  const tried = [];
  for (const name of onlineChain(mode)) {
    const value = providers[name].resolve(question, canRequest);
    if (!value) { if (canRequest) tried.push(`${name === 'deepseek' ? 'DeepSeek' : '言溪'}未配置或未启用`); continue; }
    if (value.status === 'matched') return value;
    if (value.status === 'pending') return { ...value, detail: `${name === 'deepseek' ? 'DeepSeek' : '言溪'}正在查题`, pendingSource: name };
    if (value.detail) tried.push(value.detail);
    last = value;
  }
  return last ? { ...last, detail: tried.join('；').slice(0, 400) } : tried.length ? { status: 'missing', indices: [], detail: tried.join('；') } : null;
}
module.exports = { onlineChain, resolveOnline };
