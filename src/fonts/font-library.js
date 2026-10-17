'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveDataPaths } = require('../shared/data-paths');
const { downloadFont, sha256, isFont } = require('./font-download');
const catalog = require('./catalog.json');

function createFontLibrary({ dataDir, publicDir, fonts = catalog.fonts, fetch, timeoutMs } = {}) {
  const directory = resolveDataPaths(dataDir).fontsDir;
  const indexPath = path.join(directory, 'index.json');
  const installed = readIndex(indexPath, fonts);
  const bundled = new Set(fonts.filter(font => font.bundled.length && font.bundled.every(file =>
    fs.existsSync(path.join(publicDir, 'fonts', file.path)))).map(font => font.id));
  const listeners = new Set();
  let pending = null;
  let controller = null;
  let closed = false;
  let writes = Promise.resolve();
  let state = { status: 'idle', total: 0, completed: 0, failed: 0, currentFont: '', completedAt: '' };

  const filename = entry => path.join(directory, `${entry.sha256}.${entry.format}`);
  const getState = () => ({ ...state });
  function publish(patch) {
    state = { ...state, ...patch };
    if (!closed) for (const listener of listeners) {
      try { listener(getState()); } catch { continue; }
    }
    return getState();
  }

  async function readCached(entry) {
    if (!entry) return null;
    try {
      const bytes = await fs.promises.readFile(filename(entry));
      return sha256(bytes) === entry.sha256 && isFont(bytes, entry.format) ? bytes : null;
    } catch { return null; }
  }

  async function hasBundled(font) {
    if (!bundled.has(font.id)) return false;
    for (const file of font.bundled) {
      try {
        if (sha256(await fs.promises.readFile(path.join(publicDir, 'fonts', file.path))) === file.sha256) continue;
      } catch {
        bundled.delete(font.id);
        return false;
      }
      bundled.delete(font.id);
      return false;
    }
    return true;
  }

  function persist() {
    const body = JSON.stringify({ version: 1, fonts: installed });
    const write = writes.then(() => atomicWrite(indexPath, body));
    writes = write.catch(() => undefined);
    return write;
  }

  function initialize() {
    if (closed) return Promise.resolve(getState());
    if (pending) return pending;
    controller = new AbortController();
    const signal = controller.signal;
    pending = (async () => {
      publish({ status: 'checking', total: 0, completed: 0, failed: 0, currentFont: '', completedAt: '' });
      const missing = [];
      let indexChanged = false;
      for (const font of fonts) {
        signal.throwIfAborted();
        if (await readCached(font)) {
          indexChanged ||= installed[font.id]?.sha256 !== font.sha256;
          installed[font.id] = { sha256: font.sha256, format: font.format };
        } else if (await hasBundled(font)) {
          indexChanged ||= Boolean(installed[font.id]);
          delete installed[font.id];
        }
        else missing.push(font);
      }
      if (indexChanged) {
        await fs.promises.mkdir(directory, { recursive: true });
        await persist();
      }
      if (!missing.length) return publish({ status: 'ready' });
      await fs.promises.mkdir(directory, { recursive: true });
      publish({ status: 'downloading', total: missing.length });
      let next = 0;
      async function worker() {
        while (next < missing.length && !signal.aborted) {
          const font = missing[next++];
          publish({ currentFont: font.label });
          let failed = 0;
          try {
            const bytes = await downloadFont(font, { fetch, signal, timeoutMs });
            signal.throwIfAborted();
            await atomicWrite(filename(font), bytes);
            const previous = installed[font.id];
            installed[font.id] = { sha256: font.sha256, format: font.format };
            await persist();
            if (previous && previous.sha256 !== font.sha256
              && !Object.values(installed).some(entry => entry.sha256 === previous.sha256))
              await fs.promises.rm(filename(previous), { force: true }).catch(() => false);
          } catch { failed = 1; }
          publish({ completed: state.completed + 1, failed: state.failed + failed });
        }
      }
      await Promise.all([worker(), worker()]);
      signal.throwIfAborted();
      return publish({ status: state.failed ? 'error' : 'ready', currentFont: '', completedAt: new Date().toISOString() });
    })().catch(() => publish({ status: closed ? 'idle' : 'error', currentFont: '' })).finally(() => {
      pending = null;
      controller = null;
    });
    return pending;
  }

  async function readFont(id) {
    const font = fonts.find(entry => entry.id === id);
    if (!font) return null;
    const entry = installed[id];
    const bytes = await readCached(entry);
    // Existing faces remain available while a replacement downloads.
    return bytes ? { bytes, format: entry.format, sha256: entry.sha256 } : null;
  }

  function stylesheet() {
    return fonts.flatMap(font => {
      const faces = bundled.has(font.id) && !installed[font.id]
        ? font.bundled.map(file => ({ url: `/fonts/${file.path}`, unicodeRange: file.unicodeRange }))
        : installed[font.id] ? [{ url: `/font-library/${font.id}?v=${installed[font.id].sha256}` }] : [];
      return faces.map(face => `@font-face {\n  font-family: '${font.family}';\n  src: url('${face.url}');\n  font-weight: 400;\n  font-style: normal;\n  font-display: swap;${face.unicodeRange ? `\n  unicode-range: ${face.unicodeRange};` : ''}\n}`);
    }).join('\n\n');
  }

  async function close() {
    closed = true;
    controller?.abort();
    await pending;
    listeners.clear();
  }

  return { initialize, getState, readFont, stylesheet, close,
    onStateChanged(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}

function readIndex(filename, fonts) {
  const result = {};
  try {
    const index = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (index.version !== 1) return result;
    for (const font of fonts) {
      const entry = index.fonts?.[font.id];
      if (entry && /^[a-f0-9]{64}$/.test(entry.sha256) && ['ttf', 'woff2'].includes(entry.format))
        result[font.id] = { sha256: entry.sha256, format: entry.format };
    }
  } catch { return result; }
  return result;
}

async function atomicWrite(filename, bytes) {
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(temporary, bytes, { flag: 'wx' });
    await fs.promises.rename(temporary, filename);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
}

module.exports = { createFontLibrary };
