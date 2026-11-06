(function(root) {
  const seen=new WeakMap();
  function fingerprint(value) {let a=0x811c9dc5,b=0x9e3779b9;for(const c of value){a=Math.imul(a^c.charCodeAt(0),0x01000193);b=Math.imul(b^c.charCodeAt(0),0x85ebca6b);}return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');}
  const background=el=>{try{return getComputedStyle(el).backgroundImage||'';}catch{return '';}};
  function identity(el,kind) {
    let source;
    if(kind==='background')source=background(el);
    else if(el.tagName==='IMG')source=el.currentSrc||el.src||el.getAttribute('data-src')||'';
    else if(el.tagName.toLowerCase()==='canvas'){try{source=el.toDataURL();}catch{source='canvas:'+el.width+':'+el.height+':'+el.id;}}
    else source=el.outerHTML.replace(/\sdata-coursebridge-image-(?:id|key|kind)="[^"]*"/g,'');
    if(kind!=='canvas'&&el.tagName==='IMG'){try{const url=new URL(source,location.href);for(const key of [...url.searchParams.keys()])if(/^(?:token|auth|signature|sign|expires?|enc|t|timestamp)$/i.test(key))url.searchParams.delete(key);source=url.href;}catch{}}
    return fingerprint(source);
  }
  function read(element,titleElement,optionElements,title,options) {
    const images=[],titles=[],values=[...options];let imageIssue='',imagePending=false;
    const issue=(message,pending=false)=>{if(!imageIssue||imagePending&&!pending){imageIssue=message;imagePending=pending;}};
    const add=(el,position,optionIndex)=>{
      // aria-hidden affects assistive technology, not whether a course image is visible.
      if(images.some(x=>x.element===el)||el.closest('.edui-editor,.tox-toolbar,[role=toolbar]'))return;
      const tag=el.tagName.toLowerCase(),kind=['img','svg','canvas'].includes(tag)?tag:'background';
      if(kind==='background'&&!/url\(/i.test(background(el)))return;
      const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden')return;
      const rect=el.getBoundingClientRect(),width=el.naturalWidth||rect.width,height=el.naturalHeight||rect.height;
      if((width<=2&&height<=2&&(tag!=='img'||el.complete))||/(?:^|[-_ ])(?:icon|checkbox|radio|answer-right|answer-wrong)(?:$|[-_ ])/i.test(el.getAttribute('class')||''))return;
      const key=identity(el,kind);let entry=seen.get(el);
      if(!entry||entry.key!==key){entry={key,id:crypto.randomUUID(),since:Date.now()};seen.set(el,entry);}
      el.setAttribute('data-coursebridge-image-id',entry.id);el.setAttribute('data-coursebridge-image-key',key);el.setAttribute('data-coursebridge-image-kind',kind);
      if(tag==='img'&&!el.complete){const pending=Date.now()-entry.since<20000;issue(pending?'题目图片正在加载，等待图片完整后再查题':'题目图片加载超时，请在网页加载完成后重试',pending);}
      else if(tag==='img'&&!el.naturalWidth)issue('题目图片加载失败，请先确认网页能显示完整图片');
      images.push({id:entry.id,key,position,optionIndex,element:el});const marker=`[图片#${key}]`;
      if(position==='option')values[optionIndex]=(values[optionIndex]||'')+' '+marker;else titles.push(marker);
    };
    const visual=scope=>scope?[...(scope.matches?.('img,svg,canvas')?[scope]:[]),...scope.querySelectorAll('img,svg,canvas'),...[scope,...scope.querySelectorAll('*')].slice(0,500).filter(el=>!el.matches('img,svg,canvas')&&/url\(/i.test(background(el)))]:[];
    optionElements.forEach((scope,i)=>visual(scope).forEach(el=>add(el,'option',i)));
    for(const el of visual(titleElement))add(el,'title',-1);
    for(const el of visual(element))if(!optionElements.some(scope=>scope?.contains(el))&&!el.closest('[contenteditable],textarea,.edui-editor,.tox'))add(el,'title',-1);
    if(images.length>12){imageIssue='本题图片超过 12 张，已停止自动分析，请手动核对';imagePending=false;}
    return {title:((title||'').trim()+' '+titles.join(' ')).trim(),options:values.map(v=>v.trim()),hasImages:images.length>0,images:images.slice(0,12).map(({element,...item})=>item),imageIssue,imagePending};
  }
  root.CourseBridgeImages={protocol:2,read,fingerprint};
})(globalThis);
