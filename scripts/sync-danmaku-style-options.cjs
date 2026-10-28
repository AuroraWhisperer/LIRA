'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function styleOptionsNodeSource() {
  const source = fs.readFileSync(path.join(root, 'public/js/shared/danmaku-style-options.js'), 'utf8').replace(/\r\n/g, '\n');
  const contract = source.match(/^[\s\S]*?^export \{[^\n]+\};/m);
  if (!contract) throw new Error('Missing shared danmaku option exports.');
  return `${contract[0].replace(/^export \{/m, 'module.exports = {')}\n`;
}

if (require.main === module) {
  try {
    const mode = process.argv[2] || '--check';
    if (!['--check', '--write'].includes(mode) || process.argv.length > 3) {
      throw new Error('Usage: node scripts/sync-danmaku-style-options.cjs [--check|--write]');
    }
    const target = path.join(root, 'src/shared/danmaku-style-options.js');
    const expected = styleOptionsNodeSource();
    if (mode === '--write') fs.writeFileSync(target, expected);
    else if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== expected) {
      throw new Error('Danmaku options mirror is stale. Run with --write.');
    }
    console.log(`Danmaku options ${mode === '--write' ? 'generated' : 'verified'}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { styleOptionsNodeSource };
