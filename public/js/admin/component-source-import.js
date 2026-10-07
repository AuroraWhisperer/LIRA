import { previewElement } from './component-preview-surface.js';
import { normalizeBrowserSourceConfig } from '../shared/scene-browser-source.js';
import { MEDIA_STYLE_TYPES } from '../shared/component-media-style.js';

const RESOURCE_EXTENSIONS = /\.(html?|css|m?js|json|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf)$/i;

export function createWebUpload(files) {
  return new Blob([`${JSON.stringify(files.map(({ path, file }) => ({ path, size: file.size })))}\n`, ...files.map(value => value.file)], { type: 'application/octet-stream' });
}

export function openComponentSourceImport({ type, request, onSaved, onUse, onMedia, onArchive, initialFile }) {
  const dialog = previewElement('dialog', 'component-style-dialog component-source-import');
  dialog.setAttribute('aria-label', '添加第三方样式');
  const form = previewElement('form');
  const title = previewElement('h2', '', '添加样式');
  const modes = previewElement('div', 'component-source-modes');
  const local = previewElement('section');
  const css = previewElement('section');
  const remote = previewElement('section');
  const status = previewElement('p', 'hint'); status.setAttribute('role', 'status');
  const details = previewElement('div', 'component-style-fields');
  function field(label, tag = 'input') {
    const wrapper = previewElement('label', '', label); const input = previewElement(tag);
    wrapper.append(input); details.append(wrapper); return input;
  }
  const name = field('样式名称'); name.maxLength = 80; name.placeholder = '默认使用文件名';
  const width = field('网页宽度'); const height = field('网页高度');
  for (const input of [width, height]) { input.type = 'number'; input.min = 32; input.max = 7680; input.required = true; }
  width.value = type === 'danmaku' ? 480 : 800; height.value = type === 'danmaku' ? 720 : 600;
  const textLabel = previewElement('label', '', 'CSS 代码'); const text = previewElement('textarea');
  text.rows = 9; text.maxLength = 1024 * 1024; text.spellcheck = false; text.placeholder = '粘贴作者提供的完整 CSS'; textLabel.append(text);
  css.append(textLabel, previewElement('p', 'hint', '弹幕样式自动识别 blivechat / BLC；其他 CSS 应用于当前组件。配套本地图片、字体请一起选择。'));
  const urlLabel = previewElement('label', '', '浏览器源地址'); const url = previewElement('input');
  url.type = 'url'; url.placeholder = 'https://…'; url.autocomplete = 'off'; url.spellcheck = false; url.maxLength = 8192; urlLabel.append(url);
  remote.append(urlLabel, previewElement('p', 'hint', '粘贴作者提供的完整展示地址。外部网页的数据和样式由原工具提供。'));
  const entryLabel = previewElement('label', '', '入口文件'); const entry = previewElement('select'); entryLabel.append(entry); entryLabel.hidden = true;
  const choices = previewElement('div', 'component-source-modes');
  const file = previewElement('input'); file.type = 'file'; file.accept = '.html,.htm,.css'; file.hidden = true;
  const folder = previewElement('input'); folder.type = 'file'; folder.webkitdirectory = true; folder.multiple = true; folder.hidden = true;
  let mode = 'file'; let files = []; let busy = false; let closed = false;
  const requests = new AbortController();
  const submit = previewElement('button', 'primary', '添加样式'); submit.type = 'submit';
  const close = previewElement('button', 'secondary', '取消'); close.type = 'button'; close.addEventListener('click', () => dialog.close());
  function describe() { return { type, name: name.value.trim(), width: Number(width.value), height: Number(height.value) }; }
  function action(host, label, run) {
    const button = previewElement('button', 'secondary', label); button.type = 'button';
    button.addEventListener('click', () => { if (!busy) void run(); }); host.append(button); return button;
  }
  async function save(work) {
    busy = true; submit.disabled = true; status.textContent = '正在导入素材…';
    try {
      const pack = await work();
      if (!closed && pack) { onSaved(pack); dialog.close(); }
      else if (!closed) status.textContent = '';
    } catch (error) {
      if (!closed) { status.textContent = error.message; if (error.code === 'FILE_PICKER_UNAVAILABLE') file.click(); }
    } finally { busy = false; submit.disabled = false; }
  }
  function selectFiles(selected) {
    const root = selected[0]?.webkitRelativePath?.split('/')[0];
    files = selected.filter(item => RESOURCE_EXTENSIONS.test(item.name)).map(item => ({ file: item,
      path: root ? item.webkitRelativePath.slice(root.length + 1) : item.name }));
    entry.replaceChildren();
    for (const value of files.filter(item => /\.(html?|css)$/i.test(item.path))) {
      const option = previewElement('option', '', value.path); option.value = value.path; entry.append(option);
    }
    const preferred = files.find(item => /(?:^|\/)index\.html?$/i.test(item.path)) || files.find(item => /\.html?$/i.test(item.path));
    if (preferred) entry.value = preferred.path;
    entryLabel.hidden = !entry.options.length;
    status.textContent = `${files.length} 个文件已选择；确认入口文件后添加。`;
  }
  for (const [value, label] of [['file', '本地文件'], ['css', '粘贴 CSS'], ['url', '浏览器源地址']]) {
    action(modes, label, () => setMode(value)).dataset.sourceMode = value;
  }
  function setMode(value) {
    mode = value; local.hidden = value !== 'file'; css.hidden = value !== 'css'; remote.hidden = value !== 'url';
    for (const button of modes.children) button.setAttribute('aria-pressed', String(button.dataset.sourceMode === value));
    status.textContent = '';
  }
  for (const [kind, label] of [['html', '选择 HTML 文件'], ['css', '选择 CSS 文件']]) {
    action(choices, label, () => {
      if (!form.reportValidity()) return;
      file.accept = kind === 'html' ? '.html,.htm' : '.css';
      return save(() => request('pick-web', { kind, description: describe(), signal: requests.signal }));
    });
  }
  action(choices, '选择素材文件夹', () => folder.click());
  local.append(previewElement('p', 'hint', '选择组件样式包或 HTML / CSS 文件。HTML / CSS 会自动保存同目录配套资源，也可选择素材文件夹。'), choices, entryLabel);
  action(css, '选择配套资源文件夹', () => folder.click());
  if (onArchive) action(local, '选择 LIRA 样式包（ZIP）', () => { dialog.close(); onArchive(); });
  if (MEDIA_STYLE_TYPES.includes(type)) action(local, '选择图片 / 视频', () => { dialog.close(); onMedia(); });
  file.addEventListener('change', () => { if (file.files[0]) selectFiles([...file.files]); file.value = ''; });
  folder.addEventListener('change', () => { if (folder.files.length) selectFiles([...folder.files]); folder.value = ''; });
  form.addEventListener('submit', event => {
    event.preventDefault(); if (busy) return;
    if (mode === 'url') {
      try {
        const config = normalizeBrowserSourceConfig({ url: url.value, viewportWidth: Number(width.value), viewportHeight: Number(height.value) });
        if (!url.value.trim()) throw new Error('请填写浏览器源地址。');
        void save(async () => { await onUse({ type: 'browser', name: name.value.trim() || '浏览器源', config }); return null; }).then(() => { if (!status.textContent) dialog.close(); });
      } catch (error) { status.textContent = error.message; }
      return;
    }
    let upload = files; let selectedEntry = entry.value;
    if (mode === 'css') {
      if (!text.value.trim()) { status.textContent = '请粘贴 CSS 代码。'; return; }
      selectedEntry = 'lira-pasted-style.css';
      upload = [...files.filter(item => item.path !== selectedEntry), { path: selectedEntry, file: new Blob([text.value], { type: 'text/css' }) }];
    }
    if (!selectedEntry) { status.textContent = '请先选择 HTML / CSS 文件或素材文件夹。'; return; }
    void save(() => request('web', { file: createWebUpload(upload), description: { ...describe(), entry: selectedEntry }, signal: requests.signal }));
  });
  dialog.addEventListener('close', () => { closed = true; requests.abort(); dialog.remove(); }, { once: true });
  form.append(title, modes, details, local, css, remote, status, submit, close, file, folder);
  dialog.append(form); document.body.append(dialog); dialog.showModal(); setMode('file');
  if (initialFile) selectFiles([initialFile]);
  return { dispose: () => dialog.close() };
}
