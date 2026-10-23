const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');const {createBridge}=require('../desktop/bridge.cjs');
const root=path.join(__dirname,'..'),work=path.join(root,'work/workflow-browser');fs.mkdirSync(work,{recursive:true});
const extension=path.join(work,'extension');fs.cpSync(path.join(root,'extension'),extension,{recursive:true});
for(const name of ['manifest.json','background.js']){const file=path.join(extension,name);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('127.0.0.1:17328','127.0.0.1:17336'));}
const dialog=`<div id="modal" style="display:none;position:fixed;inset:0;background:#0006"><div style="background:white;margin:30px;padding:15px"><h3>提示</h3><p>确认提交?</p><div><a onclick="document.querySelector('#modal').style.display='none'">取消</a><a id="confirm" onclick="confirmed()">提交</a></div></div></div>`;
const quiz=title=>`<!doctype html><meta charset="utf-8"><title>章节测验</title><section data-coursebridge-question><h3 data-question-title>${title}</h3><label><input type="radio" name="q">错误项</label><label><input type="radio" name="q">正确项</label></section><a onclick="parent.postMessage({show:true},'*');document.body.dataset.submitClicks=String(+(document.body.dataset.submitClicks||0)+1)">提交</a><script>addEventListener('message',e=>{if(e.source===parent&&e.data.receipt)document.body.dataset.submitted='yes'})</script>`;
function mainQuiz(missing=false){return `<!doctype html><meta charset="utf-8"><title>学生学习页面</title><style>iframe{width:700px;height:200px}a{display:inline-block;padding:10px}</style><li data-coursebridge-tab class="active">章节测验</li><iframe id="quiz" src="https://quiz.chaoxing.com/work/${missing?'missing':'valid'}"></iframe>${dialog}<button data-coursebridge-next onclick="if(!document.body.dataset.receipt)document.body.dataset.early='yes';document.body.dataset.next='yes'">下一课时</button><script>window.openDialog=()=>document.querySelector('#modal').style.display='block';addEventListener('message',e=>{if(e.source===document.querySelector('#quiz').contentWindow&&e.data.show)openDialog()});function confirmed(){document.body.dataset.confirmClicks=String(+(document.body.dataset.confirmClicks||0)+1);setTimeout(()=>{document.body.dataset.receipt='yes';document.querySelector('#quiz').contentWindow.postMessage({receipt:true},'*');document.querySelector('#modal').style.display='none'},4000)}</script>`;}
function wav(){const bytes=16000*120*2,b=Buffer.alloc(44+bytes);b.write('RIFF');b.writeUInt32LE(36+bytes,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(bytes,40);return b;}
function videoPage(done){return `<!doctype html><meta charset="utf-8"><title>学生学习页面</title><style>iframe{width:700px;height:250px}</style><ul class="prev_ul"><li class="active">1 视频</li><li onclick="document.querySelectorAll('.prev_ul li').forEach((el,i)=>el.classList.toggle('active',i===1));document.querySelector('#cards').style.display='none';document.querySelector('#quiz').style.display='block';document.body.dataset.quiz='yes'">2 章节测验</li></ul><iframe id="cards" src="https://cards.chaoxing.com/cards?done=${done?1:0}"></iframe><iframe id="quiz" style="display:none" src="https://quiz.chaoxing.com/work/missing"></iframe><button data-coursebridge-next onclick="document.body.dataset.next='yes'">下一课时</button>`;}
(async()=>{const bridge=createBridge({dataDir:fs.mkdtempSync(path.join(work,'data-')),port:17336});let context;
try{
 await bridge.listen();bridge.importBank([{question:'提交确认验证',answer:'正确项'}]);bridge.update({enabled:true,autoAnswer:true,autoSubmit:true,autoNext:true,skipUnanswered:false,nextDelay:2});
 context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(work,'profile-')),{executablePath:process.env.COURSEBRIDGE_CHROME,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],ignoreDefaultArgs:['--disable-extensions']});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(token=>chrome.storage.local.set({token}),bridge.snapshot().token);
 await context.route(/https:\/\/[^/]*chaoxing\.com\//,route=>{const u=new URL(route.request().url());if(u.pathname==='/tone.wav')return route.fulfill({contentType:'audio/wav',body:wav()});let body;
 if(u.hostname==='quiz.chaoxing.com')body=quiz(u.pathname.endsWith('valid')?'提交确认验证':'没有匹配答案的测验');
 else if(u.hostname==='cards.chaoxing.com')body=`<!doctype html><meta charset="utf-8"><title>视频</title><div class="task-status"><i>✓</i><span>${u.searchParams.get('done')==='1'?'任务点已完成':'任务点待完成'}</span></div><iframe style="width:600px;height:150px" src="https://media.chaoxing.com/player"></iframe>`;
 else if(u.hostname==='media.chaoxing.com')body='<html><audio controls src="https://media.chaoxing.com/tone.wav"></audio></html>';
 else if(u.pathname==='/ending')body='<html><meta charset="utf-8"><title>目录末尾验证</title><div data-current="true"><button data-coursebridge-chapter>最后一课时</button></div><li data-coursebridge-tab class="active">章节测验</li><h3 class="mark_title">章节测验结果</h3><div data-coursebridge-result>提交成功</div></html>';
 else body=u.pathname.startsWith('/video')?videoPage(u.pathname.endsWith('done')):mainQuiz(u.pathname==='/missing');
 return route.fulfill({contentType:'text/html',body});});
 const page=await context.newPage();await page.goto('https://course.chaoxing.com/confirm');
 await page.waitForFunction(()=>document.body.dataset.next==='yes',null,{timeout:35000});
 assert.equal(await page.evaluate(()=>document.body.dataset.confirmClicks),'1');assert.equal(await page.evaluate(()=>document.body.dataset.early),undefined);
 assert.equal(await page.frames().find(f=>f.url().includes('quiz.chaoxing')).evaluate(()=>document.body.dataset.submitClicks),'1');
 console.log('PASS: 题目在子框架、确认弹窗在主页面时自动确认一次；等待真实提交回执再跳转。');
 bridge.update({autoSubmit:false});await page.goto('https://course.chaoxing.com/manual');await page.waitForTimeout(6000);await page.evaluate(()=>openDialog());await page.waitForTimeout(5000);assert.equal(await page.evaluate(()=>document.body.dataset.confirmClicks),undefined);
 bridge.update({autoSubmit:true});await page.goto('https://course.chaoxing.com/missing');await page.waitForTimeout(5000);await page.evaluate(()=>openDialog());await page.waitForTimeout(5000);assert.equal(await page.evaluate(()=>document.body.dataset.confirmClicks),undefined);
 console.log('PASS: 关闭自动提交、缺答案时，即使弹出确认框也不自动确认。');
 bridge.update({autoAnswer:false,autoSubmit:false,skipUnanswered:false,autoNext:true,nextDelay:30});await page.goto('https://course.chaoxing.com/video-waiting');await page.waitForTimeout(7000);assert.equal(await page.evaluate(()=>document.body.dataset.quiz),undefined);
 await page.goto('https://course.chaoxing.com/video-done');
 await page.waitForFunction(()=>document.body.dataset.quiz==='yes',null,{timeout:12000});
 const media=page.frames().find(f=>f.url().includes('media.chaoxing'));assert.ok(await media.evaluate(()=>document.querySelector('audio').currentTime<10));
 await page.waitForTimeout(7000);assert.equal(await page.evaluate(()=>document.body.dataset.next),undefined,'已完成视频不能把未完成测验认作已提交');
 console.log('PASS: 已完成标记包含图标与子节点、位于父框架时，未播完也快速进入同章测验；未完成视频不跳、测验不被误判提交。');
  bridge.update({nextDelay:2});await page.goto('https://course.chaoxing.com/ending');
  const endingSince=Date.now();while(!bridge.snapshot().frames.some(f=>f.title==='目录末尾验证'&&f.frameId===0&&f.taskFinished)){assert.ok(Date.now()-endingSince<18000,'目录末尾应报告结束');await page.waitForTimeout(300);}
  console.log('PASS: 到达目录末尾时，插件向桌面报告任务结束以解除防睡眠。');
 // Exercise dialog identification against unrelated, incomplete and hidden prompts.
 await page.setContent('<div id="test"></div>');await page.addScriptTag({path:path.join(root,'extension/adapter.js')});
 for(const [message,visible,expected]of [['确认提交?',true,true],['确认删除?',true,false],['确认提交? 还有未作答题目',true,false],['确认提交?',false,false]]){
  const found=await page.evaluate(({message,visible})=>{document.querySelector('#test').innerHTML='<div style="'+(visible?'':'display:none')+'"><p>'+message+'</p><button>取消</button><button>提交</button></div>';return !!CourseBridgeAdapter.findSubmitConfirmation();},{message,visible});assert.equal(found,expected);
 }
 console.log('PASS: 不点击隐藏弹窗、删除确认和未作答警告。');
 assert.equal(await page.evaluate(()=>{document.querySelector('#test').innerHTML='<div>确认提交？<button>取消</button><button>提交</button></div>';return !!CourseBridgeAdapter.findSubmitConfirmation();}),true);
 assert.equal(await page.evaluate(()=>{document.querySelector('#test').innerHTML='<div class="task-status"><i>✓</i><span>任务点</span><b>已完成</b></div>';return CourseBridgeAdapter.assessmentState().taskComplete;}),true);
 assert.equal(await page.evaluate(()=>{document.querySelector('.task-status').style.display='none';return CourseBridgeAdapter.assessmentState().taskComplete;}),false);
 assert.equal(await page.evaluate(()=>{document.querySelector('#test').innerHTML='<div class="ans-job-icon ans-job-finished"></div>';return CourseBridgeAdapter.assessmentState().taskComplete;}),true);
 assert.equal(await page.evaluate(()=>{document.querySelector('.ans-job-icon').classList.remove('ans-job-finished');return CourseBridgeAdapter.assessmentState().taskComplete;}),false);
  console.log('PASS: 分段完成文字、平台完成类名可识别，隐藏标记不计入完成。');
}finally{await context?.close();await bridge.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
