'use strict';

const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { SCENE_TYPES, SceneError, normalizeSceneId, normalizeSceneDocument } = require('./scene-contract');
const { createSceneOutputProjection } = require('./scene-output-projection');

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

function createSceneService({ store, getOwner, secretCodec, normalizeConfig, getDefaultConfig, getDisplayData }) {
  const projections = createSceneOutputProjection();
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

  function read(scope, id) {
    const record = store.get(scope, id);
    if (!record) throw new SceneError('SCENE_NOT_FOUND', 404, '场景不存在。');
    return record;
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

  function confirm(record) {
    if (!record) throw conflict();
    return managementDto(record);
  }

  return {
    validate(input) {
      return withOwner(() => normalizeSceneDocument(input?.document, { normalizeConfig }));
    },

    list() {
      return withOwner((owner) => store.list(owner.scope).map(managementDto));
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
      return withOwner((owner) => managementDto(read(owner.scope, normalizeSceneId(id))));
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
        checkRevision(read(owner.scope, id), expectedRevision);
        const normalized = normalizeSceneDocument(document, { normalizeConfig });
        if (normalized.id !== id) throw new SceneError('SCENE_ID_MISMATCH', 400, '场景标识不匹配。');
        assertCurrent();
        return confirm(store.save({ scope: owner.scope, id, expectedRevision, document: normalized }));
      });
    },

    publish(input) {
      return withOwner((owner, assertCurrent) => {
        const id = normalizeSceneId(input?.id);
        const { expectedRevision } = input;
        const record = read(owner.scope, id);
        checkRevision(record, expectedRevision);
        const expectedDefaults = input.expectedDefaults;
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
        const document = normalizeSceneDocument({ ...record.document, items }, { normalizeConfig });
        assertCurrent();
        return confirm(store.publish({ scope: owner.scope, id, expectedRevision, document, componentSizes }));
      });
    },

    getSource(sceneId) {
      return withOwner((owner) => {
        const id = normalizeSceneId(sceneId);
        const record = read(owner.scope, id);
        return { id, token: decodeCapability(owner.scope, id, record.capability),
          itemIds: record.publishedDocument?.items.map((item) => item.id) || [] };
      });
    },

    rotate(sceneId) {
      return withOwner((owner, assertCurrent) => {
        const id = normalizeSceneId(sceneId);
        const record = read(owner.scope, id);
        decodeCapability(owner.scope, id, record.capability);
        const { capability, token } = issueCapability(owner.scope, id, record.capability.version + 1);
        assertCurrent();
        const updated = store.rotate({ scope: owner.scope, id, expectedCapabilityVersion: record.capability.version, capability });
        if (!updated) throw conflict();
        return { id, token };
      });
    },

    getOutput(input) {
      return withOwner((owner, assertCurrent) => {
        const id = normalizeSceneId(input?.id);
        const { token, version, epoch, cursor } = input;
        const record = read(owner.scope, id);
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
        const data = getDisplayData([...new Set([...types, ...activeTypes])], { epoch, cursor });
        const finish = (display) => {
          assertCurrent();
          if (!matchesToken(token, read(owner.scope, id).capability.hash)) {
            throw new SceneError('SCENE_ACCESS_DENIED', 403, '场景来源凭据无效。');
          }
          return {
            sceneId: id,
            version: record.publishedVersion,
            projection: projections.issue(binding, record.publishedVersion, types),
            document: version === record.publishedVersion ? null : document,
            data: display,
          };
        };
        return data?.then ? data.then(finish) : finish(data);
      });
    },
  };
}

module.exports = { createSceneService };
