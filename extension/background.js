const BASE = 'http://127.0.0.1:17328';
const clientReady = (async () => {
  const saved = await chrome.storage.local.get(['clientId']);
  if (saved.clientId) return saved.clientId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ clientId: id });
  return id;
})();
async function sync(message, sender) {
  const saved = await chrome.storage.local.get(['token']);
  if (!saved.token) return { error: '请先在插件中粘贴桌面端配对码' };
  const clientId = await clientReady;
  const tabId = sender.tab?.id ?? -1;
  const frameId = sender.frameId ?? 0;
  const response = await fetch(`${BASE}/v1/${message.type === 'decode-font' ? 'font' : message.type === 'text-input' ? 'type' : 'sync'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${saved.token}` },
    body: JSON.stringify({ clientId, tabId, frameId, state: message.state, questions: message.questions, action: message.action, font: message.font, ...(message.type === 'text-input' ? { typing: message.typing, url: sender.url } : {}) }),
    signal: AbortSignal.timeout(3500)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '连接失败');
  await chrome.storage.local.set({ connection: { connected: true, time: Date.now() } });
  return result;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['sync','decode-font','text-input'].includes(message?.type)) return;
  sync(message, sender).then(respond).catch(async error => {
    const text = error.message === 'Failed to fetch' ? '桌面端未运行，或连接暂时中断' : error.message;
    await chrome.storage.local.set({ connection: { connected: false, time: Date.now(), error: text } });
    respond({ error: text });
  });
  return true;
});
globalThis.CourseBridgeTextProtocol = 1;
