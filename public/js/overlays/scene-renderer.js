import { SCENE_COMPONENTS } from '../shared/scene-components.js';
import { createSceneGiftDisplay } from './scene-gift-display.js';
import { configureBrowserSourceFrame, disposeBrowserSourceFrame } from '../shared/browser-source-frame.js';
import { normalizeBrowserSourceConfig } from '../shared/scene-browser-source.js';
import { componentCssRendererUrl } from '../shared/component-css-style.js';
const MAX_PENDING_EVENTS = 200;

export function createSceneRenderer(host, { onStatus = () => {}, timeoutMs = 12000 } = {}) {
  let active = null;
  let staging = null;
  let disposed = false;
  let latestData = {};
  let pendingDanmaku = null;
  let dataSequence = 1;
  let latestAppearances = {};
  let appearanceVersion = 0;
  const giftDisplay = createSceneGiftDisplay();
  const send = (entry, type, values = {}) => {
    if (!entry.external) entry.frame.contentWindow?.postMessage({ type: `component-preview:${type}`, ...values }, '*');
  };
  function layout(entry, item, index) {
    const { frame } = entry;
    entry.item = item;
    frame.title = item.name;
    frame.style.left = `${item.x}px`;
    frame.style.top = `${item.y}px`;
    frame.style.zIndex = String(index);
    if (entry.external) configureBrowserSourceFrame(frame, item.appearance.config, item.width, item.height);
    else {
      frame.style.width = `${item.width}px`;
      frame.style.height = `${item.height}px`;
    }
  }
  function updateLayout(document, items, version, projection) {
    if (!active || active.entries.length !== items.length) return false;
    const existing = new Map(active.entries.map((entry) => [entry.item.id, entry]));
    if (!items.every((item) => {
      const entry = existing.get(item.id);
      return entry?.item.type === item.type && (entry.external
        ? entry.item.appearance.config.url === item.appearance.config.url
        : JSON.stringify(entry.item.appearance.config) === JSON.stringify(item.appearance.config));
    })) return false;
    // Keep frames in their current DOM parent so live connections and animations survive.
    active.entries = items.map((item, index) => {
      const entry = existing.get(item.id);
      layout(entry, item, index);
      return entry;
    });
    active.root.style.width = `${document.canvas.width}px`;
    active.root.style.height = `${document.canvas.height}px`;
    Object.assign(active, { document, version, projection });
    onStatus('', version);
    return true;
  }
  function release(version) {
    if (!version) return;
    clearTimeout(version.timer);
    for (const entry of version.entries) {
      send(entry, 'dispose');
      if (entry.external) disposeBrowserSourceFrame(entry.frame);
      if (entry.onLoad) entry.frame.removeEventListener('load', entry.onLoad);
    }
    version.root.remove();
  }
  function data(version, values) {
    if (!version) return;
    for (const entry of version.entries) {
      if (entry.ready && values[entry.item.type] !== undefined) send(entry, 'data', { data: values[entry.item.type], source: dataSequence });
    }
  }
  function appearance(version) {
    if (!version || version.version !== appearanceVersion) return;
    for (const entry of version.entries) {
      if (entry.external) continue;
      const config = { ...entry.item.appearance.config, ...latestAppearances[entry.item.id] };
      const serialized = JSON.stringify(config);
      if (serialized === entry.configKey) continue;
      entry.configKey = serialized;
      if (entry.ready) send(entry, 'config', { config, editable: false });
    }
  }
  function commit() {
    if (!staging || staging.entries.some((entry) => !entry.prepared)) return;
    const next = staging;
    staging = null;
    clearTimeout(next.timer);
    data(next, { ...latestData, ...(pendingDanmaku ? { danmaku: pendingDanmaku } : {}), ...giftDisplay.takePending() });
    pendingDanmaku = null;
    next.root.classList.remove('is-staging');
    release(active);
    active = next;
    onStatus('', active.version);
  }
  function fail(message, entry) {
    if (!staging) return;
    const pending = entry ? [entry] : staging.entries.filter(candidate => !candidate.prepared);
    const names = pending.map(candidate => candidate.item.name).join('、');
    const reason = typeof message === 'string' && message ? message : '加载超时。';
    release(staging);
    staging = null;
    onStatus(`${active ? '新版准备失败' : '场景加载失败'}：${names}：${reason} ${active
      ? '继续显示上一版本，正在自动重试。' : '正在自动重试，请保持 LIRA 客户端运行。'}`, active?.version || 0);
  }
  function receive(event) {
    if (disposed || !staging || event.origin !== 'null') return;
    const entry = staging.entries.find((candidate) => candidate.frame.contentWindow === event.source);
    if (!entry || entry.external) return;
    if (event.data?.type === 'component-preview:ready') {
      entry.ready = true;
      const config = { ...entry.item.appearance.config,
        ...(staging.version === appearanceVersion ? latestAppearances[entry.item.id] : {}) };
      entry.configKey = JSON.stringify(config);
      send(entry, 'init', { config, editable: false });
    } else if (event.data?.type === 'component-preview:prepared' && entry.ready) {
      entry.prepared = true;
      commit();
    } else if (event.data?.type === 'component-preview:status') fail(event.data.message, entry);
  }
  function prepare(document, version, projection) {
    if (disposed || version === active?.version || version === staging?.version) return;
    release(staging);
    staging = null;
    const items = document.items.filter((value) => value.visible);
    for (const item of items) {
      if (typeof item.type !== 'string' || !Object.hasOwn(SCENE_COMPONENTS, item.type)
        || item.appearance.mode !== 'independent') {
        onStatus(`场景版本无效，请在画布重新保存并应用。${active ? ' 继续显示上一版本。' : ''}`, active?.version || 0);
        return;
      }
      if (SCENE_COMPONENTS[item.type].external) {
        try { normalizeBrowserSourceConfig(item.appearance.config); }
        catch { onStatus(`浏览器源配置无效，请在画布检查来源地址。${active ? ' 继续显示上一版本。' : ''}`, active?.version || 0); return; }
      }
    }
    if (updateLayout(document, items, version, projection)) { appearance(active); return; }
    const root = window.document.createElement('div');
    root.className = 'scene-version is-staging';
    root.style.width = `${document.canvas.width}px`;
    root.style.height = `${document.canvas.height}px`;
    const entries = [];
    for (const [index, item] of items.entries()) {
      const external = SCENE_COMPONENTS[item.type].external;
      const frame = window.document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.allow = 'autoplay';
      const entry = { item, frame, external, ready: false, prepared: false };
      if (external) {
        entry.onLoad = () => {
          if (disposed || !staging?.entries.includes(entry)) return;
          entry.ready = entry.prepared = true;
          commit();
        };
        frame.addEventListener('load', entry.onLoad, { once: true });
      } else frame.src = componentCssRendererUrl(item.appearance.config, SCENE_COMPONENTS[item.type].rendererUrl);
      layout(entry, item, index);
      root.append(frame);
      entries.push(entry);
    }
    staging = { root, document, version, projection, entries, timer: setTimeout(fail, timeoutMs) };
    host.append(root);
    commit();
  }
  window.addEventListener('message', receive);
  return {
    getVersion: () => active?.version || 0,
    getProjection: () => active?.projection || '',
    update(response) {
      if (disposed) return;
      latestAppearances = response.appearances || {};
      appearanceVersion = response.version;
      appearance(active);
      appearance(staging);
      const values = giftDisplay.update(response.data || {}, active?.entries.map((entry) => entry.item.type) || []);
      const cloud = values.danmaku;
      data(active, values);
      if (cloud && !active?.entries.some((entry) => entry.item.type === 'danmaku')) {
        const previous = pendingDanmaku;
        const reset = cloud.reset || !previous || cloud.epoch !== previous.epoch
          || cloud.status !== previous.status || cloud.state?.liveSessionId !== previous.state?.liveSessionId
          || cloud.state?.liveStatus !== previous.state?.liveStatus;
        const events = [...(reset ? [] : previous.events), ...(cloud.events || [])];
        pendingDanmaku = { ...cloud, reset: reset || previous.reset,
          gap: Boolean(cloud.gap || !reset && previous.gap || events.length > MAX_PENDING_EVENTS),
          events: events.slice(-MAX_PENDING_EVENTS) };
      } else pendingDanmaku = null;
      latestData = { ...giftDisplay.withoutEvents(values), ...(cloud ? { danmaku: { ...cloud, reset: false, events: [] } } : {}) };
      if (response.document) prepare(response.document, response.version, response.projection);
    },
    disconnect() {
      giftDisplay.clear();
      dataSequence += 1;
      pendingDanmaku = null;
      const resets = Object.fromEntries(Object.entries(SCENE_COMPONENTS)
        .filter(([, component]) => component.disconnectedData)
        .map(([type, component]) => [type, component.disconnectedData()]));
      latestData = { ...latestData, ...resets };
      data(active, resets);
    },
    revoke() {
      giftDisplay.clear();
      release(staging);
      release(active);
      staging = null;
      active = null;
      latestData = {};
      pendingDanmaku = null;
      dataSequence += 1;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      release(staging);
      release(active);
      window.removeEventListener('message', receive);
    },
  };
}
