const { _electron: electron } = require('playwright-core');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..'), work = path.join(root, 'work/editor-desktop'); fs.mkdirSync(work, { recursive: true });
(async () => {
  const env = { ...process.env, COURSEBRIDGE_TEST: '1', COURSEBRIDGE_TEST_PORT: '0', COURSEBRIDGE_DATA_DIR: fs.mkdtempSync(path.join(work, 'data-')) }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: process.env.COURSEBRIDGE_TEST_EXE || path.join(root, 'node_modules/electron/dist/electron.exe'), args: process.env.COURSEBRIDGE_TEST_EXE ? [] : [root], env });
  try {
    const page = await app.firstWindow(); await page.waitForSelector('#autoAnswer', { state: 'attached' });
    const state = await page.evaluate(() => window.coursebridge.snapshot()); assert.equal(state.version,'0.1.23'); assert.equal(state.settings.enabled,false);
    assert.ok((await page.locator('body').textContent()).includes('文本题通过专用浏览器逐字输入'));
    const send = async (route, data) => (await fetch(`http://127.0.0.1:${state.port}/v1/${route}`, { method:'POST',headers:{Authorization:'Bearer '+state.token},body:JSON.stringify({clientId:'desktop-typing-test',tabId:1,frameId:0,...data})})).json();
    await page.evaluate(() => window.coursebridge.settings({ enabled: true, autoAnswer: true, lookupMode:'local' }));
    await send('sync',{state:{questions:1,paperQuestions:1,visible:true,paperMode:'exam'}});
    const typing={operation:'start',requestId:randomUUID(),questionMarker:randomUUID(),targetMarker:randomUUID(),rawTitle:'模拟题目',text:'模拟正文'};
    await send('type',{typing,url:'https://mooc1.chaoxing.com/exam-ans/exam/test/reVersionTestStartNew'});
    const result=await send('type',{typing:{operation:'status',requestId:typing.requestId}}); assert.equal(result.status,'blocked'); assert.match(result.detail,/专用课程浏览器/);
    fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({passed:true,version:state.version,mainInputHandlerConnected:true,realCourseOpened:false},null,2));console.log('PASS: 桌面端 0.1.23 启动、界面说明、原生输入接口接通，未打开真实课程。');
  } finally { await app.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
