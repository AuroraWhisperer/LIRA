'use strict';

function decodeScene(row) {
  return row ? {
    document: JSON.parse(row.draft_json),
    revision: row.revision,
    publishedVersion: row.published_version,
    publishedDocument: row.published_json === null ? null : JSON.parse(row.published_json),
    capability: {
      version: row.capability_version,
      hash: row.capability_hash,
      encrypted: row.capability_encrypted,
    },
  } : null;
}

function createSceneStore(db) {
  return {
    list(scope) {
      return db.prepare('SELECT * FROM component_scenes WHERE owner_scope = ? ORDER BY id').all(scope).map(decodeScene);
    },

    get(scope, id) {
      return decodeScene(db.prepare('SELECT * FROM component_scenes WHERE owner_scope = ? AND id = ?').get(scope, id));
    },

    create({ scope, document, capability }) {
      return decodeScene(db.prepare(`
        INSERT INTO component_scenes
          (id, owner_scope, draft_json, capability_version, capability_hash, capability_encrypted)
        VALUES (?, ?, ?, ?, ?, ?) RETURNING *
      `).get(document.id, scope, JSON.stringify(document), capability.version, capability.hash, capability.encrypted));
    },

    save({ scope, id, expectedRevision, document }) {
      return decodeScene(db.prepare(`
        UPDATE component_scenes SET draft_json = ?, revision = revision + 1
        WHERE owner_scope = ? AND id = ? AND revision = ? RETURNING *
      `).get(JSON.stringify(document), scope, id, expectedRevision));
    },

    publish({ scope, id, expectedRevision, document }) {
      return decodeScene(db.prepare(`
        UPDATE component_scenes SET published_json = ?, published_version = published_version + 1
        WHERE owner_scope = ? AND id = ? AND revision = ? RETURNING *
      `).get(JSON.stringify(document), scope, id, expectedRevision));
    },

    rotate({ scope, id, expectedCapabilityVersion, capability }) {
      return decodeScene(db.prepare(`
        UPDATE component_scenes SET capability_version = ?, capability_hash = ?, capability_encrypted = ?
        WHERE owner_scope = ? AND id = ? AND capability_version = ? RETURNING *
      `).get(capability.version, capability.hash, capability.encrypted, scope, id, expectedCapabilityVersion));
    },
  };
}

module.exports = { createSceneStore };
