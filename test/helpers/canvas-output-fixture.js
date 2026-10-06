'use strict';

const { DatabaseSync } = require('node:sqlite');
const { migrateScenes, migrateComponentOutputSizes, migrateCanvasPresets } = require('../../src/storage/scene-migration');
const { createSceneRuntime } = require('../../src/server/scene-runtime');
const { createSceneComponentPorts } = require('../../src/server/scene-components');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
const { createLayout } = require('../../src/shared/danmaku-layout');
const { startComponentPreviewServer } = require('./component-preview-server');

async function startCanvasOutputFixture({ extraContext, notifications = false, dataDir } = {}) {
  const db = new DatabaseSync(':memory:');
  migrateScenes(db);
  migrateComponentOutputSizes(db);
  migrateCanvasPresets(db);
  const owner = { scope: 'synthetic-canvas-owner', epoch: 1 };
  const runtime = { settings: { ...DEFAULT_SETTINGS }, queue: { current: null,
    waiting: [{ id: 1, song_name: '合成实时歌曲', requester: '合成观众' }] }, superChats: [],
    overtime: { revision: 1, enabled: true, status: 'paused', effectiveRemainingMs: 120000,
      initialSeconds: 120, serverNowMs: Date.now(), rules: [], settlements: [], background: { path: '', fit: 'cover' } } };
  // The injected test codec handles synthetic data in an in-memory database only.
  const sceneRuntime = createSceneRuntime({ songDb: db, getState: () => runtime,
    getContext: extraContext ? () => ({ ...extraContext, system: { getState: () => runtime } }) : undefined, runtimeOptions: {
    getSceneOwner: () => owner,
    sceneSecretCodec: { isAvailable: () => true, encrypt: value => Buffer.from(value).toString('base64'),
      decrypt: value => Buffer.from(value, 'base64').toString() } } });
  const { service } = sceneRuntime;
  const updateCloud = (event, status = 'connected') => sceneRuntime.receiveCloud({ ownerScope: owner.scope,
    authorizationEpoch: owner.epoch, connectionEpoch: 'synthetic-connection', status, ...(event ? { event } : {}) });
  updateCloud(null, 'connecting');
  updateCloud({ type: 'overlay-state', style: 'signal', fullscreenDurationSeconds: 6, styleOptions: {},
    layout: createLayout(), state: 'running', liveStatus: 1, liveSessionId: 'synthetic-live', confirmationMessage: '合成开播确认' });
  const ports = createSceneComponentPorts({ getState: () => runtime,
    cloud: { getSettings: () => sceneRuntime.readDanmakuDisplay().config } });
  let failPublish = false;
  const scenes = { ...service, publish(body) {
    if (failPublish) throw Object.assign(new Error('模拟发布失败'), { statusCode: 503 });
    return service.publish(body);
  }, publishCanvas(body) {
    if (failPublish) throw Object.assign(new Error('模拟发布失败'), { statusCode: 503 });
    return service.publishCanvas(body);
  } };
  const server = await startComponentPreviewServer({ scenes, dataDir, getOwner: () => owner, getState: () => runtime,
    sceneEvents: notifications ? sceneRuntime.events : undefined,
    readDanmakuDisplay: sceneRuntime.readDanmakuDisplay,
    parentHtml: '<!doctype html><html><body></body></html>' });
  return { ...server, service, runtime, owner, updateCloud, receiveGift: sceneRuntime.receiveGift, notify: sceneRuntime.notify,
    configs: Object.fromEntries(['clock', 'queue', 'danmaku', 'overtime'].map(id => [id, ports.getDefaultConfig(id)])),
    failPublication(value) { failPublish = value; },
    async close() { sceneRuntime.dispose(); await server.close(); db.close(); },
  };
}

async function openCanvasDesktop(page, fixture, selectedId = null) {
  await page.route('**/api/**', route => route.continue({
    headers: { ...route.request().headers(), Authorization: `Bearer ${fixture.token}` },
  }));
  const url = `${fixture.origin}/preview-test-host`;
  if ((await fetch(url)).status !== 200) throw new Error('Synthetic desktop route unavailable');
  await page.goto(url);
  await page.evaluate(async ({ configs, selectedId }) => {
    const { createComponentConfigController } = await import('/js/admin/component-config-controller.js');
    const { openComponentPreview } = await import('/js/admin/component-preview-dialog.js');
    const { prepareComponentPreviewCanvas } = await import('/js/admin/component-preview-canvas-controller.js');
    const { registerComponentPreview, setComponentPreviewPreparation, getComponentPreviews } = await import('/js/admin/component-preview-registry.js');
    window.controllers = {};
    window.open = value => { window.externalPreviewUrl = value; };
    for (const [id, initial] of Object.entries(configs)) {
      const controller = createComponentConfigController({ initial, persist: async draft => draft });
      window.controllers[id] = controller;
      registerComponentPreview(id, () => ({ id, controller }));
    }
    setComponentPreviewPreparation(async () => {
      const canvas = await prepareComponentPreviewCanvas(getComponentPreviews());
      window.controllers.canvas = canvas.controller;
      return canvas;
    });
    window.reopen = (id = null) => {
      window.externalPreviewUrl = '';
      window.previewHandle = openComponentPreview(id ? { id, controller: window.controllers[id] } : undefined);
    };
    window.reopen(selectedId);
  }, { configs: fixture.configs, selectedId });
  await page.waitForFunction(() => window.externalPreviewUrl);
  return page.evaluate(() => window.externalPreviewUrl);
}

module.exports = { startCanvasOutputFixture, openCanvasDesktop };
