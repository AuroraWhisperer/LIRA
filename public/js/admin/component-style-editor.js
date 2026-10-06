import { previewElement } from './component-preview-surface.js';
import { createMediaStyle, MEDIA_STYLE_TITLES } from '../shared/component-media-style.js';
import { loadComponentStyleCss } from './component-style-api.js';
import { syncComponentFieldValue } from './component-preview-panel.js';

export function mountMediaStyleFields(host, initial, change, type) {
  let value = structuredClone(initial);
  const inputs = [];
  function field(label, key, kind, min, max, step = 1, parent = host) {
    const wrapper = previewElement('label', '', label);
    const input = previewElement('input'); input.type = kind; input.dataset.mediaField = key;
    input.value = value[key];
    if (kind === 'number') { input.min = min; input.max = max; input.step = step; input.required = true; }
    if (kind === 'checkbox') input.checked = value[key];
    input.addEventListener(kind === 'color' || kind === 'text' ? 'input' : 'change', () => {
      if (!input.checkValidity()) return;
      value[key] = kind === 'number' ? Number(input.value) : kind === 'checkbox' ? input.checked : input.value;
      change(structuredClone(value));
    });
    wrapper.append(input); parent.append(wrapper); inputs.push(input);
    return input;
  }
  const event = ['opening', 'gift-frame', 'guard-thanks'].includes(type);
  if (event) {
    field('显示感谢文字', 'showText', 'checkbox');
    field('感谢文案', 'textTemplate', 'text').maxLength = 160;
    host.append(previewElement('p', 'hint', '可用：{name} 观众、{gift} 礼物、{count} 数量、{tier} 舰长等级。'));
  }
  if (type !== 'background') {
    field('文字颜色', 'textColor', 'color');
    field('文字大小', 'fontSize', 'number', 12, 200);
  }
  const details = previewElement('details', 'component-style-advanced');
  details.append(previewElement('summary', '', '位置与播放设置'));
  const grid = previewElement('div', 'component-style-fields'); details.append(grid); host.append(details);
  const areas = {};
  if (type !== 'background') {
    for (const [key, label] of [['x', '左边距 %'], ['y', '上边距 %'], ['width', '内容宽度 %'], ['height', '内容高度 %']]) {
      const wrapper = previewElement('label', '', label); const input = previewElement('input');
      input.type = 'number'; input.min = key === 'x' || key === 'y' ? 0 : 5; input.max = 100; input.step = 0.1;
      input.value = value.content[key]; input.required = true; input.dataset.mediaArea = key; areas[key] = input;
      input.addEventListener('change', () => {
        if (!input.checkValidity()) return;
        const area = { ...value.content, [key]: Number(input.value) };
        if (area.x + area.width > 100 || area.y + area.height > 100) { input.setCustomValidity('内容区域必须在素材范围内。'); input.reportValidity(); return; }
        value.content = area; change(structuredClone(value));
      });
      input.addEventListener('input', () => input.setCustomValidity(''));
      wrapper.append(input); grid.append(wrapper); inputs.push(input);
    }
  }
  if (event) {
    field('播放时长（毫秒）', 'durationMs', 'number', 250, 120000, 250, grid);
    field('文字延迟（毫秒）', 'textDelayMs', 'number', 0, 60000, 100, grid);
  }
  if (value.kind === 'video') field('音量（0 为静音）', 'volume', 'number', 0, 1, 0.05, grid);
  return {
    update(next, force = false) {
      value = structuredClone(next);
      for (const input of inputs) {
        const current = input.dataset.mediaArea ? value.content[input.dataset.mediaArea] : value[input.dataset.mediaField];
        if (input.type === 'checkbox') input.checked = current;
        else syncComponentFieldValue(input, current, force);
      }
    },
    setArea(area) { value.content = area; for (const [key, input] of Object.entries(areas)) { input.value = area[key]; input.setCustomValidity(''); } change(structuredClone(value)); },
    read: () => structuredClone(value),
    valid: () => inputs.every(input => input.reportValidity()),
  };
}

export function editComponentMediaFile(file, type, { request, onSaved, onError }) {
  loadComponentStyleCss();
  const requests = new AbortController();
  const dialog = previewElement('dialog', 'component-style-dialog'); dialog.setAttribute('aria-label', `添加${MEDIA_STYLE_TITLES[type]}`);
  const heading = previewElement('header'); heading.append(previewElement('h2', '', `添加${MEDIA_STYLE_TITLES[type]}`));
  const close = previewElement('button', 'secondary', '取消'); close.type = 'button'; heading.append(close);
  const layout = previewElement('div', 'component-style-editor');
  const preview = previewElement('div', 'component-style-preview');
  const form = previewElement('form', 'component-style-form');
  const nameLabel = previewElement('label', '', '样式名称'); const name = previewElement('input');
  name.value = file.name.replace(/\.[^.]+$/, '').slice(0, 80); name.maxLength = 80; name.required = true; nameLabel.append(name); form.append(nameLabel);
  const fields = previewElement('div', 'component-style-fields'); form.append(fields);
  const status = previewElement('p', 'hint', '正在读取素材…'); status.setAttribute('role', 'status');
  const save = previewElement('button', 'primary', '添加样式'); save.type = 'submit'; save.disabled = true;
  form.append(status, save); layout.append(preview, form); dialog.append(heading, layout); document.body.append(dialog);
  let disposed = false; let busy = false; let editor; let media;
  const objectUrl = URL.createObjectURL(file);
  const isVideo = /\.(mp4|webm)$/i.test(file.name);
  function dispose() {
    if (disposed) return; disposed = true; requests.abort();
    if (isVideo) { media?.pause(); media?.removeAttribute('src'); media?.load(); }
    URL.revokeObjectURL(objectUrl); dialog.remove();
  }
  close.addEventListener('click', () => dialog.close()); dialog.addEventListener('close', dispose);
  dialog.showModal();
  media = previewElement(isVideo ? 'video' : 'img');
  media.src = objectUrl; media.draggable = false;
  if (isVideo) { media.muted = true; media.playsInline = true; media.loop = type === 'background'; media.controls = true; }
  else media.alt = file.name;
  preview.append(media);
  const area = previewElement('div', 'component-style-area'); area.tabIndex = 0; area.setAttribute('aria-label', '内容区域，拖动调整位置，方向键微调');
  const sample = previewElement('span', '', type === 'clock' ? '12:34:56' : type === 'danmaku' ? '观众A：晚上好！\n观众B：今天也来听歌' : type === 'gift-wishes' ? '今日心愿\n水晶球 12 / 100' : '感谢 观众A 的礼物');
  const resize = previewElement('span', 'component-style-area-resize'); resize.setAttribute('aria-label', '拖动调整内容区域大小');
  area.append(sample, resize); if (type !== 'background') preview.append(area);
  const render = value => {
    Object.assign(area.style, { left: `${value.content.x}%`, top: `${value.content.y}%`, width: `${value.content.width}%`, height: `${value.content.height}%`, color: value.textColor });
    sample.style.fontSize = `${Math.max(12, value.fontSize * preview.clientWidth / value.width)}px`;
    if (isVideo) { media.volume = value.volume; media.muted = value.volume === 0; }
  };
  const ready = () => {
    if (disposed || editor) return;
    const width = isVideo ? media.videoWidth : media.naturalWidth; const height = isVideo ? media.videoHeight : media.naturalHeight;
    if (!width || !height || width > 7680 || height > 7680) { status.textContent = '素材尺寸无效或超过 7680 像素。'; return; }
    preview.style.aspectRatio = `${width} / ${height}`;
    const style = createMediaStyle(type, { width, height, kind: isVideo ? 'video' : 'image' });
    if (isVideo && Number.isFinite(media.duration)) style.durationMs = Math.min(120000, Math.max(250, Math.ceil(media.duration * 4) * 250));
    if (type === 'opening') style.showText = false;
    editor = mountMediaStyleFields(fields, style, render, type); render(style); save.disabled = false;
    status.textContent = type === 'background' ? '添加后可在背景样式中选择。' : '拖动虚线框调整内容位置，拖动右下角调整大小。';
  };
  media.addEventListener(isVideo ? 'loadeddata' : 'load', ready, { once: true });
  media.addEventListener('error', () => { status.textContent = '无法播放此素材，请转换为 PNG、MP4（H.264）或 WebM 后重试。'; save.disabled = true; });
  let drag;
  area.addEventListener('pointerdown', event => {
    if (!editor || busy || event.button !== 0) return;
    event.preventDefault(); const bounds = preview.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, bounds, original: editor.read().content, resize: event.target === resize };
    area.setPointerCapture(event.pointerId);
  });
  area.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = (event.clientX - drag.x) * 100 / drag.bounds.width; const dy = (event.clientY - drag.y) * 100 / drag.bounds.height;
    const next = { ...drag.original }; const clamp = (value, min, max) => Math.round(Math.max(min, Math.min(max, value)) * 10) / 10;
    if (drag.resize) { next.width = clamp(next.width + dx, 5, 100 - next.x); next.height = clamp(next.height + dy, 5, 100 - next.y); }
    else { next.x = clamp(next.x + dx, 0, 100 - next.width); next.y = clamp(next.y + dy, 0, 100 - next.height); }
    editor.setArea(next);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) area.addEventListener(event, () => { drag = null; });
  area.addEventListener('keydown', event => {
    if (!editor || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); const next = editor.read().content;
    next.x = Math.max(0, Math.min(100 - next.width, next.x + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)));
    next.y = Math.max(0, Math.min(100 - next.height, next.y + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)));
    editor.setArea(next);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!editor || busy || !editor.valid()) return;
    busy = true; save.disabled = true; status.textContent = '正在添加素材，请稍候…';
    try {
      const value = editor.read(); const { width, height, kind, ...appearance } = value;
      const pack = await request('add', { file, description: { type, filename: file.name, name: name.value.trim(), width, height, media: appearance }, signal: requests.signal });
      if (!disposed) { onSaved(pack); dialog.close(); }
    } catch (error) { if (!disposed) { status.textContent = error.message; onError?.(error); } }
    finally { busy = false; save.disabled = false; }
  });
  return { dispose: () => dialog.close() };
}
