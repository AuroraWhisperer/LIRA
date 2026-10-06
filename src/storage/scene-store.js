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
    bindCanvas(scope, id) {
      db.prepare(`INSERT INTO component_canvas (owner_scope, output_scene_id, active_scene_id)
        SELECT owner_scope, id, id FROM component_scenes WHERE owner_scope = ? AND id = ?
        ON CONFLICT (owner_scope) DO NOTHING`).run(scope, id);
      const row = db.prepare('SELECT * FROM component_canvas WHERE owner_scope = ?').get(scope);
      return row ? { outputId: row.output_scene_id, activeSceneId: row.active_scene_id } : null;
    },

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

    publish({ scope, id, expectedRevision, document, componentSizes = {}, preset }) {
      db.exec('SAVEPOINT publish_component_scene');
      try {
        if (preset && !db.prepare(`SELECT 1 FROM component_scenes AS source
          JOIN component_scenes AS output ON output.owner_scope = source.owner_scope
          JOIN component_canvas AS canvas ON canvas.owner_scope = source.owner_scope AND canvas.output_scene_id = output.id
          WHERE source.owner_scope = ? AND source.id = ? AND source.revision = ?
            AND output.id = ? AND output.published_version = ?`)
          .get(scope, preset.id, preset.revision, id, preset.expectedPublishedVersion)) {
          db.exec('RELEASE publish_component_scene');
          return null;
        }
        const published = decodeScene(db.prepare(`
          UPDATE component_scenes SET published_json = ?, published_version = published_version + 1
          WHERE owner_scope = ? AND id = ? AND revision = ? RETURNING *
        `).get(JSON.stringify(document), scope, id, expectedRevision));
        if (published) {
          if (preset) db.prepare('UPDATE component_canvas SET active_scene_id = ? WHERE owner_scope = ?')
            .run(preset.id, scope);
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
