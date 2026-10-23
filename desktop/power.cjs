// Keep only active, plugged-in course tasks awake. Never keep the display on.
function createPowerKeeper({ powerMonitor, powerSaveBlocker, getState, intervalMs = 1000 }) {
  let id = null, disposed = false;
  let state = { active: false, reason: 'paused', message: '任务已暂停，使用系统睡眠设置' };
  function refresh(batteryOverride) {
    if (disposed) return state;
    const current = getState();
    const settings = current.settings || {};
    const frames = (current.frames || []).filter(frame => frame.visible !== false);
    const mains = frames.filter(frame => frame.frameId === 0);
    const finished = mains.length > 0 && mains.every(frame => frame.taskFinished === true);
    let reason = !settings.keepAwake ? 'disabled' : !settings.enabled ? 'paused' : !frames.length ? 'disconnected' : finished ? 'finished' : 'active';
    try {
      const battery = typeof batteryOverride === 'boolean' ? batteryOverride : powerMonitor.isOnBatteryPower();
      if (reason === 'active' && battery) reason = 'battery';
      if (reason === 'active') {
        if (id === null) id = powerSaveBlocker.start('prevent-app-suspension');
      } else if (id !== null) { powerSaveBlocker.stop(id); id = null; }
    } catch {
      if (id !== null) { try { powerSaveBlocker.stop(id); } catch {} id = null; }
      reason = 'error';
    }
    const messages = {
      active: '防睡眠已生效 · 允许屏幕按系统设置熄灭',
      disabled: '防睡眠已关闭，使用系统睡眠设置',
      paused: '任务已暂停，使用系统睡眠设置',
      disconnected: '等待课程连接，暂不阻止睡眠',
      finished: '已到课程末尾，防睡眠已解除',
      battery: '正在使用电池，防睡眠已解除',
      error: '暂时无法启用防睡眠，请检查系统电源状态'
    };
    state = { active: id !== null, reason, message: messages[reason] };
    return state;
  }
  const onAC = () => refresh(false), onBattery = () => refresh(true), onResume = () => refresh();
  powerMonitor.on('on-ac', onAC); powerMonitor.on('on-battery', onBattery); powerMonitor.on('resume', onResume);
  const timer = setInterval(refresh, intervalMs); timer.unref?.(); refresh();
  return {
    refresh,
    snapshot: () => ({ ...state }),
    dispose() {
      if (disposed) return;
      disposed = true; clearInterval(timer);
      powerMonitor.removeListener('on-ac', onAC); powerMonitor.removeListener('on-battery', onBattery); powerMonitor.removeListener('resume', onResume);
      if (id !== null) { try { powerSaveBlocker.stop(id); } catch {} id = null; }
      state = { active: false, reason: 'closed', message: '防睡眠已解除' };
    }
  };
}
module.exports = { createPowerKeeper };
