const status = document.querySelector('#status');
const token = document.querySelector('#token');
chrome.storage.local.get(['token']).then(saved => { token.value = saved.token || ''; });
async function send(action) {
  const response = await chrome.runtime.sendMessage({ type: 'sync', action, state: { title: '插件控制面板', status: '已配对' } });
  status.textContent = response.error || `已连接桌面端 · ${response.settings.enabled ? '任务运行中' : '任务已暂停'}`;
}
document.querySelector('#pair').onclick = async () => {
  if (!/^[a-f0-9]{32}$/.test(token.value.trim())) { status.textContent = '请粘贴完整的桌面端配对码'; return; }
  await chrome.storage.local.set({ token: token.value.trim() });
  try { await send(); } catch { status.textContent = '连接失败，请先打开桌面端'; }
};
for (const action of ['start', 'pause']) document.getElementById(action).onclick = () => send(action).catch(() => { status.textContent = '桌面端未连接'; });
send().catch(() => { status.textContent = '请先打开桌面端并完成配对'; });
