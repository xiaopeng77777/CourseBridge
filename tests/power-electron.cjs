const { _electron: electron }=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
(async()=>{
 const work=path.join(root,'work/power-electron');fs.mkdirSync(work,{recursive:true});
 const data=fs.mkdtempSync(path.join(work,'data-'));
 const env={...process.env,COURSEBRIDGE_TEST:'1',COURSEBRIDGE_DATA_DIR:data};delete env.ELECTRON_RUN_AS_NODE;
 const application=await electron.launch({executablePath:process.env.COURSEBRIDGE_TEST_EXE||path.join(process.env.CB_PROJECT_ROOT||root,'node_modules/electron/dist/electron.exe'),args:process.env.COURSEBRIDGE_TEST_EXE?[]:[root],env});
 let timer;
 try {
  const page=await application.firstWindow();await page.waitForSelector('#keepAwake',{state:'attached'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const initial=await page.evaluate(()=>coursebridge.snapshot());assert.equal(initial.settings.keepAwake,true);assert.equal(initial.power.active,false);
  const hardwareBattery=await application.evaluate(({powerMonitor})=>powerMonitor.isOnBatteryPower());
  await application.evaluate(({powerMonitor,powerSaveBlocker})=>{
   globalThis.powerCalls=[];const start=powerSaveBlocker.start.bind(powerSaveBlocker);
   powerSaveBlocker.start=type=>{const id=start(type);globalThis.powerCalls.push({type,id});return id;};
   powerMonitor.isOnBatteryPower=()=>false;
  });
  await page.click('[data-page=settings]');await page.uncheck('#keepAwake');await page.click('#save-settings');assert.equal((await page.evaluate(()=>coursebridge.snapshot())).settings.keepAwake,false);
  await page.check('#keepAwake');await page.click('#save-settings');
  let finished=false;
  const sync=()=>fetch('http://127.0.0.1:17328/v1/sync',{method:'POST',headers:{Authorization:`Bearer ${initial.token}`,'Content-Type':'application/json'},body:JSON.stringify({clientId:'power-integration',tabId:1,frameId:0,state:{title:'防睡眠验证',stepKind:'media',taskFinished:finished}})});
  await sync();timer=setInterval(()=>sync().catch(()=>{}),1500);
  await page.evaluate(()=>coursebridge.control('start'));
  await page.waitForFunction(async()=> (await coursebridge.snapshot()).power.active);
  const request=await application.evaluate(({powerSaveBlocker})=>({calls:globalThis.powerCalls,started:powerSaveBlocker.isStarted(globalThis.powerCalls.at(-1).id)}));assert.equal(request.started,true);assert.equal(request.calls.at(-1).type,'prevent-app-suspension');
  await application.evaluate(({powerMonitor})=>{powerMonitor.isOnBatteryPower=()=>true;powerMonitor.emit('on-battery');});assert.equal((await page.evaluate(()=>coursebridge.snapshot())).power.reason,'battery');
  await application.evaluate(({powerMonitor})=>{powerMonitor.isOnBatteryPower=()=>false;powerMonitor.emit('on-ac');});assert.equal((await page.evaluate(()=>coursebridge.snapshot())).power.active,true);
  finished=true;await sync();assert.equal((await page.evaluate(()=>coursebridge.snapshot())).power.reason,'finished');
  finished=false;await sync();assert.equal((await page.evaluate(()=>coursebridge.snapshot())).power.active,true);
  await page.evaluate(()=>coursebridge.control('pause'));assert.equal((await page.evaluate(()=>coursebridge.snapshot())).power.active,false);
  await page.waitForFunction(()=>document.querySelector('#power-status').textContent.includes('已暂停'));
  await page.screenshot({path:path.join(work,'防睡眠设置.png'),fullPage:true});
  assert.equal(JSON.parse(fs.readFileSync(path.join(data,'settings.json'),'utf8')).settings.keepAwake,true);assert.deepEqual(errors,[]);
  const report={passed:true,actualBlockerVerified:true,displaySleepBlockerRequested:false,pauseReleases:true,batteryEventsVerified:true,courseEndReleases:true,settingsPersisted:true,hardwareWasOnBattery:hardwareBattery};
  fs.writeFileSync(path.join(work,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 } finally {clearInterval(timer);await application.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
