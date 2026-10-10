'use strict';

function decodeScene(row) {
  return row ? {
    document: JSON.parse(row.draft_json),
    revision: row.revision,
    isPreset: row.is_preset !== 0,
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
      return this.getCanvas(scope);
    },

    getCanvas(scope) {
      const row = db.prepare('SELECT * FROM component_canvas WHERE owner_scope = ?').get(scope);
      return row ? { outputId: row.output_scene_id, activeSceneId: row.active_scene_id } : null;
    },

    list(scope, { includeOutput = false } = {}) {
      return db.prepare('SELECT * FROM component_scenes WHERE owner_scope = ? AND (is_preset = 1 OR ?) ORDER BY id')
        .all(scope, Number(includeOutput)).map(decodeScene);
    },

    visitDocuments(visit) {
      for (const row of db.prepare('SELECT owner_scope, draft_json, published_json, is_preset FROM component_scenes').iterate()) {
        if (row.is_preset) visit(JSON.parse(row.draft_json), row.owner_scope);
        if (row.published_json !== null) visit(JSON.parse(row.published_json), row.owner_scope);
      }
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

    createBatch(entries) {
      db.exec('SAVEPOINT restore_component_scenes');
      try {
        for (const entry of entries) this.create(entry);
        db.exec('RELEASE restore_component_scenes');
      } catch (error) {
        db.exec('ROLLBACK TO restore_component_scenes');
        db.exec('RELEASE restore_component_scenes');
        throw error;
      }
    },

    save({ scope, id, expectedRevision, document }) {
      return decodeScene(db.prepare(`
        UPDATE component_scenes SET draft_json = ?, revision = revision + 1
        WHERE owner_scope = ? AND id = ? AND revision = ? AND is_preset = 1 RETURNING *
      `).get(JSON.stringify(document), scope, id, expectedRevision));
    },

    delete({ scope, id, expectedRevision, expectedCanvas, replacement }) {
      db.exec('SAVEPOINT delete_component_scene');
      try {
        const current = this.get(scope, id);
        const binding = this.getCanvas(scope);
        const output = binding && this.get(scope, binding.outputId);
        if (!current?.isPreset || current.revision !== expectedRevision
          || binding && (!expectedCanvas || binding.outputId !== expectedCanvas.outputId
            || binding.activeSceneId !== expectedCanvas.activeSceneId || output.publishedVersion !== expectedCanvas.publishedVersion)
          || replacement?.id && !db.prepare('SELECT 1 FROM component_scenes WHERE owner_scope = ? AND id = ? AND revision = ? AND is_preset = 1')
            .get(scope, replacement.id, replacement.revision)) {
          db.exec('RELEASE delete_component_scene');
          return null;
        }
        if (binding?.activeSceneId === id) {
          if (output.publishedVersion && !replacement) {
            db.exec('RELEASE delete_component_scene');
            return null;
          }
          if (replacement && !this.publish({ scope, id: output.document.id, expectedRevision: output.revision,
            document: replacement.document, componentSizes: replacement.componentSizes })) throw new Error('Output changed');
          db.prepare('UPDATE component_canvas SET active_scene_id = ? WHERE owner_scope = ?').run(replacement?.id || null, scope);
        }
        if (binding?.outputId === id) {
          const document = { ...current.document, items: [] };
          db.prepare('UPDATE component_scenes SET is_preset = 0, draft_json = ?, revision = revision + 1 WHERE owner_scope = ? AND id = ?')
            .run(JSON.stringify(document), scope, id);
        } else db.prepare('DELETE FROM component_scenes WHERE owner_scope = ? AND id = ?').run(scope, id);
        db.exec('RELEASE delete_component_scene');
        return { id };
      } catch (error) {
        db.exec('ROLLBACK TO delete_component_scene');
        db.exec('RELEASE delete_component_scene');
        throw error;
      }
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
          WHERE source.owner_scope = ? AND source.id = ? AND source.revision = ? AND source.is_preset = 1
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
