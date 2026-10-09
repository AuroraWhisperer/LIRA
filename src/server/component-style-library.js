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
const { createSceneExtraDefaults, SCENE_EXTRA_COMPONENTS } = require('../../public/js/shared/scene-extra-components.js');
const { SCENE_TYPES } = require('../../public/js/shared/scene-components.js');
const { createMediaStyle, MEDIA_STYLE_TYPES } = require('../../public/js/shared/component-media-style.js');
const { getBackgroundAppearance } = require('../../public/js/shared/background-appearance.js');
const { COMPONENT_RESOURCE_PRESETS } = require('../../public/js/shared/component-resource-style.js');

const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const title = value => typeof value === 'string' && value.trim() && value.length <= 80 ? value.trim() : fail('请填写不超过 80 字的名称。');

function validateImportTarget(target) {
  if (target !== undefined && target !== 'suite' && !SCENE_TYPES.includes(target)) fail('导入入口无效，请从对应组件的「添加样式」或套装的「导入套装」重新选择文件。');
}

function checkImportTarget(pack, target) {
  if (target === undefined) return;
  const category = pack.styles[0].category || pack.styles[0].type;
  if (pack.isSuite ? target === 'suite' : target === category) return;
  const name = SCENE_EXTRA_COMPONENTS[category]?.title || ({ clock: '时钟', danmaku: '弹幕姬', queue: '点歌板' })[category];
  throw Object.assign(new Error(pack.isSuite ? '这是套装，请从「添加组件 → 套装 → 导入套装」导入。'
    : `这是${name}样式包，请从「添加组件 → ${name} → 添加样式」导入。`), {
    statusCode: 400, code: 'STYLE_IMPORT_TARGET_MISMATCH', importTarget: pack.isSuite ? 'suite' : category,
    importTargetName: pack.isSuite ? '套装' : name,
  });
}

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
    config({ id, patch }, authorize = () => {}) {
      authorize();
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).some(key => ['resourceStyle', 'mediaStyle', 'cssStyle'].includes(key))) fail('只能调整样式参数，不能替换素材。');
      return store.updateConfig(id, style => {
        if (!style.config.resourceStyle) fail('此样式不支持客户端参数设置。');
        return normalizeSceneConfig(style.type, { ...style.config, ...patch });
      });
    },
    remove: id => store.remove(id),
    'remove-pack': id => store.removePack(id),
    cancel: id => store.cancelPending(id),
    install(id, authorize = () => {}, target) {
      validateImportTarget(target);
      return installComponentStyle(store, id, () => {
        authorize();
        if (target !== undefined) checkImportTarget(store.describe(store.pending(id)), target);
      });
    },
    async add(stream, description, authorize) {
      const id = randomUUID();
      store.beginPending(id);
      try {
        const media = await saveMedia(stream, store.directory(id, true), description.filename);
        const style = createStyle(id, description, media);
        authorize();
        store.stage({ id, name: style.name, createdAt: Date.now(), styles: [style], bytes: media.size });
        return await installComponentStyle(store, id, authorize);
      } finally { store.endPending(id); store.removePending(id); }
    },
    async inspect(stream, authorize, target) {
      validateImportTarget(target);
      const id = randomUUID();
      const directory = store.directory(id, true);
      const archive = path.join(directory, 'upload.zip');
      let complete = false;
      let zip;
      store.beginPending(id);
      try {
        await fs.promises.mkdir(directory, { recursive: true });
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
        const preview = store.describe(pack);
        checkImportTarget(preview, target);
        store.stage(pack);
        complete = true;
        return preview;
      } finally {
        store.endPending(id);
        zip?.close();
        await fs.promises.rm(archive, { force: true });
        if (!complete) store.removePending(id);
      }
    },
  };
}

module.exports = { createComponentStyleLibrary, MAX_PACKAGE_BYTES };
