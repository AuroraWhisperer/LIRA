'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const SOURCE = 'public/overlay/danmaku-renderer-core.js';
const TARGET = 'public/js/overlays/danmaku-renderer-core.js';
const MANIFEST = 'src/shared/danmaku-source-manifest.json';
const readSource = (root, file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const hash = (source) => createHash('sha256').update(source).digest('hex');

// This is an explicit maintenance operation, never a build or runtime import.
function syncDanmakuSource({ root = path.resolve(__dirname, '..'), serverRoot, write = false } = {}) {
  if (write) {
    if (!serverRoot) throw new Error('--write requires an explicit --server-root.');
    const source = readSource(serverRoot, SOURCE);
    const manifest = { schemaVersion: 1, sourceRepository: 'lira-server', source: SOURCE, target: TARGET, sha256: hash(source) };
    fs.mkdirSync(path.dirname(path.join(root, TARGET)), { recursive: true });
    fs.mkdirSync(path.dirname(path.join(root, MANIFEST)), { recursive: true });
    fs.writeFileSync(path.join(root, TARGET), source);
    fs.writeFileSync(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.sourceRepository !== 'lira-server'
      || manifest.source !== SOURCE || manifest.target !== TARGET) throw new Error('Invalid danmaku source manifest.');
  if (hash(readSource(root, TARGET)) !== manifest.sha256) throw new Error('The desktop danmaku source differs from its pinned snapshot.');
  if (serverRoot && hash(readSource(serverRoot, SOURCE)) !== manifest.sha256) {
    throw new Error('The selected server source differs from the desktop snapshot; review before importing.');
  }
  return manifest;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const options = {};
    let mode;
    while (args.length) {
      const arg = args.shift();
      if (arg === '--server-root' && args[0] && !args[0].startsWith('--') && !options.serverRoot) options.serverRoot = path.resolve(args.shift());
      else if (['--check', '--write'].includes(arg) && !mode) mode = arg;
      else throw new Error('Usage: node scripts/sync-danmaku-source.cjs [--server-root <path>] [--check|--write]');
    }
    const manifest = syncDanmakuSource({ ...options, write: mode === '--write' });
    console.log(`Danmaku source ${mode === '--write' ? 'imported' : 'verified'}: ${manifest.sha256}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { syncDanmakuSource };
