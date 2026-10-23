const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { ensureTextProtocol, hasOpenPaper } = require('../desktop/browser.cjs');
test('Paused exam and preview still block automatic browser restart', () => {
  const pages = paths => paths.map(path => ({url:()=> 'https://mooc1.chaoxing.com'+path}));
  assert.equal(hasOpenPaper(pages(['/exam-ans/exam/test/reVersionTestStartNew'])),true);
  assert.equal(hasOpenPaper(pages(['/exam-ans/mooc2/exam/preview'])),true);
  assert.equal(hasOpenPaper(pages(['/mycourse/studentstudy','/exam-ans/mooc2/exam/exam-list'])),false);
});
test('Old running worker gets one authenticated text listener without reinstalling', async () => {
  const listeners=[], calls=[];
  const context=vm.createContext({chrome:{runtime:{onMessage:{addListener:fn=>listeners.push(fn)}},storage:{local:{get:async()=>({token:'local-test-token',clientId:'test-client'})}}},AbortSignal,
    fetch:async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({status:'pending',id:'test-job'})};}});
  const worker={evaluate:fn=>vm.runInContext('('+fn.toString()+')()',context)};
  await ensureTextProtocol(worker); await ensureTextProtocol(worker); assert.equal(listeners.length,1);
  assert.equal(listeners[0]({type:'sync'}, {}, ()=>assert.fail()),undefined);
  const result=await new Promise(resolve=>assert.equal(listeners[0]({type:'text-input',typing:{action:'start'}},{tab:{id:4},frameId:7,url:'https://mooc1.chaoxing.com/exam-ans/exam/test/x'},resolve),true));
  assert.equal(result.status,'pending'); assert.equal(calls.length,1);
  assert.equal(calls[0].options.headers.Authorization,'Bearer local-test-token');
  assert.deepEqual(JSON.parse(calls[0].options.body),{clientId:'test-client',tabId:4,frameId:7,typing:{action:'start'},url:'https://mooc1.chaoxing.com/exam-ans/exam/test/x'});
});
