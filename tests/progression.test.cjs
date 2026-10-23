const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assessmentProgress } = require('../desktop/progression.cjs');
const settings = { autoAnswer: true, autoSubmit: true, skipUnanswered: true, useOfflineBank: false };
const frame = counts => [{ matchSummary: { total: 4, matched: 2, missing: 2, filled: 2, ...counts } }];
test('缺答案明确显示离线库状态，15秒后保留未完成测验继续；关闭继续开关则等待', () => {
  assert.match(assessmentProgress(frame({}), settings, 0).reason, /匹配 2\/4.*未找到答案.*离线库未开启.*15 秒/);
  assert.equal(assessmentProgress(frame({}), settings, 14000).ready, false);
  assert.equal(assessmentProgress(frame({}), settings, 15000).skipped, true);
  assert.equal(assessmentProgress(frame({}), {...settings,skipUnanswered:false}, 90000).ready, false);
});
test('未识别、冲突和不支持题型均有原因，不把用户已选项当作答案', () => {
  assert.match(assessmentProgress([], settings, 1000).reason, /未识别到/);
  assert.equal(assessmentProgress([], settings, 15000).ready, true);
  assert.match(assessmentProgress(frame({missing:0,conflict:1,unsupported:1}), settings, 0).reason, /答案冲突.*题型暂不支持/);
});
test('全部匹配后等待实际填写和提交确认，手动提交模式不超时跳走', () => {
  const frames = frame({matched:4,missing:0,filled:4});
  assert.equal(assessmentProgress(frames, settings, 20000).ready, false);
  assert.match(assessmentProgress(frames, settings, 20000).reason, /等待网页确认提交成功/);
  assert.equal(assessmentProgress(frames, {...settings,autoSubmit:false}, 999999).ready, false);
  assert.match(assessmentProgress(frame({matched:4,missing:0,filled:0}), settings, 0).reason, /正在检查填写状态/);
});

test('在线查题排队期间不跳过，查询结束失败后显示具体原因', () => {
  assert.equal(assessmentProgress(frame({ pending: 2, missing: 0 }), settings, 999999).ready, false);
  assert.match(assessmentProgress(frame({ pending: 2, missing: 0 }), settings, 999999).reason, /言溪正在查找 2 道/);
  const missing = frame({}); missing[0].remoteIssue = '言溪剩余次数为 0，请到官网查看额度';
  assert.match(assessmentProgress(missing, settings, 0).reason, /言溪剩余次数为 0.*15 秒/);
});
