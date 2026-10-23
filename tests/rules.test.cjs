const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, sanitizeSettings, validateBank, matchAnswers } = require('../extension/rules.js');

test('判断题兼容正确错误与对错符号，普通选择题不混用同义词', () => {
  const bank = [{question:'判断内容',answers:['错误']}];
  assert.deepEqual(matchAnswers({title:'4【判断题】判断内容',options:['对','错']},bank).indices,[1]);
  assert.deepEqual(matchAnswers({title:'4【判断题】判断内容',options:['√','×']},bank).indices,[1]);
  assert.equal(matchAnswers({title:'判断内容',options:['对','错']},bank).status,'ambiguous');
});

test('匹配选项文字而不是字母，支持空格与全角编号', () => {
  const bank = validateBank([{ question: '以下哪项是可再生能源？', answers: ['太阳能'] }]);
  const actual = matchAnswers({ title: '１．以下哪项是可再生能源？', options: ['A. 煤炭', 'B. 太 阳 能'], multiple: false }, bank);
  assert.deepEqual(actual, { status: 'matched', indices: [1] });
  assert.equal(normalize('Ａ． Python '), 'python');
  assert.deepEqual(matchAnswers({ title: '1【单选题】以下哪项是可再生能源？', options: ['煤炭', '太阳能'] }, bank).indices, [1]);
});
test('重复题目答案冲突时不填写', () => {
  const bank = validateBank([{ question: '题目', answer: '甲' }, { question: '题目', answer: '乙' }]);
  assert.equal(matchAnswers({ title: '题目', options: ['甲', '乙'] }, bank).status, 'conflict');
});
test('多选题必须匹配全部答案，单选不能误选多个选项', () => {
  const bank = validateBank([{ question: '语言', answers: ['Python', 'JavaScript'] }]);
  assert.deepEqual(matchAnswers({ title: '语言', options: ['Python', 'JavaScript', 'HTML'], multiple: true }, bank).indices, [0, 1]);
  assert.equal(matchAnswers({ title: '语言', options: ['Python', 'HTML'], multiple: true }, bank).status, 'ambiguous');
  assert.equal(matchAnswers({ title: '语言', options: ['Python', 'JavaScript'], multiple: false }, bank).status, 'ambiguous');
});
test('重复选项、缺失题目和错误题库格式均不猜答案', () => {
  const bank = validateBank([{ question: '题目', answer: '甲' }]);
  assert.equal(matchAnswers({ title: '题目', options: ['甲', '甲'] }, bank).status, 'ambiguous');
  assert.equal(matchAnswers({ title: '另一题', options: ['甲'] }, bank).status, 'missing');
  assert.throws(() => validateBank([{ question: '题目', answers: [] }]));
  assert.throws(() => validateBank({ question: '题目' }));
});
test('配置拒绝非布尔开关、限制速度与等待时间', () => {
  const settings = sanitizeSettings({ enabled: 'true', autoSubmit: true, playbackRate: 999, nextDelay: -1, unknown: 'x' });
  assert.equal(settings.enabled, false);
  assert.equal(settings.autoSubmit, true);
  assert.equal(settings.playbackRate, 16);
  assert.equal(settings.nextDelay, 2);
  assert.equal(settings.unknown, undefined);
  assert.equal(settings.keepAwake, true);
  assert.equal(sanitizeSettings({keepAwake:false}).keepAwake,false);
  assert.equal(sanitizeSettings({keepAwake:'false'}).keepAwake,true);
  for (const rate of [0.5, 1, 2, 3, 4, 6, 8, 12, 16]) assert.equal(sanitizeSettings({ playbackRate: rate }).playbackRate, rate);
  assert.equal(sanitizeSettings({ playbackRate: -1 }).playbackRate, 0.5);
  assert.equal(sanitizeSettings({ playbackRate: Infinity }).playbackRate, 1);
});
