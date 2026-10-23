(function(root) {
  let fingerprint = '', info, waiting, pendingKey = '', attemptedKey = '', retryAt = 0;
  let detail = '尚未检查字体';
  const encrypted = element => {
    if (!element?.closest('.font-cxsecret')) return false;
    const view=element.ownerDocument?.defaultView;
    return !view || /font-cxsecret/i.test(view.getComputedStyle(element).fontFamily);
  };
  function fontSource(doc) {
    const sources=[];
    const visit=rules=>{for(const rule of rules||[]){if(rule.type===5 && /font-cxsecret/i.test(rule.style.fontFamily))sources.push(rule.style.getPropertyValue('src'));else if(rule.cssRules)visit(rule.cssRules);}};
    for(const sheet of [...(doc.styleSheets||[]),...(doc.adoptedStyleSheets||[])]) {try{visit(sheet.cssRules);}catch{/* Cross-origin stylesheet contents may be private to the browser. */}}
    if(sources.length)return sources[sources.length-1];
    const styles=[...doc.querySelectorAll('style')].map(el=>el.textContent).filter(text=>text.includes('font-cxsecret')&&text.includes('base64,'));
    return styles[styles.length-1];
  }
  async function prepare(doc = document, decode = font => chrome.runtime.sendMessage({type:'decode-font',font})) {
    const text = fontSource(doc);
    const base64 = text?.match(/url\(\s*['"]?data:[^,;]+(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)['"]?\s*\)/)?.[1]?.replace(/\s/g,'');
    if (!base64) {info=undefined;fingerprint='';attemptedKey='';detail = text ? '字体声明格式未识别' : '当前框架没有内嵌字体声明'; return; }
    if (fingerprint === base64 && info) return;
    if (pendingKey === base64) { await waiting; return; }
    if (attemptedKey === base64 && Date.now() < retryAt) return;
    attemptedKey = pendingKey = base64; info = undefined; detail = '正在请求本机还原字体';
    let timer;
    const task = Promise.race([Promise.resolve().then(()=>decode(base64)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('字体服务响应超时，将自动重试')),4500);})]);
    waiting = task.then(result=>{
      if (attemptedKey !== base64) return;
      const valid = result?.available === true && result.map && typeof result.map === 'object' && !Array.isArray(result.map) && Object.keys(result.map).length > 0 && Array.isArray(result.unknown);
      if (valid) {info=result;fingerprint=base64;retryAt=0;detail=`已还原 ${Object.keys(info.map).length} 字，未知 ${info.unknown.length} 字`;}
      else {fingerprint='';retryAt=Date.now()+2000;detail=result?.error || '字体服务尚未返回有效字形，将自动重试';}
    }).catch(error=>{if(attemptedKey===base64){fingerprint='';retryAt=Date.now()+2000;detail=error.message;}}).finally(()=>{clearTimeout(timer);if(pendingKey===base64)pendingKey='';});
    await waiting;
  }
  function text(element) {
    let value = '', unresolved = false;
    if (!element) return {value,unresolved};
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node=walker.currentNode;
      if (!encrypted(node.parentElement)) { value+=node.textContent; continue; }
      if (!info?.available) { value+=node.textContent; unresolved=true; continue; }
      for (const char of node.textContent) {
        const code=char.codePointAt(0);
        if (info.unknown.includes(code)) unresolved=true;
        value+=info.map[code] ?? char;
      }
    }
    return {value:value.trim(),unresolved};
  }
  root.CourseBridgeFont = {prepare,text,status:()=>detail};
})(globalThis);
