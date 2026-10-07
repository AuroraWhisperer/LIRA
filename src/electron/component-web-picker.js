'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { WEB_MIME, webFilePath } = require('../server/component-web-files');
const { webFileReferences, localWebReference, webDocumentBase } = require('../server/component-web-references');

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
    if (!['html', 'css'].includes(kind) || picking) throw Object.assign(new Error('请完成当前文件选择。'), { statusCode: 400 });
    picking = true;
    try {
      const result = await dialog.showOpenDialog(getWindow(), { title: kind === 'html' ? '选择 HTML（同时导入所在素材文件夹）' : '选择 CSS（同时导入所在素材文件夹）',
        properties: ['openFile'], filters: [{ name: kind === 'html' ? 'HTML 网页' : 'CSS 样式', extensions: kind === 'html' ? ['html', 'htm'] : ['css'] }] });
      if (result.canceled || !result.filePaths?.[0]) return null;
      const selected = result.filePaths[0];
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
