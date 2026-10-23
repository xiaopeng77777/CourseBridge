const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
function auditRelease(root = path.resolve(__dirname, '..')) {
  const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const version = json('package.json').version;
  assert.equal(json('package-lock.json').version, version, '锁文件版本');
  assert.equal(json('extension/manifest.json').version, version, '插件版本');
  for (const name of ['desktop/bridge.cjs', 'desktop/ui/index.html']) assert.ok(fs.readFileSync(path.join(root, name), 'utf8').includes(version), name + ' 版本');
  const forbidden = /usage[-_]?study|usageStudy|cost[-_]?study|CourseBridge-Cost-Test|17330|COURSEBRIDGE_VERIFY_|COURSEBRIDGE_ESSAY_SUBMIT/i;
  const privateName = /^(?:settings|enncy-config|deepseek-config|question-library|last-status|course-pages)\.json$|\.(?:sqlite|db|sql|jsonl)$/i;
  let files = 0;
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      assert.ok(!entry.isSymbolicLink(), '公开源码禁止符号链接：' + file);
      assert.ok(!privateName.test(entry.name), '发现私人配置或数据库：' + file);
      assert.ok(!forbidden.test(entry.name), '发现特殊试验模块：' + file);
      if (entry.isDirectory()) { assert.ok(!['data','seed','course-browser','repair'].includes(entry.name), '禁止发行目录：' + file); scan(file); }
      else { files++; if (/\.(?:cjs|js|html|json|css|ps1)$/.test(entry.name)) {
        const text = fs.readFileSync(file, 'utf8');
        assert.ok(!forbidden.test(text), '发现特殊试验或临时维护接线：' + file);
        assert.ok(!/sk-[a-zA-Z0-9]{28,}|gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{30,}/.test(text), '疑似真实凭证：' + file);
      } }
    }
  }
  for (const name of ['desktop','extension','examples']) scan(path.join(root, name));
  for (const file of ['LICENSE','THIRD_PARTY_NOTICES.md','docs/ATTRIBUTION.md','docs/PRIVACY.md','desktop/vendor/Typr.LICENSE','desktop/vendor/FontTable.LICENSE','docs/licenses/README-guides.txt']) assert.ok(fs.existsSync(path.join(root, file)), '缺少许可或声明：' + file);
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, 'desktop/vendor/font-glyph-table.json'))).digest('hex'), 'fbc6ae3c795a46ca2bd0994e68e7cb90ca4d9a046f335512657760d9a4fdf875', '第三方字形表已变化，须重新审查');
  console.log(`PASS: ${version}，${files} 个应用文件；无特殊试验接线、私人数据和数据库，许可文件齐全。`);
  return { version, files };
}
if (require.main === module) auditRelease();
module.exports = { auditRelease };
