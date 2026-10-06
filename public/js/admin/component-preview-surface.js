export function previewElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function mountComponentPreview(host, { title, controller, url, projectConfig = (draft) => draft,
  size, bounds, onEdit, onResize, dataLabel = '示例数据 · 不影响直播', dataModes, startData, onOpen, onClose }) {
  onOpen?.();
  const display = previewElement('section', 'component-preview-display');
  const toolbar = previewElement('div', 'component-preview-toolbar');
  const dataStatus = previewElement('span', 'component-preview-data-label', dataLabel);
  const backgroundLabel = previewElement('label', '', '检查底色');
  const background = previewElement('select');
  background.setAttribute('aria-label', `${title}检查底色`);
  for (const [value, text] of [['checker', '透明棋盘'], ['dark', '深色'], ['light', '浅色']]) {
    const option = previewElement('option', '', text);
    option.value = value;
    background.append(option);
  }
  backgroundLabel.append(background);
  toolbar.append(dataStatus, backgroundLabel);
  const stage = previewElement('div', 'component-preview-stage');
  stage.dataset.background = 'checker';
  const frame = previewElement('iframe', 'component-preview-frame');
  frame.title = `${title}展示预览`;
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.allow = 'autoplay';
  const output = previewElement('p', 'component-preview-output');
  const dimensions = previewElement('span', 'component-preview-dimensions');
  const loadState = previewElement('p', 'component-preview-load-state', '正在加载预览…');
  loadState.setAttribute('role', 'status');
  stage.append(frame, dimensions, loadState);
  display.append(toolbar, stage, output);
  host.append(display);
  let closed = false;
  let ready = false;
  let previousConfig;
  let focusTimer = 0;
  let dataGeneration = 0;
  let stopData = null;
  let mode = dataModes?.[0]?.value;
  const send = (type, values = {}) => {
    if (!closed) frame.contentWindow?.postMessage({ type: `component-preview:${type}`, ...values }, '*');
  };
  function fit() {
    const state = controller.getState();
    const [width, height] = size(state.draft);
    const scale = Math.min(stage.clientWidth / width, stage.clientHeight / height, 1);
    frame.style.width = `${width}px`;
    frame.style.height = `${height}px`;
    frame.style.transform = `scale(${scale})`;
    output.textContent = `输出视口 ${width} × ${height} · 适应窗口 ${Math.round(scale * 100)}%`;
    const region = bounds?.(state.draft) || { x: 0, y: 0, width, height };
    dimensions.textContent = `${region.width} × ${region.height} px`;
    dimensions.setAttribute('aria-label', `${title}尺寸：宽 ${region.width} 像素，高 ${region.height} 像素`);
    dimensions.hidden = !ready || !state.loaded;
    const labelWidth = dimensions.offsetWidth;
    const labelHeight = dimensions.offsetHeight;
    const frameRect = frame.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const offsetX = frameRect.left - stageRect.left;
    const offsetY = frameRect.top - stageRect.top;
    const inside = region.width * scale >= labelWidth + 16 && region.height * scale >= labelHeight + 16;
    let top = offsetY + region.y * scale + (inside ? 8 : -labelHeight - 6);
    if (top < 8) top = offsetY + (region.y + region.height) * scale + 6;
    const left = offsetX + (region.x + region.width) * scale - labelWidth - (inside ? 8 : 0);
    dimensions.style.left = `${Math.max(8, Math.min(left, stage.clientWidth - labelWidth - 8))}px`;
    dimensions.style.top = `${Math.max(8, Math.min(top, stage.clientHeight - labelHeight - 8))}px`;
  }
  function update(state) {
    const values = { config: projectConfig(state.draft), editable: state.loaded };
    const serialized = JSON.stringify(values);
    if (serialized === previousConfig) return;
    if (ready) { send('config', values); previousConfig = serialized; }
    fit();
  }
  function trackFrameFocus() {
    window.clearTimeout(focusTimer);
    focusTimer = window.setTimeout(() => {
      display.classList.toggle('is-editing', document.activeElement === frame);
    }, 0);
  }
  function beginData() {
    stopData?.();
    const source = ++dataGeneration;
    stopData = startData?.({ mode, emit: (data) => {
      if (!closed && source === dataGeneration) send('data', { source, data });
    } });
  }
  if (dataModes?.length) {
    dataStatus.hidden = true;
    const label = previewElement('label', '', '展示数据');
    const select = previewElement('select');
    select.setAttribute('aria-label', `${title}展示数据`);
    for (const choice of dataModes) {
      const option = previewElement('option', '', choice.label);
      option.value = choice.value;
      select.append(option);
    }
    select.addEventListener('change', () => {
      mode = select.value;
      if (ready) beginData();
    });
    label.append(select);
    toolbar.prepend(label);
  }
  function receive(event) {
    if (closed || event.source !== frame.contentWindow || event.origin !== 'null') return;
    if (event.data?.type === 'component-preview:ready') {
      ready = true;
      window.clearTimeout(loadTimer);
      loadState.hidden = true;
      fit();
      const state = controller.getState();
      const values = { config: projectConfig(state.draft), editable: state.loaded };
      send('init', values);
      previousConfig = JSON.stringify(values);
      beginData();
    } else if (event.data?.type === 'component-preview:edit' && controller.getState().loaded) {
      onEdit?.(event.data.change);
    } else if (event.data?.type === 'component-preview:resize' && ready && controller.getState().loaded) {
      const size = event.data.size;
      if (Number.isFinite(size?.width) && size.width > 0 && Number.isFinite(size.height) && size.height > 0) onResize?.(size);
    } else if (event.data?.type === 'component-preview:status') {
      loadState.textContent = String(event.data.message || '预览加载失败，请关闭后重试。');
      loadState.hidden = false;
    }
  }
  const observer = new ResizeObserver(fit);
  observer.observe(stage);
  const unsubscribe = controller.subscribe(update);
  const loadTimer = window.setTimeout(() => {
    if (!ready && !closed) loadState.textContent = '预览未能加载，请关闭后重试。';
  }, 12000);
  background.addEventListener('change', () => { stage.dataset.background = background.value; });
  window.addEventListener('focus', trackFrameFocus);
  window.addEventListener('blur', trackFrameFocus);
  window.addEventListener('message', receive);
  frame.src = url;
  return { fit, dispose() {
    if (closed) return;
    send('dispose');
    closed = true;
    dataGeneration += 1;
    stopData?.();
    unsubscribe();
    observer.disconnect();
    window.clearTimeout(loadTimer);
    window.clearTimeout(focusTimer);
    window.removeEventListener('focus', trackFrameFocus);
    window.removeEventListener('blur', trackFrameFocus);
    window.removeEventListener('message', receive);
    frame.remove();
    display.remove();
    onClose?.();
  } };
}
