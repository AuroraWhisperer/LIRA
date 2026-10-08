import { openingAppearanceFields } from '../shared/opening-appearance.js';
import { previewElement } from './component-preview-surface.js';
import { syncComponentFieldValue } from './component-preview-panel.js';

export function mountOpeningCanvasSettings(host, { target, request, startPreviewData }) {
  const root = previewElement('section', 'opening-canvas-settings');
  const heading = previewElement('h4');
  const hint = previewElement('p', 'hint', '修改后自动保存，与客户端及所有同样式组件同步。');
  const controls = previewElement('fieldset');
  const grid = previewElement('div', 'component-preview-fields preview-extra-fields');
  const status = previewElement('p', 'hint'); status.setAttribute('role', 'status');
  const retry = previewElement('button', 'secondary', '重新读取'); retry.type = 'button';
  controls.append(grid); root.append(heading, hint, controls, status, retry); host.append(root);
  const requests = new AbortController();
  const fields = new Map();
  const media = [];
  let config;
  let appearance = target.getState().draft;
  let busy = false;
  let lastSnapshot;
  let style;
  let failed = false;
  for (const [key, field] of Object.entries({ ...openingAppearanceFields('classic'),
    volume: { label: '音乐音量', type: 'range', min: 0, max: 100, step: 1 } })) {
    const label = previewElement('label', '', field.label);
    const input = previewElement(field.type === 'select' ? 'select' : 'input');
    input.dataset.openingParameter = key;
    if (field.type === 'select') {
      for (const [value, text] of Object.entries(field.options)) {
        const option = previewElement('option', '', text); option.value = value; input.append(option);
      }
    } else input.type = field.type;
    if (field.maxLength) input.maxLength = field.maxLength;
    if (key === 'volume') { input.min = '0'; input.max = '100'; input.step = '1'; }
    const output = key === 'volume' ? previewElement('output') : null;
    if (output) {
      label.append(output);
      input.addEventListener('input', () => { output.textContent = `${input.value}%`; });
    }
    input.addEventListener('change', () => {
      if (!input.reportValidity()) return;
      const value = input.type === 'checkbox' ? input.checked : key === 'volume' ? Number(input.value) / 100 : input.value;
      void perform('config', { patch: { [key]: value } });
    });
    label.append(input); grid.append(label); fields.set(key, { input, label, output });
  }
  function addMedia(kind, title, accept) {
    const section = previewElement('section', 'opening-canvas-media');
    const heading = previewElement('h4', '', title);
    const name = previewElement('p', 'hint');
    const actions = previewElement('div', 'opening-canvas-media-actions');
    const upload = previewElement('button', 'secondary', kind === 'character' ? '上传图片' : '上传歌曲'); upload.type = 'button';
    const input = previewElement('input'); input.type = 'file'; input.accept = accept;
    input.hidden = true;
    input.dataset.openingMedia = kind;
    const clear = previewElement('button', 'secondary'); clear.type = 'button';
    const note = previewElement('p', 'hint', kind === 'character'
      ? '支持 PNG、JPG、WebP，最大 16 MB。上传后自动播放人物动效，建议使用透明背景图片。'
      : '音乐随开播总开关播放；关闭时画布预览静音。');
    upload.addEventListener('click', () => input.click());
    actions.append(upload, clear, input); section.append(heading, name, actions);
    if (kind === 'music') section.append(fields.get('volume').label);
    section.append(note);
    if (kind === 'character') controls.prepend(section);
    else controls.append(section);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (file) await perform(kind, { file });
      input.value = '';
    });
    clear.addEventListener('click', () => { void perform(kind, { remove: true }); });
    media.push({ kind, heading, name, clear, note });
  }
  addMedia('character', '人物图片', 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp');
  addMedia('music', '开场音乐', 'audio/*,.mp3,.flac,.wav,.aac,.ogg,.m4a,.wma');

  function render() {
    root.hidden = Boolean(appearance.resourceStyle || appearance.mediaStyle);
    style = appearance.style === 'original' || !appearance.style ? config?.style : appearance.style;
    const current = config?.styles?.[style];
    const pixel = style === 'pixel-cassette';
    heading.textContent = `${pixel ? '像素卡带' : '经典舞台'}设置`;
    controls.disabled = busy || !current || !request;
    retry.hidden = !failed || busy;
    const available = openingAppearanceFields(style);
    for (const [key, { input, label, output }] of fields) {
      label.hidden = key !== 'volume' && !Object.hasOwn(available, key);
      if (!current) continue;
      if (input.type === 'checkbox') input.checked = current[key];
      else syncComponentFieldValue(input, key === 'volume' ? Math.round(current.volume * 100) : current[key]);
      if (output) output.textContent = `${input.value}%`;
    }
    for (const entry of media) {
      const character = entry.kind === 'character';
      entry.heading.textContent = character ? pixel ? '大头贴图片' : '人物图片' : '开场音乐';
      entry.name.textContent = (character ? pixel ? current?.pixelCharacterName : current?.characterName : current?.audioName)
        || (character ? pixel ? '未上传大头贴' : '未上传人物图' : '未上传音乐');
      entry.clear.textContent = character ? pixel ? '清除大头贴' : '清除人物图' : '清除音乐';
      if (character) entry.note.textContent = `${pixel ? '上传大头贴头像，与经典舞台的人物图分开保存。' : '上传完整人物图。'}默认不带图片。支持 PNG、JPG、WebP，最大 16 MB，建议使用透明背景。`;
      entry.clear.disabled = !(character ? pixel ? current?.pixelCharacterUrl : current?.characterUrl : current?.audioUrl);
    }
  }
  async function perform(kind, options = {}) {
    if (busy || !request) return;
    busy = true; failed = false;
    status.textContent = options.file ? '正在上传…' : options.patch || options.remove ? '正在保存…' : '正在读取开播设置…';
    render();
    try {
      const next = await request(kind, { ...options, style, signal: requests.signal });
      if (requests.signal.aborted) return;
      config = next;
      status.textContent = options.patch || options.file || options.remove ? '已同步到客户端和同样式组件。' : '';
    } catch (error) {
      if (requests.signal.aborted) return;
      failed = true;
      status.textContent = error.message;
    } finally { busy = false; render(); }
  }
  retry.addEventListener('click', () => { void perform('config'); });
  const stopTarget = target.subscribe(({ draft }) => { appearance = draft; render(); });
  const stopData = startPreviewData?.(display => {
    const next = display?.previewData?.opening;
    if (!next || busy || JSON.stringify(next) === lastSnapshot) return;
    lastSnapshot = JSON.stringify(next); config = next; render();
  });
  void perform('config');
  return { dispose() { requests.abort(); stopTarget(); stopData?.(); root.remove(); } };
}
