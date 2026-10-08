'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createComponentStyleStore } = require('../storage/component-style-store');
const { installComponentStyle } = require('./component-style-install');
const { saveWebFiles, webFilePath, webResourceUrl } = require('./component-web-files');
const { normalizeSceneConfig } = require('./scene-components');
const { getClockConfig } = require('./clock-contract');
const { DEFAULT_SETTINGS } = require('../storage/settings-defaults');
const { createLayout } = require('../shared/danmaku-layout');
const { createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { createTextBoxDefaults } = require('../../public/js/shared/text-box-config.js');
const { SCENE_TYPES } = require('../../public/js/shared/scene-components.js');
const { detectComponentCssEngine } = require('../../public/js/shared/component-css-style.js');
const { webFileReferences, localWebReference, webDocumentBase } = require('./component-web-references');

const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };

function cssBaseConfig(type) {
  if (type === 'clock') return getClockConfig(DEFAULT_SETTINGS);
  if (type === 'danmaku') return { style: 'transparent', fullscreenDurationSeconds: 6, styleOptions: {}, layout: createLayout() };
  if (type === 'queue') return {};
  if (type === 'overtime') return { path: '', fit: 'cover' };
  if (type === 'text-box') return createTextBoxDefaults();
  return createSceneExtraDefaults(type);
}

function checkReferences(directory, entry, visited = new Set(), documentEntry = entry, css = []) {
  if (visited.has(`${entry}:${documentEntry}`) || !/\.(?:html?|css|m?js)$/i.test(entry)) return css;
  visited.add(`${entry}:${documentEntry}`);
  const source = fs.readFileSync(path.join(directory, entry), 'utf8');
  if (source.includes('\u0000')) fail('网页或 CSS 文件包含无效的文本内容。');
  if (/\.html?$/i.test(entry)) documentEntry = webDocumentBase(source, entry);
  if (/\.css$/i.test(entry)) css.push(source);
  const references = webFileReferences(source, entry, documentEntry);
  for (const reference of references) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) {
      if (/^file:/i.test(reference)) fail('素材引用了电脑绝对路径，请将资源改为素材文件夹内的相对路径。');
      continue;
    }
    const value = localWebReference(reference);
    if (!value) continue;
    if (value.startsWith('/')) fail(`素材使用网站根路径 ${value.slice(0, 90)}；请使用作者提供的浏览器源地址，或改为相对路径。`);
    let target;
    try { target = webFilePath(path.posix.join(path.posix.dirname(entry), decodeURIComponent(value))); }
    catch { fail(`素材引用了文件夹之外的资源：${value.slice(0, 90)}`); }
    if (!fs.existsSync(path.join(directory, target))) fail(`缺少配套资源：${target.slice(0, 100)}。请选整套素材文件夹，保留原目录结构。`);
    checkReferences(directory, target, visited, documentEntry, css);
  }
  return css;
}

function createComponentWebLibrary(dataDir) {
  const store = createComponentStyleStore(dataDir);
  return {
    async add(files, description, authorize) {
      if (!description || !SCENE_TYPES.includes(description.type)) fail('请选择组件类型。');
      const entry = webFilePath(description.entry);
      const html = /\.html?$/i.test(entry);
      if (!html && !/\.css$/i.test(entry)) fail('请选择 HTML 或 CSS 文件。');
      const { width = 800, height = 600 } = description;
      if (![width, height].every(size => Number.isInteger(size) && size >= 32 && size <= 7680)) fail('网页宽高须为 32–7680 的整数。');
      const name = description.name || path.posix.basename(entry).replace(/\.[^.]+$/, '');
      if (typeof name !== 'string' || !name.trim() || name.length > 80) fail('样式名称须为 1–80 字。');
      const id = randomUUID();
      const directory = path.join(store.directory(id, true), 'web');
      try {
        const { bytes } = await saveWebFiles(directory, files);
        const filename = path.join(directory, entry);
        if (!fs.existsSync(filename)) fail('未找到选中的 HTML / CSS 文件。');
        const stylesheets = checkReferences(directory, entry);
        const text = fs.readFileSync(filename, 'utf8');
        if (!text.trim() || (html && !/<[a-z!][\s\S]*>/i.test(text))) fail('文件内容不是有效的 HTML / CSS。');
        const styleId = randomUUID();
        const src = webResourceUrl(id, entry);
        let config;
        if (html) config = normalizeSceneConfig('browser', { url: src, viewportWidth: width, viewportHeight: height });
        else {
          if (description.type === 'browser') fail('CSS 需要配套网页。请选择对应组件，或在原网页工具中应用 CSS 后导入地址。');
          let engine;
          try { engine = detectComponentCssEngine(stylesheets.join('\n'), description.type); }
          catch (error) { fail(error.message); }
          config = normalizeSceneConfig(description.type, { ...cssBaseConfig(description.type),
            cssStyle: { id: styleId, src, engine, width, height } });
        }
        authorize();
        const style = { id: styleId, type: html ? 'browser' : description.type, category: description.type, name: name.trim(), config };
        store.stage({ id, name: style.name, createdAt: Date.now(), styles: [style], bytes });
        return await installComponentStyle(store, id, authorize);
      } finally { store.removePending(id); }
    },
  };
}

module.exports = { createComponentWebLibrary, checkReferences };
