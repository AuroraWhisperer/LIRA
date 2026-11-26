'use strict';

const { createHash } = require('node:crypto');
const { SceneError, normalizeSceneDocument, MAX_SCENE_BYTES } = require('./scene-contract');

function transferId(...values) {
  const hex = createHash('sha256').update(JSON.stringify(values)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function createSceneTransfer({ withOwner, store, browserSources, issueCapability, normalizeConfig, getDefaultConfig, getSharedAppearances }) {
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    captureBackup({ includeDocuments = true } = {}) {
      return withOwner((owner, assertCurrent) => {
        const documents = [];
        const records = includeDocuments ? store.list(owner.scope, { includeOutput: true }) : [];
        for (const record of records) {
          const decoded = browserSources.decode(record, owner.scope);
          for (const [kind, source] of [['saved', decoded.document], ['published', decoded.publishedDocument]]) {
            if (!source || kind === 'saved' && record.isPreset === false) continue;
            const items = source.items.map(item => item.appearance.mode === 'shared'
              ? { ...item, appearance: { mode: 'independent', config: getDefaultConfig(item.type) } } : item);
            // Native gift motion parameters belong to live settings. Its scene config stores only the style.
            const shared = getSharedAppearances?.(items.filter(item =>
              item.type !== 'gift-frame' || item.appearance.config.resourceStyle)) || {};
            const document = normalizeSceneDocument({ ...source, items: items.map(item => ({ ...item,
              appearance: { mode: 'independent', config: { ...item.appearance.config, ...shared[item.id] } } })) }, { normalizeConfig });
            documents.push({ kind, document });
          }
        }
        return { documents, binding: hash([owner.scope, owner.epoch]), scopeKey: hash(owner.scope), assertCurrent };
      });
    },
    restoreBackup(documents, binding, kinds) {
      return withOwner((owner, assertCurrent) => {
        if (binding !== hash([owner.scope, owner.epoch])) throw new SceneError('SCENE_OWNER_CHANGED', 409, '账号状态已变化，请重新选择备份。');
        const existing = []; const entries = [];
        for (const [index, input] of documents.entries()) {
          const document = normalizeSceneDocument(input, { normalizeConfig });
          let record = store.get(owner.scope, document.id);
          // A deleted preset may still own the fixed output URL. Keep that output
          // intact and reuse a separate preset ID on subsequent restores.
          if (record?.isPreset === false) {
            document.id = transferId('preset', document.id);
            record = store.get(owner.scope, document.id);
          }
          if (record) { existing.push(document.id); continue; }
          const { capability } = issueCapability(owner.scope, document.id, 1);
          const stored = browserSources.encode(document, owner.scope);
          const title = `${Array.from(stored.title).slice(0, 69).join('')}（${kinds?.[index] === 'published' ? '发布备份' : '备份'}）`;
          const named = { ...stored, title };
          entries.push({ scope: owner.scope, document: Buffer.byteLength(JSON.stringify(named)) <= MAX_SCENE_BYTES ? named : stored, capability });
        }
        assertCurrent();
        store.createBatch(entries);
        return { created: entries.length, existing: existing.length };
      });
    },
  };
}

module.exports = { createSceneTransfer, transferId };
