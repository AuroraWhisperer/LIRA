'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { crc32 } = require('node:zlib');
const yauzl = require('yauzl');
const { createComponentStyleStore } = require('../storage/component-style-store');
const { installComponentStyle } = require('./component-style-install');
const { receiveMedia, saveMedia, MAX_MEDIA_BYTES } = require('./component-media-files');
const { normalizeSceneConfig } = require('./scene-components');
const { getClockConfig } = require('./clock-contract');
const { DEFAULT_SETTINGS } = require('../storage/settings-store');
const { createLayout } = require('../shared/danmaku-layout');
const { createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { createMediaStyle, MEDIA_STYLE_TYPES } = require('../../public/js/shared/component-media-style.js');
const { getBackgroundAppearance } = require('../../public/js/shared/background-appearance.js');
const { COMPONENT_RESOURCE_PRESETS } = require('../../public/js/shared/component-resource-style.js');

const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const title = value => typeof value === 'string' && value.trim() && value.length <= 80 ? value.trim() : fail('请填写不超过 80 字的名称。');

function baseConfig(type) {
  if (type === 'queue') return {};
  if (type === 'clock') return { ...getClockConfig(DEFAULT_SETTINGS), style: 'digital' };
  if (type === 'danmaku') return { style: 'transparent', fullscreenDurationSeconds: 6, styleOptions: {}, layout: createLayout() };
  const config = createSceneExtraDefaults(type);
  // Resolve the mode after authored values are merged, including pre-standard ZIPs.
  if (type === 'background') delete config.colorProcessing;
  return config;
}

function createStyle(packId, description, media) {
  if (!MEDIA_STYLE_TYPES.includes(description.type)) fail('素材包含有当前版本不支持的组件。');
  const id = randomUUID();
  const mediaStyle = { ...createMediaStyle(description.type, { kind: media.kind }), ...description.media,
    id, src: `/component-media/${packId}/${media.basename}`, kind: media.kind, width: description.width, height: description.height };
  const config = normalizeSceneConfig(description.type, { ...baseConfig(description.type), ...description.config, mediaStyle });
  if (description.type === 'background') {
    if (description.config?.volume === undefined) config.volume = mediaStyle.volume;
    config.backgroundDefaults = getBackgroundAppearance(config);
  }
  return { id, type: description.type, name: title(description.name), config };
}

function createResourceStyle(packId, description, files) {
  const preset = Object.hasOwn(COMPONENT_RESOURCE_PRESETS, description.preset) && COMPONENT_RESOURCE_PRESETS[description.preset];
  if (!preset || preset.type !== description.type) fail('此素材包需要更新客户端才能使用。');
  const allowed = preset.resources.concat(preset.optionalResources || []);
  if (description.file || description.media || !description.resources
    || preset.resources.some(key => !Object.hasOwn(description.resources, key))
    || Object.keys(description.resources).some(key => !allowed.includes(key))) fail('素材包资源清单无效。');
  const source = name => {
    const file = files.get(name);
    if (!file) fail(`素材包缺少素材：${String(name).slice(0, 100)}`);
    return `/component-media/${packId}/${file.basename}`;
  };
  const id = randomUUID();
  const resourceStyle = { id, preset: description.preset, preview: source(description.preview),
    width: description.width, height: description.height,
    resources: Object.fromEntries(Object.keys(description.resources).map(key => [key, source(description.resources[key])])) };
  const config = normalizeSceneConfig(description.type, { ...baseConfig(description.type), ...preset.config, ...description.config, resourceStyle });
  if (description.type === 'background') config.backgroundDefaults = getBackgroundAppearance(config);
  return { id, type: description.type, name: title(description.name), config };
}

async function* entryBytes(zip, entry) {
  let checksum = 0;
  for await (const chunk of await zip.openReadStreamPromise(entry)) {
    checksum = crc32(chunk, checksum);
    yield chunk;
  }
  if (checksum !== entry.crc32) fail('素材包文件已损坏，请重新下载。');
}

function createComponentStyleLibrary(dataDir) {
  const store = createComponentStyleStore(dataDir);
  return {
    list: () => store.list(),
    remove: id => store.remove(id),
    'remove-pack': id => store.removePack(id),
    cancel: id => { store.removePending(id); return { id }; },
    install: (id, authorize = () => {}) => installComponentStyle(store, id, authorize),
    async add(stream, description, authorize) {
      const id = randomUUID();
      try {
        const media = await saveMedia(stream, store.directory(id, true), description.filename);
        const style = createStyle(id, description, media);
        authorize();
        store.stage({ id, name: style.name, createdAt: Date.now(), styles: [style], bytes: media.size });
        return await installComponentStyle(store, id, authorize);
      } finally { store.removePending(id); }
    },
    async inspect(stream, authorize) {
      const id = randomUUID();
      const directory = store.directory(id, true);
      await fs.promises.mkdir(directory, { recursive: true });
      const archive = path.join(directory, 'upload.zip');
      let complete = false;
      let zip;
      try {
        const uploaded = await receiveMedia(stream, archive, MAX_PACKAGE_BYTES);
        zip = await yauzl.openPromise(archive, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
        const files = new Map();
        const names = new Set();
        let manifest;
        let total = 0;
        let count = 0;
        for await (const entry of zip.eachEntry()) {
          const name = entry.fileName;
          if (++count > 256 || name.length > 240 || name.includes(':') || name.includes('\\') || name.startsWith('/')
            || name.split('/').some(part => part === '..' || part === '.') || names.has(name.toLowerCase())) fail('压缩包包含无效或重复路径。');
          names.add(name.toLowerCase());
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (mode && mode !== 0x8000 && mode !== 0x4000 || entry.isEncrypted()) fail('素材包不能包含链接或加密文件。');
          if (name.endsWith('/')) continue;
          total += entry.uncompressedSize;
          if (entry.uncompressedSize > MAX_MEDIA_BYTES || total > MAX_PACKAGE_BYTES * 2) fail('素材包解压后体积过大。');
          if (name === 'lira-pack.json') {
            if (entry.uncompressedSize > 256 * 1024) fail('素材包清单过大。');
            const chunks = [];
            for await (const chunk of entryBytes(zip, entry)) chunks.push(chunk);
            manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } else if (/\.(txt|md)$/i.test(name)) {
            if (entry.uncompressedSize > 256 * 1024) fail('素材包说明文件过大。');
            for await (const _chunk of entryBytes(zip, entry)) { /* Validate attachments without installing them. */ }
          } else {
            files.set(name, await saveMedia(entryBytes(zip, entry), directory, name, { packageResource: true }));
          }
        }
        if (!manifest || ![1, 2].includes(manifest.schemaVersion) || !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(manifest.id)
          || !/^\d+\.\d+\.\d+$/.test(manifest.version) || !Array.isArray(manifest.styles)
          || !manifest.styles.length || manifest.styles.length > 64) fail('这不是 LIRA 标准素材包。第三方素材请先解压，再到对应组件添加文件。');
        const styles = manifest.styles.map(description => {
          if (!description || typeof description !== 'object') fail('素材包样式清单无效。');
          if (description.preset && manifest.schemaVersion === 2) return createResourceStyle(id, description, files);
          const media = files.get(description.file);
          if (!media) fail(`素材包缺少素材：${String(description.file).slice(0, 100)}`);
          return createStyle(id, description, media);
        });
        authorize();
        const pack = { id, packageId: manifest.id, name: title(manifest.name), version: manifest.version,
          createdAt: Date.now(), digest: uploaded.digest, styles, bytes: total };
        store.stage(pack);
        const preview = store.describe(pack);
        complete = true;
        return preview;
      } finally {
        zip?.close();
        await fs.promises.rm(archive, { force: true });
        if (!complete) store.removePending(id);
      }
    },
  };
}

module.exports = { createComponentStyleLibrary, MAX_PACKAGE_BYTES };
