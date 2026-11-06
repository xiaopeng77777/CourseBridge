const {createBrowserManager,PERSONAL_HOME}=require('../desktop/browser.cjs');
const {createBridge}=require('../desktop/bridge.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),work=path.join(root,'work/20261106-image-questions/home');fs.mkdirSync(work,{recursive:true});
(async()=>{
 const extensionDir=path.join(work,'extension');fs.cpSync(path.join(root,'extension'),extensionDir,{recursive:true});
 const bridge=createBridge({dataDir:path.join(work,'data'),port:0});let manager;
 try{
 await bridge.listen();const port=bridge.snapshot().port;
 for(const file of ['background.js','manifest.json']){const target=path.join(extensionDir,file);fs.writeFileSync(target,fs.readFileSync(target,'utf8').replaceAll('127.0.0.1:17328',`127.0.0.1:${port}`));}
 const legacy=path.join(work,'course-pages.json'),saved=JSON.stringify(['https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=fixture&pageHeader=9']);fs.writeFileSync(legacy,saved);
 const make=()=>createBrowserManager({runtimeDir:process.env.COURSEBRIDGE_BROWSER_RUNTIME||path.join(root,'runtime/browsers'),extensionDir,profileDir:path.join(work,'profile'),token:bridge.snapshot().token,isTaskRunning:()=>false,headless:true,prepareContext:context=>context.route('https://*.chaoxing.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local fixture</title><h1>个人空间测试</h1>'}))});
 manager=make();await manager.open();assert.deepEqual(manager.context().pages().map(p=>p.url()),[PERSONAL_HOME]);
 const chapter='https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=fixture';await manager.context().pages()[0].goto(chapter);await manager.open();assert.equal(manager.context().pages()[0].url(),chapter);await manager.close();
 assert.equal(fs.readFileSync(legacy,'utf8'),saved);
 manager=make();await manager.open();assert.deepEqual(manager.context().pages().map(p=>p.url()),[PERSONAL_HOME]);await manager.close();
 manager=make();await manager.open([chapter]);assert.ok(manager.context().pages().some(p=>p.url()===chapter));
 console.log('PASS: 启动进入个人空间、不恢复旧考试列表、不打断已打开课程、保留内部显式恢复能力。');
 }finally{await manager?.close();await bridge.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
