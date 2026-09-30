import { previewElement } from './component-preview-surface.js';
import { createBrowserPreviewConnection } from './component-preview-remote.js';
import { createClockPreview } from './clock-card.js';
import { createDanmakuPreview } from './danmaku-canvas-dialog.js';
import { createQueuePreview } from './queue-preview.js';
import { createOvertimePreview } from './overtime-preview.js';
import { mountComponentPreviewCanvas } from './component-preview-canvas-view.js';
import { loadThemeConfig } from '../shared/theme.js';

const factories = { danmaku: createDanmakuPreview, clock: createClockPreview,
  queue: createQueuePreview, overtime: createOvertimePreview };
const host = document.getElementById('componentPreviewPage');
let closed = false;
let connections = [];
let view;

function close() {
  if (closed) return;
  closed = true;
  view?.dispose();
  for (const connection of connections) connection.close();
}

async function start() {
  const params = new URLSearchParams(location.hash.slice(1));
  const selectedId = new URLSearchParams(location.search).get('component');
  const others = JSON.parse(params.get('components') || '[]');
  if (!Array.isArray(others)) throw new Error('预览链接无效，请从客户端重新打开。');
  const links = [...(selectedId ? [{ component: selectedId, id: params.get('id'), token: params.get('token') }] : []), ...others];
  if (links.length > 4 || new Set(links.map((link) => link?.component)).size !== links.length
    || links.some((link) => !Object.hasOwn(factories, link?.component))) {
    throw new Error('请点击客户端中的“预览”打开此页面。');
  }
  if (params.has('canvas')) links.push({ ...JSON.parse(params.get('canvas')), component: 'canvas' });
  if (!links.length || links.some((link) => !link?.id || !/^[a-f0-9]{64}$/.test(link.token || ''))
    || new Set(links.map(({ id }) => id)).size !== links.length) throw new Error('预览链接无效，请从客户端重新打开。');
  connections = links.map(createBrowserPreviewConnection);
  await Promise.all(connections.map((connection) => connection.start()));
  if (links.some(({ component }) => component === 'queue')) await loadThemeConfig();
  if (closed) return;
  const source = document.getElementById('componentPreviewTemplates').content;
  const components = Object.keys(factories).flatMap((id) => {
    const connection = connections.find(({ component }) => component === id);
    return connection ? [factories[id]({ controller: connection.controller, source,
      startActualData: connection.startActualData, embedded: true })] : [];
  });
  view = mountComponentPreviewCanvas(host, { components, selectedId, source,
    canvasConnection: connections.find(({ component }) => component === 'canvas'),
    canvasController: connections.find(({ component }) => component === 'canvas')?.controller });
}

window.addEventListener('pagehide', close, { once: true });
void start().catch((error) => {
  close();
  const message = previewElement('p', '', error.message);
  message.id = 'componentPreviewStatus';
  message.setAttribute('role', 'status');
  host.replaceChildren(message);
});
