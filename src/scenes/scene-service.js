'use strict';

const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { SCENE_TYPES, SceneError, normalizeSceneId, normalizeSceneDocument } = require('./scene-contract');
const { createSceneOutputProjection } = require('./scene-output-projection');
const { createSceneBrowserSourceCodec } = require('./scene-browser-source-codec');
const { createSceneTransfer } = require('./scene-transfer');

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function matchesToken(token, hash) {
  return typeof token === 'string' && /^[0-9a-f]{64}$/.test(token)
    && typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)
    && timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(hash, 'hex'));
}

function managementDto(record) {
  return {
    document: record.document,
    revision: record.revision,
    publishedVersion: record.publishedVersion,
    hasPublication: record.publishedVersion > 0,
  };
}

function conflict() {
  return new SceneError('SCENE_CONFLICT', 409, '场景已更新，请重新加载后重试。');
}

function checkRevision(record, expectedRevision) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new SceneError('SCENE_INVALID_REVISION', 400, '场景版本无效。');
  }
  if (record.revision !== expectedRevision) throw conflict();
}

function createSceneService({ store, getOwner, secretCodec, normalizeConfig, getDefaultConfig, getDisplayData, getSharedAppearances, onOutputChanged = () => {} }) {
  const projections = createSceneOutputProjection();
  const browserSources = createSceneBrowserSourceCodec(secretCodec);
  function withOwner(work) {
    try {
      const current = getOwner();
      if (!current || typeof current.scope !== 'string' || !current.scope
        || !(typeof current.epoch === 'string' && current.epoch.length > 0
          || Number.isSafeInteger(current.epoch) && current.epoch >= 0)) {
        throw new SceneError('SCENE_OWNER_REQUIRED', 403, '请先登录后使用场景。');
      }
      const owner = { scope: current.scope, epoch: current.epoch };
      const assertCurrent = () => {
        const latest = getOwner();
        if (!latest || latest.scope !== owner.scope || latest.epoch !== owner.epoch) {
          throw new SceneError('SCENE_OWNER_CHANGED', 409, '账号状态已变化，请重新加载。');
        }
      };
      const result = work(owner, assertCurrent);
      assertCurrent();
      return result;
    } catch (error) {
      if (error instanceof SceneError) throw error;
      throw new SceneError('SCENE_OPERATION_FAILED', 500, '场景操作失败，请重试。');
    }
  }

  function readStored(scope, id) {
    const record = store.get(scope, id);
    if (!record) throw new SceneError('SCENE_NOT_FOUND', 404, '场景不存在。');
    return record;
  }

  const read = (scope, id) => browserSources.decode(readStored(scope, id), scope);
  function readPreset(scope, id) {
    const record = readStored(scope, id);
    if (!record.isPreset) throw new SceneError('SCENE_NOT_FOUND', 404, '场景不存在。');
    return browserSources.decode(record, scope);
  }

  function readOutputSource(input, owner) {
    const id = normalizeSceneId(input?.id);
    const { token, version } = input;
    const record = readStored(owner.scope, id);
    if (!matchesToken(token, record.capability.hash)) {
      throw new SceneError('SCENE_ACCESS_DENIED', 403, '场景来源凭据无效。');
    }
    if (version != null && (!Number.isSafeInteger(version) || version < 0)) {
      throw new SceneError('SCENE_INVALID_VERSION', 400, '场景发布版本无效。');
    }
    if (!record.publishedDocument) throw new SceneError('SCENE_NOT_PUBLISHED', 409, '场景尚未发布。');
    let document = record.publishedDocument;
    const itemId = input.item == null ? null : normalizeSceneId(input.item);
    const binding = [owner.scope, owner.epoch, id, record.capability.hash, itemId];
    const activeTypes = projections.read(input.projection, binding, version);
    if (input.item != null) {
      const item = document.items.find((entry) => entry.id === itemId);
      if (!item) throw new SceneError('SCENE_ITEM_NOT_FOUND', 404, '组件尚未发布或已移除。');
      document = { ...document, canvas: { width: item.width, height: item.height },
        items: [{ ...item, x: 0, y: 0, visible: true }] };
    }
    const types = [...new Set(document.items.filter((item) => item.visible).map((item) => item.type))];
    return { id, record, document, binding, types, activeTypes };
  }

  function decodeCapability(scope, id, capability) {
    try {
      if (secretCodec.isAvailable() !== true) throw new Error();
      const decoded = JSON.parse(secretCodec.decrypt(capability.encrypted));
      if (!decoded || Object.keys(decoded).length !== 5 || decoded.schemaVersion !== 1
        || decoded.ownerScope !== scope || decoded.sceneId !== id
        || decoded.capabilityVersion !== capability.version || !matchesToken(decoded.token, capability.hash)) {
        throw new Error();
      }
      return decoded.token;
    } catch {
      throw new SceneError('SCENE_SOURCE_UNAVAILABLE', 503, '无法安全读取场景来源，请检查系统凭据保护。');
    }
  }

  function issueCapability(scope, id, version) {
    try {
      if (!Number.isSafeInteger(version) || version < 1 || secretCodec.isAvailable() !== true) throw new Error();
      const token = randomBytes(32).toString('hex');
      const encrypted = secretCodec.encrypt(JSON.stringify({
        schemaVersion: 1,
        ownerScope: scope,
        sceneId: id,
        capabilityVersion: version,
        token,
      }));
      if (typeof encrypted !== 'string' || !encrypted) throw new Error();
      const capability = { version, hash: hashToken(token), encrypted };
      decodeCapability(scope, id, capability);
      return { capability, token };
    } catch {
      throw new SceneError('SCENE_SOURCE_UNAVAILABLE', 503, '无法安全保存场景来源，请检查系统凭据保护。');
    }
  }

  function confirm(record, document) {
    if (!record) throw conflict();
    return managementDto({ ...record, document });
  }

  function canvasBinding(scope) {
    const existing = store.getCanvas(scope);
    if (existing) return existing;
    const first = store.list(scope)[0];
    return first ? store.bindCanvas(scope, first.document.id) : null;
  }

  function canvasState(scope) {
    const binding = canvasBinding(scope);
    const output = binding && readStored(scope, binding.outputId);
    return { outputId: binding?.outputId || null, activeSceneId: binding?.activeSceneId || null,
      publishedVersion: output?.publishedVersion || 0,
      activeSceneTitle: binding?.activeSceneId ? output?.publishedDocument?.title || '' : '' };
  }

  function publication(record, outputId, expectedDefaults) {
    const sharedTypes = [...new Set(record.document.items.filter((item) => item.appearance.mode === 'shared').map((item) => item.type))];
    if (expectedDefaults !== undefined && (!expectedDefaults || typeof expectedDefaults !== 'object'
      || Array.isArray(expectedDefaults) || Object.keys(expectedDefaults).length !== sharedTypes.length
      || sharedTypes.some((type) => !Object.hasOwn(expectedDefaults, type)))) {
      throw new SceneError('SCENE_INVALID_DEFAULTS', 400, '共享外观确认参数无效。');
    }
    const defaults = new Map();
    const componentSizes = {};
    const items = record.document.items.map((item) => {
      if (item.appearance.mode !== 'shared') return item;
      const size = { width: item.width, height: item.height };
      if (componentSizes[item.type] && !isDeepStrictEqual(componentSizes[item.type], size)) {
        throw new SceneError('SCENE_SHARED_SIZE_CONFLICT', 400, '共享同一组件的尺寸必须一致；不同尺寸请使用独立组件。');
      }
      componentSizes[item.type] = size;
      if (!defaults.has(item.type)) {
        const current = getDefaultConfig(item.type);
        if (expectedDefaults !== undefined && !isDeepStrictEqual(normalizeConfig(item.type, expectedDefaults[item.type]), current)) {
          throw new SceneError('SCENE_DEFAULT_CHANGED', 503, '组件默认外观仍在同步或已变化，请刷新预览后重试发布。');
        }
        defaults.set(item.type, current);
      }
      return { ...item, appearance: { mode: 'independent', config: defaults.get(item.type) } };
    });
    const document = normalizeSceneDocument({ ...record.document, id: outputId, items }, { normalizeConfig });
    return { document, componentSizes };
  }

  function publish(input, canvas = false) {
    const result = withOwner((owner, assertCurrent) => {
      const id = normalizeSceneId(input?.id);
      const { expectedRevision } = input;
      const record = readPreset(owner.scope, id);
      checkRevision(record, expectedRevision);
      const binding = canvas ? canvasBinding(owner.scope) : null;
      const output = binding ? read(owner.scope, binding.outputId) : record;
      if (canvas && (!Number.isSafeInteger(input.expectedPublishedVersion) || input.expectedPublishedVersion < 0)) {
        throw new SceneError('SCENE_INVALID_VERSION', 400, '画布发布版本无效。');
      }
      if (canvas && input.expectedPublishedVersion !== output.publishedVersion) throw conflict();
      const { document, componentSizes } = publication(record, output.document.id, input.expectedDefaults);
      assertCurrent();
      const stored = browserSources.encode(document, owner.scope);
      assertCurrent();
      return confirm(store.publish({ scope: owner.scope, id: output.document.id, expectedRevision: output.revision,
        document: stored, componentSizes, ...(canvas ? { preset: { id, revision: expectedRevision,
          expectedPublishedVersion: input.expectedPublishedVersion } } : {}) }), output.document);
    });
    onOutputChanged({ id: result.document.id });
    return result;
  }

  return {
    validate(input) {
      return withOwner(() => normalizeSceneDocument(input?.document, { normalizeConfig }));
    },

    ...createSceneTransfer({ withOwner, store, browserSources, issueCapability, normalizeConfig, getDefaultConfig, getSharedAppearances }),

    visitAssetReferences(visit) {
      store.visitDocuments((document, scope) => visit(browserSources.decodeDocument(document, scope)));
    },

    list() {
      return withOwner((owner) => store.list(owner.scope).map((record) => managementDto(browserSources.decode(record, owner.scope))));
    },

    create(input) {
      return withOwner((owner, assertCurrent) => {
        const document = normalizeSceneDocument({
          schemaVersion: 1,
          id: randomUUID(),
          title: input?.title,
          canvas: input?.canvas,
          items: [],
        }, { normalizeConfig });
        const { capability } = issueCapability(owner.scope, document.id, 1);
        assertCurrent();
        return managementDto(store.create({ scope: owner.scope, document, capability }));
      });
    },

    get(id) {
      return withOwner((owner) => managementDto(readPreset(owner.scope, normalizeSceneId(id))));
    },

    delete(input) {
      const result = withOwner((owner, assertCurrent) => {
        const id = normalizeSceneId(input?.id);
        const { expectedRevision } = input;
        const record = readStored(owner.scope, id);
        if (!record.isPreset) throw new SceneError('SCENE_NOT_FOUND', 404, '场景不存在。');
        checkRevision(record, expectedRevision);
        const binding = canvasState(owner.scope);
        if (input.expectedPublishedVersion !== undefined && input.expectedPublishedVersion !== binding.publishedVersion) throw conflict();
        let replacement;
        if (id === binding.activeSceneId && binding.publishedVersion) {
          const next = store.list(owner.scope).find(entry => entry.document.id !== id);
          const selected = next ? browserSources.decode(next, owner.scope)
            : { document: { ...record.document, title: '暂无场景', items: [] } };
          const { document, componentSizes } = publication(selected, binding.outputId);
          replacement = { id: next?.document.id || null, revision: next?.revision,
            document: browserSources.encode(document, owner.scope), componentSizes };
        }
        assertCurrent();
        const deleted = store.delete({ scope: owner.scope, id, expectedRevision, expectedCanvas: binding, replacement });
        if (!deleted) throw conflict();
        return { ...deleted, canvas: canvasState(owner.scope) };
      });
      onOutputChanged({ id: result.id });
      if (result.canvas.outputId !== result.id) onOutputChanged({ id: result.canvas.outputId });
      return result;
    },

    getComponentSize(type) {
      if (!SCENE_TYPES.includes(type)) throw new SceneError('SCENE_INVALID_COMPONENT', 400, '组件类型无效。');
      // Legacy standalone sources also work before an account has created a scene.
      if (!getOwner()) return null;
      return withOwner((owner) => store.getComponentSize(owner.scope, type));
    },

    save(input) {
      return withOwner((owner, assertCurrent) => {
        const id = normalizeSceneId(input?.id);
        const { expectedRevision, document } = input;
        checkRevision(readPreset(owner.scope, id), expectedRevision);
        const normalized = normalizeSceneDocument(document, { normalizeConfig });
        if (normalized.id !== id) throw new SceneError('SCENE_ID_MISMATCH', 400, '场景标识不匹配。');
        assertCurrent();
        const stored = browserSources.encode(normalized, owner.scope);
        assertCurrent();
        return confirm(store.save({ scope: owner.scope, id, expectedRevision, document: stored }), normalized);
      });
    },

    publish: input => publish(input),
    publishCanvas: input => publish(input, true),
    getCanvas() {
      return withOwner(owner => canvasState(owner.scope));
    },

    getSource(sceneId) {
      return withOwner((owner) => {
        const id = normalizeSceneId(sceneId);
        const record = readStored(owner.scope, id);
        return { id, token: decodeCapability(owner.scope, id, record.capability),
          itemIds: record.publishedDocument?.items.map((item) => item.id) || [] };
      });
    },

    rotate(sceneId) {
      const result = withOwner((owner, assertCurrent) => {
        const id = normalizeSceneId(sceneId);
        const record = readStored(owner.scope, id);
        decodeCapability(owner.scope, id, record.capability);
        const { capability, token } = issueCapability(owner.scope, id, record.capability.version + 1);
        assertCurrent();
        const updated = store.rotate({ scope: owner.scope, id, expectedCapabilityVersion: record.capability.version, capability });
        if (!updated) throw conflict();
        return { id, token };
      });
      onOutputChanged({ id: result.id });
      return result;
    },

    getOutputAccess(input) {
      return withOwner((owner) => {
        const { record, binding, types, activeTypes } = readOutputSource(input, owner);
        return { binding: JSON.stringify(binding), version: record.publishedVersion,
          types: [...new Set([...types, ...activeTypes])] };
      });
    },

    getOutput(input) {
      return withOwner((owner, assertCurrent) => {
        const { id, record, document, binding, types, activeTypes } = readOutputSource(input, owner);
        const { token, version, epoch, cursor } = input;
        const data = getDisplayData([...new Set([...types, ...activeTypes])], { epoch, cursor });
        const finish = (display) => {
          assertCurrent();
          if (!matchesToken(token, readStored(owner.scope, id).capability.hash)) {
            throw new SceneError('SCENE_ACCESS_DENIED', 403, '场景来源凭据无效。');
          }
          const outputDocument = version === record.publishedVersion ? null : browserSources.decodeDocument(document, owner.scope);
          const appearances = getSharedAppearances?.(document.items);
          assertCurrent();
          return {
            sceneId: id,
            version: record.publishedVersion,
            projection: projections.issue(binding, record.publishedVersion, types),
            document: outputDocument,
            data: display,
            ...(appearances ? { appearances } : {}),
          };
        };
        return data?.then ? data.then(finish) : finish(data);
      });
    },
  };
}

module.exports = { createSceneService };
