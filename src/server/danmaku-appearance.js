'use strict';

const { normalizeSceneConfig } = require('./scene-components');
const FIELDS = ['style', 'fullscreenDurationSeconds', 'styleOptions', 'styleParameters', 'layout'];

function failure(code, statusCode, message) {
  return Object.assign(new Error(message), { code, statusCode });
}

function normalize(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some(key => !FIELDS.includes(key))) {
    throw failure('INVALID_DANMAKU_APPEARANCE', 400, '弹幕外观参数无效。');
  }
  try { return normalizeSceneConfig('danmaku', { layout: null, ...config }); }
  catch { throw failure('INVALID_DANMAKU_APPEARANCE', 400, '弹幕外观参数无效。'); }
}

function createDanmakuAppearance({ store, getOwner, loadLegacy, onChanged = () => {} }) {
  const pending = new Map();
  const bindingOf = owner => JSON.stringify([owner.scope, owner.epoch]);

  function owner() {
    const value = getOwner();
    if (!value) throw failure('LICENSE_NOT_AUTHORIZED', 423, '请先连接已授权的 LIRA 账号。');
    return value;
  }

  function assertBinding(binding) {
    const current = owner();
    if (binding !== bindingOf(current)) {
      throw failure('DANMAKU_OWNER_CHANGED', 409, '账号授权已变化，请重新读取弹幕外观后再保存。');
    }
    return current;
  }

  function seed(update) {
    const current = getOwner();
    if (!current || update?.ownerScope !== current.scope || update.authorizationEpoch !== current.epoch
      || store.get(current.scope)) return false;
    const value = update.settings;
    const config = normalize(Object.fromEntries(FIELDS.filter(key => Object.hasOwn(value || {}, key))
      .map(key => [key, value[key]])));
    store.set(current.scope, config);
    onChanged();
    return true;
  }

  async function read() {
    const current = owner();
    const binding = bindingOf(current);
    const config = store.get(current.scope);
    if (!config) {
      if (!pending.has(binding)) {
        const operation = (async () => {
          const settings = await loadLegacy();
          assertBinding(binding);
          if (settings?.ok === false) throw failure('DANMAKU_MIGRATION_UNAVAILABLE', 503, '旧弹幕外观读取失败，请检查连接后重试。');
          seed({ ownerScope: current.scope, authorizationEpoch: current.epoch, settings });
        })();
        pending.set(binding, operation);
        void operation.finally(() => pending.delete(binding)).catch(() => {});
      }
      await pending.get(binding);
    }
    assertBinding(binding);
    return { binding, config: config || store.get(current.scope) };
  }

  function save(input) {
    const current = assertBinding(input?.binding);
    const config = normalize(input?.config);
    store.set(current.scope, config);
    onChanged();
    return { binding: bindingOf(current), config };
  }

  return { read, save, seed, getSettings() {
    const current = getOwner();
    return current ? store.get(current.scope) : null;
  } };
}

module.exports = { createDanmakuAppearance };
