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

    getComponentSize(scope, type) {
      const row = db.prepare('SELECT width, height FROM component_output_sizes WHERE owner_scope = ? AND component_type = ?').get(scope, type);
      return row ? { width: row.width, height: row.height } : null;
    },

    publish({ scope, id, expectedRevision, document, componentSizes = {} }) {
      db.exec('SAVEPOINT publish_component_scene');
      try {
        const published = decodeScene(db.prepare(`
          UPDATE component_scenes SET published_json = ?, published_version = published_version + 1
          WHERE owner_scope = ? AND id = ? AND revision = ? RETURNING *
        `).get(JSON.stringify(document), scope, id, expectedRevision));
        if (published) {
          const saveSize = db.prepare(`INSERT INTO component_output_sizes (owner_scope, component_type, width, height)
            VALUES (?, ?, ?, ?) ON CONFLICT (owner_scope, component_type)
            DO UPDATE SET width = excluded.width, height = excluded.height`);
          for (const [type, size] of Object.entries(componentSizes)) saveSize.run(scope, type, size.width, size.height);
        }
        db.exec('RELEASE publish_component_scene');
        return published;
      } catch (error) {
        db.exec('ROLLBACK TO publish_component_scene');
        db.exec('RELEASE publish_component_scene');
        throw error;
      }
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
