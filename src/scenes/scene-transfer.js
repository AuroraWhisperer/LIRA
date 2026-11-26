'use strict';

const { createHash } = require('node:crypto');
const { SceneError, normalizeSceneDocument } = require('./scene-contract');

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
    restoreBackup(documents, binding) {
      return withOwner((owner, assertCurrent) => {
        if (binding !== hash([owner.scope, owner.epoch])) throw new SceneError('SCENE_OWNER_CHANGED', 409, '账号状态已变化，请重新选择备份。');
        const existing = []; const entries = [];
        for (const input of documents) {
          const document = normalizeSceneDocument(input, { normalizeConfig });
          if (store.get(owner.scope, document.id)) { existing.push(document.id); continue; }
          const { capability } = issueCapability(owner.scope, document.id, 1);
          entries.push({ scope: owner.scope, document: browserSources.encode(document, owner.scope), capability });
        }
        assertCurrent();
        store.createBatch(entries);
        return { created: entries.length, existing: existing.length };
      });
    },
  };
}

module.exports = { createSceneTransfer };
