// Parse the published tk INSERT data as text. SQL statements are never executed.
function* readQuestionRows(text) {
  const inserts = /INSERT INTO `tk` \(`id`, `tm`, `da`, `type`, `newtm`\) VALUES\s*/g;
  let match;
  while ((match = inserts.exec(text))) {
    let cursor = inserts.lastIndex;
    const whitespace = () => { while (/\s/.test(text[cursor] || '') && cursor < text.length) cursor++; };
    while (true) {
      whitespace();
      if (text[cursor] !== '(') throw new Error(`题库数据行格式异常：${cursor}`);
      cursor++; const row = [];
      for (let column = 0; column < 5; column++) {
        whitespace(); let value = '';
        if (text[cursor] === "'") {
          cursor++; let closed = false;
          while (cursor < text.length) {
            const char = text[cursor++];
            if (char === '\\') {
              const escaped = text[cursor++];
              value += ({ n: '\n', r: '\r', t: '\t', b: '\b', '0': '\0', Z: '\x1a' })[escaped] ?? escaped;
            } else if (char === "'") {
              if (text[cursor] === "'") { value += "'"; cursor++; }
              else { closed = true; break; }
            } else value += char;
          }
          if (!closed) throw new Error('题库字符串未闭合');
        } else {
          const start = cursor; while (cursor < text.length && !/[,)]/.test(text[cursor])) cursor++;
          const token = text.slice(start, cursor).trim();
          if (!/^-?\d+$/.test(token) && token !== 'NULL') throw new Error('题库字段包含非数据表达式');
          value = token === 'NULL' ? null : Number(token);
        }
        row.push(value); whitespace();
        const delimiter = column === 4 ? ')' : ',';
        if (text[cursor++] !== delimiter) throw new Error(`题库字段分隔异常：${cursor}`);
      }
      yield row;
      whitespace();
      if (text[cursor] === ';') { cursor++; break; }
      if (text[cursor++] !== ',') throw new Error('题库数据行分隔异常');
    }
    inserts.lastIndex = cursor;
  }
}
module.exports = { readQuestionRows };
