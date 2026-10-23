const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const temporary = path.join(root, 'work', 'browser-download-temp');
fs.mkdirSync(temporary, { recursive: true });
const cli = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'cli.js');
const result = spawnSync(process.execPath, [cli, 'install', 'chromium', '--no-shell'], {
  cwd: root, stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'runtime', 'browsers'), TEMP: temporary, TMP: temporary, TMPDIR: temporary }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
