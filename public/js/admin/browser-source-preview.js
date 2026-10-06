import { previewElement } from './component-preview-surface.js';
import { syncComponentFieldValue } from './component-preview-panel.js';
import { BROWSER_SOURCE_DEFAULTS, normalizeBrowserSourceConfig } from '../shared/scene-browser-source.js';
import { configureBrowserSourceFrame } from '../shared/browser-source-frame.js';

export function mountBrowserSourceFields(host, config = BROWSER_SOURCE_DEFAULTS, onChange) {
  const fields = new Map();
  const grid = previewElement('div', 'component-preview-fields preview-browser-fields');
  const error = previewElement('p', 'preview-browser-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  function read() {
    return normalizeBrowserSourceConfig({ url: fields.get('url').value.trim(),
      viewportWidth: Number(fields.get('viewportWidth').value), viewportHeight: Number(fields.get('viewportHeight').value) });
  }
  for (const [key, title, type] of [
    ['url', '浏览器源地址', 'url'], ['viewportWidth', '网页宽度', 'number'], ['viewportHeight', '网页高度', 'number'],
  ]) {
    const label = previewElement('label', '', title);
    const input = previewElement('input');
    input.type = type;
    input.required = true;
    input.dataset.browserField = key;
    if (type === 'number') { input.min = '32'; input.max = '7680'; input.step = '1'; }
    else { input.placeholder = 'https://…'; input.maxLength = 8192; input.autocomplete = 'off'; input.spellcheck = false; }
    input.defaultValue = String(config[key]);
    input.addEventListener('input', () => { input.setCustomValidity(''); error.hidden = true; });
    if (onChange) input.addEventListener('change', () => {
      if (!input.reportValidity()) return;
      try {
        onChange(read());
        for (const field of fields.values()) field.setCustomValidity('');
        error.hidden = true;
      }
      catch (failure) { input.setCustomValidity(failure.message); error.textContent = failure.message; error.hidden = false; }
    });
    fields.set(key, input);
    label.append(input);
    grid.append(label);
  }
  host.append(grid, previewElement('p', 'hint preview-browser-hint',
    '网页分辨率决定内容布局；拖动画布边框只改变显示大小。'), error);
  return { read, sync(value) { for (const [key, input] of fields) syncComponentFieldValue(input, value[key]); } };
}

export function createBrowserSourcePreview() {
  const getState = () => ({ draft: { ...BROWSER_SOURCE_DEFAULTS }, saved: { ...BROWSER_SOURCE_DEFAULTS }, loaded: true, dirty: false });
  const controller = { getState, subscribe(listener) { listener(getState()); return () => {}; } };
  return { id: 'browser', title: '浏览器源', sceneOnly: true, controller,
    size: (config) => [config.viewportWidth, config.viewportHeight],
    createPanel(host, target = controller) {
      const fields = mountBrowserSourceFields(host, target.getState().draft, (config) => target.edit(config));
      const stop = target.subscribe(({ draft }) => fields.sync(draft));
      return { dispose: stop };
    },
  };
}

export function mountBrowserSourcePreview(host, { controller, size }) {
  const surface = previewElement('div', 'scene-browser-source');
  const frame = previewElement('iframe');
  frame.title = '浏览器源预览';
  const status = previewElement('p', 'component-preview-load-state');
  status.setAttribute('role', 'status');
  surface.append(frame, status);
  host.append(surface);
  let previousUrl = '';
  let timer;
  function loaded() {
    if (!controller.getState().draft.url) return;
    clearTimeout(timer); status.hidden = true;
  }
  frame.addEventListener('load', loaded);
  function fit() {
    const config = controller.getState().draft;
    if (!config.url) {
      clearTimeout(timer);
      frame.removeAttribute('src');
      frame.hidden = true;
      status.textContent = '请重新填写浏览器源地址。';
      status.hidden = false;
      previousUrl = '';
      return;
    }
    if (config.url !== previousUrl) {
      clearTimeout(timer);
      status.textContent = '正在加载浏览器源…';
      status.hidden = false;
      timer = setTimeout(() => {
        status.textContent = '加载时间较长，请检查地址和网络，确认网页允许嵌入。';
      }, 12000);
      previousUrl = config.url;
    }
    frame.hidden = false;
    configureBrowserSourceFrame(frame, config, ...size());
  }
  const stop = controller.subscribe(fit);
  const observer = new ResizeObserver(fit);
  observer.observe(host);
  return { fit, dispose() {
    stop(); observer.disconnect(); clearTimeout(timer);
    frame.removeEventListener('load', loaded);
    surface.remove();
  } };
}
