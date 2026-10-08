'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { WEB_MIME, webFilePath } = require('../server/component-web-files');
const { webFileReferences, localWebReference, webDocumentBase } = require('../server/component-web-references');
const { MAX_MEDIA_BYTES } = require('../server/component-media-files');
const { MAX_PACKAGE_BYTES } = require('../server/component-style-library');

const SOURCE_EXTENSIONS = ['html', 'htm', 'css', 'zip', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm'];

function isPersonalRoot(directory) {
  return directory === path.parse(directory).root || directory.toLowerCase() === process.env.USERPROFILE?.toLowerCase()
    || /^(Desktop|Documents|Downloads|Pictures|Music|Videos)$/i.test(path.basename(directory));
}

async function packageRoot(selected) {
  let root = path.dirname(selected);
  const pending = [{ current: selected, documentEntry: selected }]; const visited = new Set();
  while (pending.length) {
    let { current, documentEntry } = pending.shift();
    if (visited.has(current) || !/\.(?:html?|css|m?js)$/i.test(current)) continue;
    visited.add(current);
    if (visited.size > 1024) throw Object.assign(new Error('素材引用的文件过多。'), { statusCode: 400 });
    const stat = await fs.promises.lstat(current).catch(() => null);
    if (!stat?.isFile() || stat.size > 4 * 1024 * 1024) continue;
    const source = await fs.promises.readFile(current, 'utf8');
    if (/\.html?$/i.test(current)) documentEntry = webDocumentBase(source, current);
    for (const reference of webFileReferences(source, current, documentEntry)) {
      const value = localWebReference(reference);
      if (!value || value.startsWith('/')) continue;
      const target = path.resolve(path.dirname(current), decodeURIComponent(value));
      while (path.relative(root, target).split(path.sep)[0] === '..') {
        root = path.dirname(root);
        if (isPersonalRoot(root)) {
          throw Object.assign(new Error('资源引用超出素材文件夹，请选择完整的独立素材文件夹。'), { statusCode: 400 });
        }
      }
      pending.push({ current: target, documentEntry });
    }
  }
  return root;
}

async function* componentWebDirectory(root, relative = '') {
  for (const entry of await fs.promises.readdir(path.join(root, relative), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (name.split('/').length > 16) throw Object.assign(new Error('素材文件夹层级过深。'), { statusCode: 400 });
      yield* componentWebDirectory(root, name);
    } else if (entry.isFile() && Object.hasOwn(WEB_MIME, path.extname(entry.name).slice(1).toLowerCase())
      && !/^(package(?:-lock)?|tsconfig|jsconfig)\.json$/i.test(entry.name)) {
      yield { path: webFilePath(name), stream: fs.createReadStream(path.join(root, name)) };
    }
  }
}

function createComponentWebPicker({ dialog, getWindow }) {
  let picking = false;
  return async function pickComponentWebFile(kind) {
    if (!['auto', 'html', 'css'].includes(kind) || picking) throw Object.assign(new Error('请完成当前文件选择。'), { statusCode: 400 });
    picking = true;
    try {
      const result = await dialog.showOpenDialog(getWindow(), { title: '选择样式文件',
        properties: ['openFile'], filters: [{ name: '样式文件', extensions: kind === 'auto' ? SOURCE_EXTENSIONS : kind === 'html' ? ['html', 'htm'] : ['css'] }] });
      if (result.canceled || !result.filePaths?.[0]) return null;
      const selected = result.filePaths[0];
      const extension = path.extname(selected).slice(1).toLowerCase();
      const stat = await fs.promises.lstat(selected);
      if (!stat.isFile() || stat.isSymbolicLink() || !SOURCE_EXTENSIONS.includes(extension)) {
        throw Object.assign(new Error('请选择样式文件、图片、视频或样式压缩包。'), { statusCode: 400 });
      }
      if (kind === 'auto' && !['html', 'htm', 'css'].includes(extension)) {
        const limit = extension === 'zip' ? MAX_PACKAGE_BYTES : MAX_MEDIA_BYTES;
        if (stat.size > limit) throw Object.assign(new Error(`文件不能超过 ${limit / 1024 / 1024} MiB。`), { statusCode: 413 });
        return { name: path.basename(selected), size: stat.size, open: () => fs.createReadStream(selected) };
      }
      const root = await packageRoot(selected);
      if ((await fs.promises.lstat(selected)).isSymbolicLink() || (await fs.promises.lstat(root)).isSymbolicLink()
        || isPersonalRoot(root)) {
        throw Object.assign(new Error('请把第三方素材放在独立文件夹中，再选择其中的 HTML / CSS。'), { statusCode: 400 });
      }
      return { entry: path.relative(root, selected).split(path.sep).join('/'), files: componentWebDirectory(root) };
    } finally { picking = false; }
  };
}

module.exports = { createComponentWebPicker, componentWebDirectory };
