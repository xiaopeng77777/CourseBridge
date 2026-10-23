const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeSessions } = require('../desktop/ui/sessions.js');
const frame = input => ({ tabKey: 'tab1', title: '学生学习页面', chapter: '', status: '等待课程内容', frameId: 0, media: 0, questions: 0, extensionVersion: '0.1.4', ...input });
test('主页面等待状态不会覆盖内层播放器状态', () => {
  const summary = summarizeSessions([frame({ iframeCount: 1, chapter: '第一章' }), frame({ frameId: 1, status: '等待播放器', iframeCount: 1 }), frame({ frameId: 2, media: 1, status: '正在播放课程', title: '播放器' })], true)[0];
  assert.equal(summary.title, '学生学习页面');
  assert.equal(summary.chapter, '第一章');
  assert.equal(summary.status, '正在播放课程');
  assert.equal(summary.connectedFrames, 3);
  assert.equal(summary.media, 1);
});
test('只有外层页面时给出具体的插件与刷新提示', () => {
  const summary = summarizeSessions([frame({ iframeCount: 2 })], true)[0];
  assert.match(summary.status, /内容页面尚未连接/);
  assert.match(summary.detail, /发现 0 个媒体/);
});
test('旧版插件可识别，暂停状态不显示为正在播放', () => {
  const summary = summarizeSessions([frame({ media: 1, status: '正在播放课程', extensionVersion: '' })], false)[0];
  assert.equal(summary.status, '已连接 · 已暂停');
  assert.equal(summary.legacy, true);
  assert.match(summary.detail, /重新加载/);
});
