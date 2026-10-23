const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createFontDecoder } = require('../desktop/font.cjs');
test('字体解析限制数据大小与格式，损坏的本地对照表不会阻止启动', t => {
  const root=path.join(__dirname,'../work/font-tests');fs.mkdirSync(root,{recursive:true});
  const dir=fs.mkdtempSync(path.join(root,'case-'));
  t.after(()=>{for(const file of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,file));fs.rmdirSync(dir);});
  const decode=createFontDecoder(dir);
  assert.throws(()=>decode('!不是字体!'),/字体数据无效/);
  assert.throws(()=>decode(Buffer.from('not a font file').toString('base64')),/字体格式/);
  assert.throws(()=>decode('A'.repeat(360004)),/字体数据无效/);
  fs.writeFileSync(path.join(dir,'font-glyph-table.json'),'{broken');
  assert.equal(createFontDecoder(dir)('AA==').available,false);
});
