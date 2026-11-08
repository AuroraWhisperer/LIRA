'use strict';

const { SceneError, normalizeSceneId } = require('./scene-contract');
const { createSceneOutputProjection } = require('./scene-output-projection');

function readDataVersions(value) {
  if (value === undefined || value === null) return null;
  try {
    if (typeof value === 'string') {
      if (value.length > 1024) throw new Error();
      value = JSON.parse(value);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.entries(value).some(([key, token]) => !['songlist', 'lyricTimeline', 'gift-feed', 'queue', 'wheel', 'games', 'blindbox', 'gift-frame', 'guard-thanks', 'gamesCanvas', 'gamesScores', 'live-rankings'].includes(key)
        || typeof token !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(token))) throw new Error();
    return { known: { ...value }, current: {} };
  } catch {
    throw new SceneError('SCENE_INVALID_DATA_VERSION', 400, '场景数据版本无效。');
  }
}

function createSceneOutputReader({ readOutput, readCapability, decodeDocument, matchesToken,
  getDisplayData, getSharedAppearances }) {
  const projections = createSceneOutputProjection();
  const outputDocuments = new WeakMap();

  function readOutputSource(input, owner) {
    const id = normalizeSceneId(input?.id);
    const { token, version } = input;
    const record = readOutput(owner.scope, id);
    if (!record) throw new SceneError('SCENE_NOT_FOUND', 404, '场景不存在。');
    if (!matchesToken(token, record.capability.hash)) {
      throw new SceneError('SCENE_ACCESS_DENIED', 403, '场景来源凭据无效。');
    }
    if (version != null && (!Number.isSafeInteger(version) || version < 0)) {
      throw new SceneError('SCENE_INVALID_VERSION', 400, '场景发布版本无效。');
    }
    if (!record.publishedDocument) throw new SceneError('SCENE_NOT_PUBLISHED', 409, '场景尚未发布。');
    let document = record.publishedDocument;
    let metadata = outputDocuments.get(document);
    if (!metadata) {
      metadata = { items: new Map(document.items.map(item => [item.id, item])),
        types: [...new Set(document.items.filter(item => item.visible).map(item => item.type))] };
      outputDocuments.set(document, metadata);
    }
    const itemId = input.item == null ? null : normalizeSceneId(input.item);
    const binding = [owner.scope, owner.epoch, id, record.capability.hash, itemId];
    const activeTypes = projections.read(input.projection, binding, version);
    if (input.item != null) {
      const item = metadata.items.get(itemId);
      if (!item) throw new SceneError('SCENE_ITEM_NOT_FOUND', 404, '组件尚未发布或已移除。');
      document = { ...document, canvas: { width: item.width, height: item.height },
        items: [{ ...item, x: 0, y: 0, visible: true }] };
    }
    const types = itemId === null ? metadata.types : [document.items[0].type];
    return { id, record, document, binding, types, activeTypes };
  }

  return {
    getAccess(input, owner) {
      const { record, binding, types, activeTypes } = readOutputSource(input, owner);
      return { binding: JSON.stringify(binding), version: record.publishedVersion,
        types: [...new Set([...types, ...activeTypes])] };
    },

    getOutput(input, owner, assertCurrent) {
      const { id, record, document, binding, types, activeTypes } = readOutputSource(input, owner);
      const { token, version, epoch, cursor } = input;
      const dataVersions = readDataVersions(input.dataVersions);
      if (dataVersions && version !== record.publishedVersion) dataVersions.known = {};
      const displayContext = {};
      const data = getDisplayData([...new Set([...types, ...activeTypes])], { epoch, cursor,
        ...(input.incrementalParts === true ? { incrementalParts: true } : {}),
        ...(dataVersions ? { dataVersions } : {}) }, displayContext);
      const finish = (display) => {
        assertCurrent();
        const capability = readCapability(owner.scope, id);
        if (!capability) throw new SceneError('SCENE_NOT_FOUND', 404, '场景不存在。');
        if (!matchesToken(token, capability.hash)) {
          throw new SceneError('SCENE_ACCESS_DENIED', 403, '场景来源凭据无效。');
        }
        const outputDocument = version === record.publishedVersion ? null
          : structuredClone(decodeDocument(document, owner.scope));
        const appearances = getSharedAppearances?.(document.items.filter(item => item.visible), displayContext);
        assertCurrent();
        return {
          sceneId: id,
          version: record.publishedVersion,
          projection: projections.issue(binding, record.publishedVersion, types),
          document: outputDocument,
          data: display,
          ...(dataVersions ? { dataVersions: dataVersions.current } : {}),
          ...(appearances ? { appearances } : {}),
        };
      };
      return data?.then ? data.then(finish) : finish(data);
    },
  };
}

module.exports = { createSceneOutputReader };
