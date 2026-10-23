// Native keyboard input is confined to a marked editor in the managed browser.
// Never use the OS keyboard, clipboard, paste, or a replacement HTML fragment.
const { setTimeout: delay } = require('node:timers/promises');
const compact = text => String(text || '').replace(/[\s\u200b\ufeff]/gu, '');
const marker = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const courseURL = value => { try { const url = new URL(value); return url.protocol === 'https:' && (url.hostname === 'chaoxing.com' || url.hostname.endsWith('.chaoxing.com')); } catch { return false; } };
const titleSelector = '[data-question-title],.Zy_TItle,.mark_name,.question-title,.tkItem_title,h3';
function createTextTyper({ getContext, characterDelay = 4 } = {}) {
  const jobs = new Map(); let active, closed = false;
  const publicState = job => ({ status: job.status, detail: job.detail || '', typed: job.typed, total: job.total });
  function stop(job, message) { job.cancelled = true; job.status = 'blocked'; job.detail = message; }
  async function run(job) {
    let question, target, targetFrame;
    const input = job.input;
    const guard = async () => {
      if (closed || job.cancelled || !job.allowed()) throw Error('任务已暂停或页面已切换，已停止输入，保留现有内容');
      if (!await question.isVisible() || !await target.isVisible() || !await target.isEditable()) throw Error('编辑器已隐藏、只读或已切换，已停止输入');
      const raw = await question.locator(titleSelector).first().textContent();
      if (raw !== input.rawTitle) throw Error('题干已切换，已停止输入，保留现有内容');
    };
    const read = () => target.evaluate(el => /^(TEXTAREA|INPUT)$/.test(el.tagName) ? el.value : typeof el.innerText === 'string' ? el.innerText : el.textContent || '');
    try {
      const context = getContext();
      if (!context) throw Error('请使用课桥打开的专用课程浏览器进行文本输入');
      const sources = [];
      for (const page of context.pages()) {
        if (!courseURL(page.url())) continue;
        for (const frame of page.frames()) if (frame.url() === input.url) {
          const q = frame.locator(`[data-coursebridge-typing-question="${input.questionMarker}"]`);
          if (await q.count() === 1) sources.push({ frame, q, page });
        }
      }
      if (sources.length !== 1) throw Error('未能唯一定位当前题目，已停止输入');
      const source = sources[0]; question = source.q;
      const targets = [];
      for (const frame of source.page.frames()) {
        let ancestor = frame;
        while (ancestor && ancestor !== source.frame) ancestor = ancestor.parentFrame();
        if (!ancestor) continue;
        const el = frame.locator(`[data-coursebridge-typing-target="${input.targetMarker}"]`);
        if (await el.count() !== 1) continue;
        if (frame === source.frame) {
          if (!await el.evaluate((node, id) => !!node.closest(`[data-coursebridge-typing-question="${id}"]`), input.questionMarker)) continue;
        } else {
          let direct = frame;
          while (direct.parentFrame() !== source.frame) direct = direct.parentFrame();
          const handle = await direct.frameElement();
          const inside = await handle.evaluate((node, id) => !!node.closest(`[data-coursebridge-typing-question="${id}"]`), input.questionMarker);
          await handle.dispose(); if (!inside) continue;
        }
        targets.push({ el, frame });
      }
      if (targets.length !== 1) throw Error('未能唯一定位文本编辑器，已停止输入');
      target = targets[0].el; targetFrame = targets[0].frame;
      const supported = await target.evaluate(el => el.isContentEditable || el.ownerDocument.designMode === 'on' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' && ['text','number'].includes(el.type));
      if (!supported) throw Error('暂不支持这个编辑器，未修改原文');
      await guard();
      let before = await read();
      if (compact(before) === compact(input.text)) { job.status = 'done'; job.typed = job.total; return; }
      if (compact(before)) throw Error('已有手动内容或上次未完成的正文，保留原文，请核对后继续');
      await target.focus({ timeout: 2000 });
      let expected = '';
      const chars = Array.from(input.text.replace(/\r\n?/g, '\n'));
      for (let offset = 0; offset < chars.length; offset += 8) {
        await guard();
        const current = await read();
        if (compact(current) !== compact(expected)) throw Error('正文在输入期间发生变化，已停止输入，保留现有内容');
        const focused = await target.evaluate(el => el.ownerDocument.activeElement === el || el.contains(el.ownerDocument.activeElement));
        if (!focused) throw Error('输入焦点已移走，已停止输入，保留现有内容');
        const chunk = chars.slice(offset, offset + 8).join('');
        // pressSequentially emits browser keyboard/input events for each character.
        // Use Enter explicitly for paragraph breaks; never send Ctrl+V.
        const lines = chunk.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (i) await target.press('Enter', { timeout: 2000 });
          if (lines[i]) await target.pressSequentially(lines[i], { delay: characterDelay, timeout: 4000 });
        }
        expected += chunk;
        job.typed = Math.min(job.total, offset + 8);
        const result = await read();
        if (compact(result) !== compact(expected)) throw Error('编辑器未接受完整输入，可能有字数或输入限制；已停止并保留现有内容');
      }
      await guard();
      await target.evaluate(el => { el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); });
      // Flush only the editor whose body is the marked target, never another answer.
      const scopes = [targetFrame, source.frame].filter((frame, i, list) => list.indexOf(frame) === i);
      for (const frame of scopes) {
        const result = await frame.evaluate(({ id }) => {
          const find = doc => {
            const own = doc.querySelector(`[data-coursebridge-typing-target="${id}"]`); if (own) return own;
            for (const child of doc.querySelectorAll('iframe')) { try { const found = child.contentDocument && find(child.contentDocument); if (found) return found; } catch {} }
          };
          const el = find(document); if (!el) return null;
          const norm = text => String(text || '').replace(/[\s\u200b\ufeff]/gu, '');
          for (const editor of Object.values(window.UE?.instants || {})) if (editor.body === el) {
            editor.fireEvent?.('contentchange'); editor.sync?.();
            const backing = !editor.textarea || (typeof editor.getContent === 'function' ? editor.textarea.value.trim() === editor.getContent().trim() : norm(editor.textarea.value) === norm(el.innerText));
            return { supported: true, ok: norm(editor.getContentTxt()) === norm(el.innerText), backing };
          }
          for (const editor of window.tinymce?.editors || []) if (editor.getBody?.() === el) { editor.save(); return { supported: true, ok: norm(editor.getContent({ format: 'text' })) === norm(el.innerText || el.textContent), backing: true }; }
          for (const editor of Object.values(window.CKEDITOR?.instances || {})) if (editor.editable?.()?.$ === el) { editor.updateElement(); return { supported: true, ok: true, backing: true }; }
          return null;
        }, { id: input.targetMarker });
        if (result && (!result.ok || !result.backing)) throw Error('正文已输入，但编辑器尚未确认同步保存，请手动核对');
      }
      await delay(350); await guard();
      if (compact(await read()) !== compact(input.text)) throw Error('输入后正文被网页撤回或改变，未确认填写成功');
      job.status = 'done'; job.typed = job.total;
    } catch (error) { stop(job, error.message || '文本输入失败，保留现有内容，请手动核对'); }
    finally { job.input = undefined; if (active === job) active = undefined; }
  }
  function request(input, { owner, allowed }) {
    if (!marker(input?.requestId)) return { status: 'blocked', detail: '文本输入请求格式不正确' };
    const key = `${owner}:${input.requestId}`, old = jobs.get(key);
    if (input.operation === 'status') return old ? publicState(old) : { status: 'blocked', detail: '输入记录已失效，请暂停后重试' };
    if (input.operation === 'cancel') { if (old && old.status === 'pending') stop(old, '已停止输入，保留现有内容'); return old ? publicState(old) : { status: 'blocked' }; }
    if (input.operation !== 'start') return { status: 'blocked', detail: '未知文本输入操作' };
    if (old) return publicState(old);
    if (!allowed()) return { status: 'blocked', detail: '任务已暂停、处于整卷预览或页面不可写，未输入正文' };
    if (closed || active) return { status: 'busy', detail: '正在输入另一道题，请稍候' };
    if (!marker(input.questionMarker) || !marker(input.targetMarker) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 16000 || typeof input.rawTitle !== 'string' || input.rawTitle.length > 8000 || typeof input.url !== 'string' || input.url.length > 16000) return { status: 'blocked', detail: '文本输入目标或正文格式不正确' };
    const job = { status: 'pending', typed: 0, total: Array.from(input.text).length, input: { ...input }, allowed, owner };
    if (jobs.size >= 200) jobs.delete(jobs.keys().next().value);
    jobs.set(key, job); active = job; void run(job); return publicState(job);
  }
  return { request, close() { closed = true; if (active) stop(active, '课桥已关闭，已停止输入'); } };
}
module.exports = { createTextTyper };
