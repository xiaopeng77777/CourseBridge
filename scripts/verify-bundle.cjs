const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const bundle = path.resolve(process.argv[2] || path.join(root, 'outputs/CourseBridge-Windows'));
const app = path.join(bundle, 'resources/app');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
assert.equal(JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version, version);
let checked = 0;
function same(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) same(from, to);
    else { assert.equal(hash(to), hash(from), '源文件与发行包不一致：' + from); checked++; }
  }
}
for (const name of ['desktop', 'extension', 'examples', 'docs']) same(path.join(root, name), path.join(app, name));
same(path.join(root, 'extension'), path.join(bundle, 'extension'));
const blocked = /^(?:data|seed|course-browser|repair|Cookies|Login Data|settings\.json|enncy-config\.json|deepseek-config\.json|question-library\.json|last-status\.json|course-pages\.json|usage-study\.cjs)$/i;
let total = 0;
function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), '发行包不应包含链接');
    assert.ok(!blocked.test(entry.name) && !/\.(sqlite|sql|db|jsonl)$/i.test(entry.name), '禁止的发行文件：' + entry.name);
    if (entry.isDirectory()) scan(path.join(dir, entry.name)); else total++;
  }
}
scan(bundle);
for (const file of ['LICENSE.electron.txt','LICENSES.chromium.html','resources/app/node_modules/playwright-core/LICENSE','resources/app/node_modules/playwright-core/NOTICE']) assert.ok(fs.existsSync(path.join(bundle, file)), '缺少运行依赖许可：' + file);
assert.ok(!fs.existsSync(path.join(bundle, 'runtime')), '公开安装包不应重新分发浏览器二进制');
console.log(JSON.stringify({ version, sourceFilesVerified: checked, totalFiles: total, dataFree: true, licensesPresent: true }));
