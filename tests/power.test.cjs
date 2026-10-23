const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPowerKeeper } = require('../desktop/power.cjs');
function fixture(t) {
  const monitor = new EventEmitter(); let battery = false, nextId = 0;
  const active = new Set(), starts = [], stops = [];
  monitor.isOnBatteryPower = () => battery;
  const state = { settings: { enabled: true, keepAwake: true }, frames: [{ frameId: 0, visible: true }] };
  const blocker = { start(type) { starts.push(type); active.add(nextId); return nextId++; }, stop(id) { stops.push(id); return active.delete(id); } };
  const keeper = createPowerKeeper({ powerMonitor: monitor, powerSaveBlocker: blocker, getState: () => state, intervalMs: 3600000 });
  t.after(() => keeper.dispose());
  return { keeper, monitor, state, blocker, starts, stops, active, battery(value) { battery=value; monitor.emit(value ? 'on-battery' : 'on-ac'); } };
}
test('插电运行只阻止系统自动睡眠，不请求保持屏幕点亮；重复刷新不重复申请', t => {
  const f=fixture(t); assert.equal(f.keeper.snapshot().active,true);
  for(let i=0;i<5;i++)f.keeper.refresh();
  assert.deepEqual(f.starts,['prevent-app-suspension']); assert.deepEqual([...f.active],[0]);
});
test('拔电立即解除，插回电源仅在任务仍运行时恢复', t => {
  const f=fixture(t); f.battery(true); assert.equal(f.keeper.snapshot().reason,'battery'); assert.equal(f.active.size,0);
  f.battery(false); assert.equal(f.keeper.snapshot().active,true);
  f.state.settings.enabled=false; f.battery(true); f.battery(false); assert.equal(f.active.size,0);
});
test('暂停、关闭开关、断连、目录末尾均解除；另一个页面仍运行时保持', t => {
  const f=fixture(t);
  for(const reason of ['paused','disabled','disconnected','finished']) {
    f.state.settings={enabled:true,keepAwake:true};f.state.frames=[{frameId:0}];f.keeper.refresh();
    if(reason==='paused')f.state.settings.enabled=false;
    if(reason==='disabled')f.state.settings.keepAwake=false;
    if(reason==='disconnected')f.state.frames=[];
    if(reason==='finished')f.state.frames[0].taskFinished=true;
    assert.equal(f.keeper.refresh().reason,reason);assert.equal(f.active.size,0);
  }
  f.state.frames.push({frameId:0,taskFinished:false});assert.equal(f.keeper.refresh().active,true);
});
test('退出释放编号 0 的请求、移除电源监听；退出后不重新申请', t => {
  const f=fixture(t);f.keeper.dispose();f.keeper.dispose();f.monitor.emit('on-ac');f.keeper.refresh();
  assert.equal(f.active.size,0);assert.deepEqual(f.stops,[0]);assert.equal(f.monitor.listenerCount('on-ac'),0);assert.equal(f.starts.length,1);
});
test('无法读取电源或系统拒绝请求时不遗留保持唤醒状态', t => {
  const f=fixture(t);f.monitor.isOnBatteryPower=()=>{throw new Error('unavailable');};
  assert.equal(f.keeper.refresh().reason,'error');assert.equal(f.active.size,0);
  f.monitor.isOnBatteryPower=()=>false;f.blocker.start=()=>{throw new Error('rejected');};
  assert.equal(f.keeper.refresh().active,false);
});
