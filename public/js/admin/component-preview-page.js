import { previewElement } from './component-preview-surface.js';
import { createBrowserPreviewConnection, createRemotePreviewController } from './component-preview-remote.js';
import { createPreviewDraftRecovery, readPreviewDraft } from './component-preview-drafts.js';
import { COMPONENT_PREVIEW_DEFINITIONS } from './component-preview-definitions.js';
import { mountComponentPreviewCanvas } from './component-preview-canvas-view.js';
import { loadThemeConfig } from '../shared/theme.js';
import { readComponentPreviewLink } from './component-preview-link.js';

const host = document.getElementById('componentPreviewPage');
let closed = false;
let connections = [];
let view;
let recovery;
let links = [];
const requests = new AbortController();

function dispose() {
  if (closed) return;
  closed = true;
  requests.abort();
  recovery?.dispose();
  view?.dispose();
  for (const connection of connections) connection.detach();
}

async function start() {
  const loading = previewElement('p', '', '正在连接客户端…');
  loading.setAttribute('role', 'status');
  host.replaceChildren(loading);
  const entry = await readComponentPreviewLink(location, requests.signal);
  if (closed) return;
  const { selectedId, selectedSize } = entry;
  links = entry.links;
  if (links.length > Object.keys(COMPONENT_PREVIEW_DEFINITIONS).length + 1
    || new Set(links.map((link) => link?.component)).size !== links.length
    || links.some((link) => link?.component !== 'canvas' && !Object.hasOwn(COMPONENT_PREVIEW_DEFINITIONS, link?.component))) {
    throw new Error('请点击客户端中的“预览”打开此页面。');
  }
  if (!links.length || links.some((link) => !link?.id || !/^[a-f0-9]{64}$/.test(link.token || ''))
    || new Set(links.map(({ id }) => id)).size !== links.length) throw new Error('预览链接无效，请从客户端重新打开。');
  if (selectedSize !== null && !['width', 'height'].every((axis) => Number.isFinite(selectedSize[axis])
    && selectedSize[axis] >= 32 && selectedSize[axis] <= 7680)) throw new Error('组件尺寸无效，请从客户端重新打开。');
  connections = links.map(createBrowserPreviewConnection);
  await Promise.all(connections.map((connection) => connection.start()));
  if (links.some(({ component }) => component === 'queue')) await loadThemeConfig();
  if (closed) return;
  recovery = createPreviewDraftRecovery({ connections,
    key: (connections.find(({ component }) => component === 'canvas') || connections[0]).draftKey });
  mount(selectedId, selectedSize);
}

function mount(selectedId, selectedSize = null) {
  const source = document.getElementById('componentPreviewTemplates').content;
  const components = Object.entries(COMPONENT_PREVIEW_DEFINITIONS).flatMap(([id, definition]) => {
    const connection = connections.find(({ component }) => component === id);
    return connection ? [definition.createPreview({ controller: connection.controller, source,
      startActualData: connection.startActualData, embedded: true })]
      : definition.sceneOnly && connections.some(({ component }) => component === 'canvas') ? [definition.createPreview()] : [];
  });
  view = mountComponentPreviewCanvas(host, { components, selectedId, selectedSize, source, recovery,
    canvasConnection: connections.find(({ component }) => component === 'canvas'),
    canvasController: connections.find(({ component }) => component === 'canvas')?.controller });
}

window.addEventListener('pagehide', dispose, { once: true });
void start().catch((error) => {
  if (closed) return;
  links = error.links || links;
  dispose();
  const key = (links.find(({ component }) => component === 'canvas') || links[0])?.draftKey;
  const snapshot = readPreviewDraft(key);
  if ([401, 403, 410].includes(error.status) && snapshot && links.length
    && snapshot.components[links.some(({ component }) => component === 'canvas') ? 'canvas' : links[0].component]) {
    const message = '已找回上次编辑进度，未保存修改尚未应用。连接已结束，实际数据不可用，请从客户端重新打开继续编辑。';
    connections = links.map(({ component }) => {
      const state = snapshot.components[component] || { saved: {}, draft: {} };
      return { component,
        controller: createRemotePreviewController({ ...state, generation: 0,
          dirty: JSON.stringify(state.draft) !== JSON.stringify(state.saved),
          loaded: false, error: message }, () => Promise.reject(new Error(message))),
        startActualData(emit) { emit(null); return () => {}; },
        detach() {},
      };
    });
    recovery = null;
    try {
      mount(null);
      closed = false;
      return;
    } catch {
      view?.dispose();
    }
  }
  const message = previewElement('p', '', error.message);
  message.id = 'componentPreviewStatus';
  message.setAttribute('role', 'status');
  host.replaceChildren(message);
});
