'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createComponentStyleStore } = require('../storage/component-style-store');
const { beginStyleFileUse, endStyleFileUse, listStyleFiles } = require('../storage/component-style-files');
const { collectStyleReferences } = require('./component-library-maintenance');
const { receiveMedia, identifyMedia } = require('./component-media-files');
const { checkReferences } = require('./component-web-library');
const { MAX_BACKUP_BYTES, MAX_BACKUP_FILES, invalidBackup, backupFileName, encodeBackup, extractBackup } = require('./component-library-archive');
const { transferId, remapReferences, portableDocuments, validateBackupManifest } = require('./component-library-transfer-contract');

function referencedFiles(value, result = new Set()) {
  if (typeof value === 'string') {
    if (/^\/component-(media|web)\//.test(value)) {
      const match = /^\/component-(media|web)\/([a-f0-9-]{36})\/(.+)$/.exec(value);
      if (!match) throw invalidBackup();
      result.add(backupFileName(`packages/${match[2]}/${match[1] === 'web' ? 'web/' : ''}${decodeURIComponent(match[3])}`));
    } else if (value.startsWith('/scene-text-images/')) result.add(backupFileName(`images/${value.slice('/scene-text-images/'.length)}`));
  } else if (value && typeof value === 'object') for (const child of Object.values(value)) referencedFiles(child, result);
  return result;
}

function createComponentLibraryTransfer({ dataDir, scenes }) {
  const store = createComponentStyleStore(dataDir);
  const capture = () => {
    if (!scenes?.captureBackup || !scenes?.restoreBackup) throw Object.assign(new Error('场景尚未准备完成，请稍后重试。'), { statusCode: 503 });
    return scenes.captureBackup();
  };
  async function validateFiles(manifest, directory, authorize) {
    listStyleFiles(directory);
    const files = [];
    for (const file of manifest.files) {
      const name = backupFileName(file.name);
      const filename = path.join(directory, name);
      const stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.bytes) throw invalidBackup();
      const hash = createHash('sha256');
      for await (const bytes of fs.createReadStream(filename)) { authorize(); hash.update(bytes); }
      const digest = hash.digest('hex');
      files.push({ name, bytes: stat.size, sha256: digest });
      if (name.includes('/web/')) {
        if (/\.(html?|css|m?js|json)$/i.test(name) && stat.size > 4 * 1024 * 1024) throw invalidBackup();
      } else {
        if (name.startsWith('images/') && stat.size > 5 * 1024 * 1024) throw invalidBackup();
        await identifyMedia(filename, path.extname(name), { packageResource: !name.startsWith('images/') });
        if (name.startsWith('packages/') && path.basename(name).split('.')[0] !== digest) throw invalidBackup();
      }
    }
    validateBackupManifest(manifest, files);
    const required = referencedFiles([manifest.packages, manifest.documents]);
    const available = new Set(files.map(file => file.name));
    for (const name of required) if (!available.has(name)) throw invalidBackup('备份缺少场景或样式所需的配套文件。');
    for (const pack of manifest.packages) {
      for (const style of pack.styles) {
        const url = style.config.cssStyle?.src || (style.type === 'browser' ? style.config.url : '');
        if (url) {
          const prefix = `/component-web/${pack.id}/`;
          if (!url.startsWith(prefix)) throw invalidBackup();
          checkReferences(path.join(directory, 'packages', pack.id, 'web'), decodeURIComponent(url.slice(prefix.length)));
        }
      }
    }
    const packageIds = new Set(manifest.packages.map(pack => pack.id));
    if (files.some(file => file.name.startsWith('packages/') && !packageIds.has(file.name.split('/')[1]))) throw invalidBackup();
  }

  return {
    async *backup(authorize) {
      const session = capture(); authorize();
      const portable = portableDocuments(session.documents);
      const index = store.read();
      const references = collectStyleReferences(portable.documents);
      const selected = new Set();
      for (let changed = true; changed;) {
        changed = false;
        for (const pack of index.packages) if (!selected.has(pack.id)
          && (!pack.removed && pack.styles.some(style => !style.removed) || references.has(pack.id) || pack.styles.some(style => references.has(style.id)))) {
          selected.add(pack.id); collectStyleReferences(pack.styles, references); changed = true;
        }
      }
      const packages = index.packages.filter(pack => selected.has(pack.id));
      const files = [];
      for (const pack of packages) {
        for (const file of listStyleFiles(store.directory(pack.id))) if (file.name !== 'package.json') {
          files.push({ name: backupFileName(`packages/${pack.id}/${file.name}`), file: file.file });
        }
      }
      for (const name of referencedFiles([packages, portable.documents])) if (name.startsWith('images/')) {
        const root = path.join(path.resolve(dataDir), 'scene-text-images');
        if (fs.lstatSync(root).isSymbolicLink()) throw invalidBackup();
        const file = path.join(root, name.slice('images/'.length));
        if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw invalidBackup();
        files.push({ name, file });
      }
      if (files.length >= MAX_BACKUP_FILES) throw invalidBackup('备份文件数量过多，请减少素材后重试。');
      const available = new Set(files.map(file => file.name));
      for (const required of referencedFiles([packages, portable.documents])) if (!available.has(required)) throw invalidBackup('有配套素材缺失，请先重新导入原安装包。');
      for (const id of selected) beginStyleFileUse(store.directory(id));
      try {
        yield* encodeBackup(files, { format: 'lira-component-library-backup', version: 1, packages, ...portable }, () => { authorize(); session.assertCurrent(); });
      } finally { for (const id of selected) endStyleFileUse(store.directory(id)); }
    },

    async inspect(stream, authorize) {
      const session = capture();
      const id = randomUUID(); const directory = store.directory(id, true);
      store.beginPending(id); let complete = false;
      try {
        fs.mkdirSync(directory, { recursive: true });
        const archive = path.join(directory, 'backup.zip');
        const upload = await receiveMedia(stream, archive, MAX_BACKUP_BYTES);
        const check = () => { authorize(); session.assertCurrent(); };
        const { manifest, files } = await extractBackup(archive, directory, check);
        validateBackupManifest(manifest, files);
        await validateFiles(manifest, directory, check); check();
        fs.unlinkSync(archive);
        fs.writeFileSync(path.join(directory, 'restore.json'), JSON.stringify({ manifest, digest: upload.digest, binding: session.binding, scopeKey: session.scopeKey }), { flag: 'wx', mode: 0o600 });
        complete = true;
        return { id, packages: manifest.packages.length, scenes: manifest.documents.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), warnings: manifest.warnings };
      } finally { store.endPending(id); if (!complete) store.removePending(id); }
    },

    async restore(id, authorize) {
      const session = capture(); const directory = store.directory(id, true);
      store.beginPending(id);
      const staged = [];
      try {
        listStyleFiles(directory);
        const { manifest, digest, binding, scopeKey } = JSON.parse(fs.readFileSync(path.join(directory, 'restore.json'), 'utf8'));
        if (binding !== session.binding || scopeKey !== session.scopeKey) throw Object.assign(new Error('账号状态已变化，请重新选择备份。'), { statusCode: 409 });
        const check = () => { authorize(); session.assertCurrent(); };
        await validateFiles(manifest, directory, check); check();
        const identities = new Map();
        for (const pack of manifest.packages) {
          identities.set(pack.id, transferId(digest, 'package', pack.id));
          for (const style of pack.styles) identities.set(style.id, transferId(digest, 'style', style.id));
        }
        for (const file of manifest.files) if (file.name.startsWith('images/')) {
          const previous = path.basename(file.name).split('.')[0]; identities.set(previous, transferId(digest, 'image', previous));
        }
        const packs = manifest.packages.map(pack => ({ ...remapReferences(pack, identities),
          name: `${pack.name.slice(0, 75)}（备份）`,
          ...(pack.packageId ? { packageId: `backup.${transferId(digest, 'identity', pack.packageId)}` } : {}) }));
        for (const pack of packs) {
          store.beginPending(pack.id); staged.push(pack.id); store.stage(pack);
        }
        for (const file of manifest.files) {
          const parts = file.name.split('/');
          const target = parts[0] === 'packages' ? path.join(store.directory(identities.get(parts[1]), true), ...parts.slice(2))
            : path.join(path.resolve(dataDir), 'scene-text-images', remapReferences(parts[1], identities));
          fs.mkdirSync(path.dirname(target), { recursive: true });
          if (!fs.existsSync(target)) fs.copyFileSync(path.join(directory, file.name), target, fs.constants.COPYFILE_EXCL);
          else if (createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== file.sha256) throw invalidBackup('已有备份素材与文件内容不符，未覆盖原文件。');
        }
        const documents = manifest.documents.map(({ kind, document }) => ({ ...remapReferences(document, identities),
          id: transferId(digest, scopeKey, kind, document.id), title: `${document.title.slice(0, 69)}（${kind === 'published' ? '发布备份' : '备份'}）`,
          items: remapReferences(document.items, identities).map(item => ({ ...item, id: transferId(digest, scopeKey, kind, document.id, item.id) })) }));
        check();
        const result = store.restorePackages(packs, () => scenes.restoreBackup(documents, binding));
        store.removePending(id);
        return { ...result, packages: packs.length, warnings: manifest.warnings };
      } finally {
        store.endPending(id);
        for (const packId of staged) { store.endPending(packId); store.removePending(packId); }
      }
    },
  };
}

module.exports = { createComponentLibraryTransfer };
