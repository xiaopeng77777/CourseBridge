const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
  let time=1000;
  const parent={closest:()=>true},node={textContent:'嗃',parentElement:parent};
  const doc={querySelectorAll:()=>[{textContent:"@font-face{font-family:'font-cxsecret';src:url('data:application/font-ttf;base64,AA==')}"}],createTreeWalker:()=>{let visited=false;return{currentNode:node,nextNode(){if(visited)return false;visited=true;return true;}};}};
  const ctx=vm.createContext({document:doc,NodeFilter:{SHOW_TEXT:4},Date:{now:()=>time},setTimeout,clearTimeout});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../extension/font.js'),'utf8'),ctx);
  parent.ownerDocument=doc;
  return{font:ctx.CourseBridgeFont,doc,element:{ownerDocument:doc},advance:()=>{time+=2100;}};
}
const valid={available:true,map:{[ '嗃'.codePointAt(0)]:'埃'},unknown:[]};
for(const first of [undefined,{available:false,map:{},unknown:[]},{error:'插件刚连接，服务尚未就绪'}])test('无效字体响应不能缓存为成功；重试成功后缓存有效映射：'+JSON.stringify(first),async()=>{
  const {font,doc,element,advance}=fixture();let calls=0;
  const decode=async()=>++calls===1?first:valid;
  await font.prepare(doc,decode);assert.equal(font.text(element).unresolved,true);
  assert.equal(calls,1);await font.prepare(doc,decode);assert.equal(calls,1,'重试间隔内不重复请求');
  advance();await font.prepare(doc,decode);assert.equal(calls,2);
  assert.equal(font.text(element).value,'埃');assert.equal(font.text(element).unresolved,false);
  await font.prepare(doc,decode);assert.equal(calls,2,'有效映射才可复用');
});
test('并发字体请求复用正在处理的请求，异常后可恢复',async()=>{
  const {font,doc,element,advance}=fixture();let complete,calls=0;
  const decode=()=>{calls++;return new Promise(resolve=>{complete=resolve;});};
  const one=font.prepare(doc,decode),two=font.prepare(doc,decode);await Promise.resolve();assert.equal(calls,1);complete(valid);await Promise.all([one,two]);assert.equal(font.text(element).value,'埃');
  const fresh=fixture();await fresh.font.prepare(fresh.doc,async()=>{throw new Error('暂时断开');});fresh.advance();await fresh.font.prepare(fresh.doc,async()=>valid);assert.equal(fresh.font.text(fresh.element).unresolved,false);
});
test('读取通过 CSSOM 设置的字体；只有样式类但实际使用普通字体时不误判为加密',async()=>{
  const {font,doc,element}=fixture();doc.querySelectorAll=()=>[];
  doc.styleSheets=[{cssRules:[{type:5,style:{fontFamily:'font-cxsecret',getPropertyValue:()=>"url('data:application/font-ttf;base64,AA==')"}}]}];
  await font.prepare(doc,async()=>valid);assert.equal(font.text(element).value,'埃');
  const plain=fixture();plain.doc.defaultView={getComputedStyle:()=>({fontFamily:'SimSun, serif'})};
  assert.equal(plain.font.text(plain.element).unresolved,false);
});
