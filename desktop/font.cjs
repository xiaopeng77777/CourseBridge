const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
function createFontDecoder(dataDir) {
  const cache = new Map();
  let table;
  const custom = path.join(dataDir, 'font-glyph-table.json');
  const file = fs.existsSync(custom) ? custom : path.join(__dirname, 'vendor/font-glyph-table.json');
  if (fs.existsSync(file) && fs.statSync(file).size < 2000000) {
    try {
      const candidate = JSON.parse(fs.readFileSync(file, 'utf8'));
      const entries = Object.entries(candidate).filter(([key])=>!['author','namespace','license','version'].includes(key));
      if (entries.length <= 50000 && entries.every(([k,v]) => /^[0-9a-f]{8}$/.test(k) && Number.isInteger(v) && v >= 0 && v <= 0x10ffff)) table = Object.fromEntries(entries);
    } catch { /* An unavailable reference table must not prevent the desktop from opening. */ }
  }
  const script = new vm.Script(fs.readFileSync(path.join(__dirname, 'vendor/Typr.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'vendor/Typr.U.js'), 'utf8') + `
    const font = Typr.parse(fontBytes)[0];
    const decoded = Object.create(null), unknown = [];
    let glyphs = 0;
    for (let code = 0x4e00; code <= 0x9fff; code++) {
      const glyph = Typr.U.codeToGlyph(font, code);
      if (!glyph) continue;
      if (++glyphs > 4096) throw new Error('字形过多');
      const outline = Typr.U.glyphToPath(font, glyph);
      const key = fingerprint(JSON.stringify({cmds:outline.cmds,crds:outline.crds}));
      const plain = glyphTable[key];
      if (plain === undefined) unknown.push(code); else decoded[code] = String.fromCodePoint(plain);
    }
    ({ map: decoded, unknown, available: Object.keys(decoded).length > 0 });
  `, { filename: 'coursebridge-font-parser' });
  return function decode(base64) {
    if (!table) return { map: {}, unknown: [], available: false };
    if (typeof base64 !== 'string' || base64.length > 360000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('字体数据无效');
    const key = createHash('sha256').update(base64).digest('hex');
    if (cache.has(key)) return cache.get(key);
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length < 12 || bytes.length > 262144 || bytes.readUInt32BE(0) !== 0x00010000) throw new Error('不支持的字体格式');
    const count = bytes.readUInt16BE(4);
    if (!count || count > 64 || 12 + count * 16 > bytes.length) throw new Error('字体目录无效');
    for (let i=0;i<count;i++) { const at=12+i*16, offset=bytes.readUInt32BE(at+8), size=bytes.readUInt32BE(at+12); if(offset+size>bytes.length) throw new Error('字体表越界'); }
    const result = script.runInNewContext({ window: { TextDecoder, TextEncoder }, fontBytes: Uint8Array.from(bytes).buffer, glyphTable: table, fingerprint: text => createHash('md5').update(text).digest('hex').slice(24) }, { timeout: 2500 });
    if (cache.size >= 20) cache.delete(cache.keys().next().value);
    // Clone out of the VM so callers only receive plain JSON data.
    const output = JSON.parse(JSON.stringify(result)); cache.set(key, output); return output;
  };
}
module.exports = { createFontDecoder };
