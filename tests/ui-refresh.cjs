const {chromium}=require('playwright-core'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');const root=path.resolve(__dirname,'..'),out=path.join(root,'work/ui-refresh');fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({executablePath:process.env.COURSEBRIDGE_CHROME,headless:true});
try{
 const page=await browser.newPage({viewport:{width:1180,height:800},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const sample=[{id:'demo-1',question:'在课程任务中，如何判断视频任务点已经完成？',options:['仅查看播放位置','以平台显示的任务完成状态为准'],answers:['以平台显示的任务完成状态为准'],source:'学习通 · 课程任务',verified:true,multiple:false},{id:'demo-2',question:'示例题目：学习笔记有哪些整理方式？',options:['按章节整理','按知识点整理'],answers:[],source:'本地收集',verified:false,multiple:true}];
  const state={version:'0.1.15',bankCount:12,offlineBankCount:582055,pendingCount:3,libraryRevision:1,frames:[],logs:[],power:{message:'任务已暂停，使用系统睡眠设置',active:false},browser:{status:'尚未打开课程浏览器',running:false,version:'',updatePending:false},settings:{enabled:false,autoNext:true,muted:true,autoAnswer:false,autoSubmit:false,skipUnanswered:true,keepAwake:true,collectQuestions:true,useOfflineBank:false,playbackRate:1,nextDelay:5}};
  const clone=()=>structuredClone(state);const power=()=>state.power={active:state.settings.enabled&&state.settings.keepAwake,message:!state.settings.keepAwake?'防睡眠已关闭，使用系统睡眠设置':state.settings.enabled?'防睡眠已生效 · 允许屏幕按系统设置熄灭':'任务已暂停，使用系统睡眠设置'};const query=q=>({entries:sample.filter(x=>(!q.search||x.question.includes(q.search))&&(q.filter!=='pending'||!x.verified)&&(q.filter!=='ready'||x.verified)),total:2,libraryRevision:state.libraryRevision});
  window.coursebridge={snapshot:async()=>clone(),control:async action=>{if(action!=='next')state.settings.enabled=action==='start';power();state.logs.unshift({time:Date.now(),message:action==='start'?'任务已启动':action==='pause'?'任务已暂停':'已请求下一步',level:'info'});return clone();},settings:async value=>{Object.assign(state.settings,value);power();return clone();},openLearning:async()=>{Object.assign(state.browser,{running:true,version:'0.1.15',status:'浏览器已连接 · 插件已自动配对'});return structuredClone(state.browser);},copyToken:async()=>true,openExtension:async()=>true,listBank:async q=>query(q),searchOffline:async q=>({...query(q),entries:q.search?sample.map(x=>({...x,reference:true})):[]}),importBank:async()=>clone(),exportBank:async()=>true,saveQuestion:async()=>clone(),offlineReference:async()=>({status:'missing',indices:[]})};
  window.setPreviewState=patch=>{Object.assign(state,patch);window.render(clone());};
 });
 await page.goto(pathToFileURL(path.join(root,'desktop/ui/index.html')).href);await page.waitForSelector('#course-empty:not([hidden])');
 const shot=async name=>{await page.evaluate(()=>{scrollTo(0,0);document.querySelector('#toast').classList.remove('show');});await page.waitForTimeout(200);await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});};
 assert.equal(await page.locator('nav button svg').count(),5);assert.equal(await page.locator('#pause').isDisabled(),true);assert.equal(await page.locator('#next').isDisabled(),true);
 await shot('总览-未连接');
 await page.click('#open-learning');await page.waitForFunction(()=>document.querySelector('#browser-badge').textContent==='已连接');
 await page.evaluate(()=>setPreviewState({frames:[{tabKey:'demo:1',frameId:0,title:'学生学习页面',chapter:'2.2 脑机接口技术的应用与挑战',status:'视频任务点已完成，准备进入章节测验',stepKind:'media',media:0,questions:0,extensionVersion:'0.1.15'},{tabKey:'demo:1',frameId:1,title:'课程视频',status:'正在播放课程',media:1,questions:0,extensionVersion:'0.1.15'}],logs:[{time:Date.now()-60000,message:'专用浏览器已连接，插件已自动配对',level:'info'},{time:Date.now()-120000,message:'题库已加载，等待开始任务',level:'info'}]}));
 await page.click('#start');await page.waitForFunction(()=>document.querySelector('#task-state').textContent==='运行中');assert.equal(await page.locator('#recent-list .recent-row').count(),3);
 await page.evaluate(()=>setPreviewState({power:{active:true,message:'防睡眠已生效 · 允许屏幕按系统设置熄灭'}}));
 await shot('总览');await page.click('#pause');
 await page.click('[data-page=settings]');await page.check('#autoAnswer');await page.check('#autoSubmit');await page.selectOption('#playbackRate','16');await page.uncheck('#keepAwake');
 assert.match(await page.locator('#save-note').textContent(),/未保存/);await page.click('#save-settings');assert.equal((await page.evaluate(()=>coursebridge.snapshot())).settings.keepAwake,false);assert.equal((await page.evaluate(()=>coursebridge.snapshot())).settings.playbackRate,16);
 await shot('设置');await page.click('[data-page=overview]');assert.match(await page.locator('#runtime-settings').textContent(),/16/);
 await page.click('[data-page=bank]');await page.waitForSelector('.library-row',{state:'attached'});assert.equal(await page.locator('#question-collection').getAttribute('open'),null);assert.equal(await page.locator('.library-row[open]').count(),0);await shot('题库-默认收起');await page.locator('#question-collection > summary').click();await page.locator('.library-row > summary').first().click();assert.equal(await page.locator('.library-row[open]').count(),1);await page.evaluate(()=>setPreviewState({libraryRevision:2}));await page.waitForTimeout(300);assert.equal(await page.locator('.library-row[open]').count(),1);await shot('题库-展开');await page.click('#collapse-questions');assert.equal(await page.locator('.library-row[open]').count(),0);await page.click('#bank-tab-services');await shot('查题服务');await page.click('#bank-tab-local');
 await page.click('[data-bank-filter=pending]');await page.waitForFunction(()=>document.querySelectorAll('.library-row').length===1);await page.locator('.library-row > summary').click();await page.getByRole('button',{name:'补充答案',exact:true}).click();assert.equal(await page.locator('#question-editor').isVisible(),true);await page.click('#close-editor');
 await page.locator('#bank-tab-local').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#bank-tab-services').getAttribute('aria-selected'),'true');await page.keyboard.press('Home');assert.equal(await page.locator('#bank-tab-local').getAttribute('aria-selected'),'true');await page.click('[data-page=extension]');assert.equal(await page.locator('.manual-connect').getAttribute('open'),null);await shot('连接');await page.locator('.manual-connect summary').click();await page.click('#copy-token');
 await page.click('[data-page=logs]');await shot('记录');
 for(const width of [980,1180,1440]){
  await page.setViewportSize({width,height:width===980?680:860});
  for(const name of ['overview','settings','bank','extension','logs']){
   await page.click(`[data-page=${name}]`);await page.evaluate(()=>scrollTo(0,0));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width} ${name} 横向溢出`);
   if(name==='overview'){const box=await page.locator('#start').boundingBox();assert.ok(box.y+box.height<page.viewportSize().height,`${width} 主要操作需位于首屏`);}
   if(name==='bank'){await page.click('#bank-tab-services');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot('查题服务-'+width);await page.click('#bank-tab-local');}if(name==='settings'){await page.locator('#save-settings').scrollIntoViewIfNeeded();await page.check('#keepAwake');await page.click('#save-settings');}
  }
  await page.click('[data-page=overview]');if(width===980)await shot('紧凑窗口');
 }
 await page.setViewportSize({width:1180,height:800});await page.click('[data-page=overview]');
 await page.evaluate(()=>setPreviewState({frames:[{tabKey:'demo:1',frameId:0,title:'学生学习页面',chapter:'超长课程标题'.repeat(20),status:'题库匹配 0/4；4 道未找到答案，保留测验并继续',stepKind:'assessment',questions:4,extensionVersion:'0.1.15'}],logs:[]}));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.match(await page.locator('#recent-list').textContent(),/任务启动后/);
 const ids=await page.locator('[id]').evaluateAll(els=>els.map(x=>x.id));assert.equal(new Set(ids).size,ids.length,'不能有重复 ID');assert.deepEqual(errors,[]);
 const result={passed:true,viewports:[980,1180,1440],pages:5,primaryActionVisible:true,settingsSaved:true,questionEditorChecked:true,duplicateIds:false,pageErrors:errors};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
