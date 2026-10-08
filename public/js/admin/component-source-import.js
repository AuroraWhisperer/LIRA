import { previewElement } from './component-preview-surface.js';
import { normalizeBrowserSourceConfig } from '../shared/scene-browser-source.js';
import { MEDIA_STYLE_TYPES } from '../shared/component-media-style.js';

const RESOURCE_EXTENSIONS = /\.(html?|css|m?js|json|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3|wav|ogg|woff2?|ttf|otf)$/i;

export function createWebUpload(files) {
  return new Blob([`${JSON.stringify(files.map(({ path, file }) => ({ path, size: file.size })))}\n`, ...files.map(value => value.file)], { type: 'application/octet-stream' });
}

export function openComponentSourceImport({ type, request, onSaved, onUse, onMedia, onArchive }) {
  const dialog = previewElement('dialog', 'component-style-dialog component-source-import');
  dialog.setAttribute('aria-label', '添加第三方样式');
  const form = previewElement('form');
  const title = previewElement('h2', '', '添加样式');
  const hint = previewElement('p', 'hint', '选择下载好的文件，LIRA 会自动识别并添加。');
  const heading = previewElement('div', 'component-source-heading'); heading.append(title, hint);
  const paste = previewElement('details');
  paste.append(previewElement('summary', '', '粘贴网址或代码'));
  const textLabel = previewElement('label', '', '作者提供的网址或代码');
  const text = previewElement('textarea');
  text.rows = 5; text.maxLength = 1024 * 1024; text.spellcheck = false;
  text.placeholder = '把作者发来的网址或整段样式代码粘贴到这里'; textLabel.append(text); paste.append(textLabel);
  const advanced = previewElement('details', 'component-style-advanced');
  const advancedSummary = previewElement('summary', '', '更多设置');
  advancedSummary.append(previewElement('span', 'component-source-optional', '（通常不用改）')); advanced.append(advancedSummary);
  const details = previewElement('div', 'component-style-fields');
  function field(label) {
    const wrapper = previewElement('label', '', label); const input = previewElement('input');
    wrapper.append(input); details.append(wrapper); return input;
  }
  const name = field('样式名称'); name.maxLength = 80; name.placeholder = '自动命名';
  const width = field('显示宽度'); const height = field('显示高度');
  for (const input of [width, height]) { input.type = 'number'; input.min = 32; input.max = 7680; input.required = true; }
  width.value = type === 'danmaku' ? 480 : 800; height.value = type === 'danmaku' ? 720 : 600;
  const entryLabel = previewElement('label', '', '要使用的样式文件');
  const entry = previewElement('select'); entryLabel.append(entry); entryLabel.hidden = true;
  const file = previewElement('input'); file.type = 'file';
  file.accept = '.html,.htm,.css,.zip,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm'; file.hidden = true;
  const folder = previewElement('input'); folder.type = 'file'; folder.webkitdirectory = true; folder.multiple = true; folder.hidden = true;
  const status = previewElement('p', 'hint'); status.setAttribute('role', 'status');
  let files = []; let busy = false; let closed = false;
  const requests = new AbortController();
  const submit = previewElement('button', 'primary', '添加样式'); submit.type = 'submit'; submit.hidden = true;
  const close = previewElement('button', 'secondary', '取消'); close.type = 'button'; close.addEventListener('click', () => dialog.close());
  function describe() { return { type, name: name.value.trim(), width: Number(width.value), height: Number(height.value) }; }
  function action(host, label, run) {
    const button = previewElement('button', 'secondary', label); button.type = 'button';
    button.addEventListener('click', () => { if (!busy) void run(); }); host.append(button); return button;
  }
  function valid() {
    if (![name, width, height].every(input => input.checkValidity())) advanced.open = true;
    return form.reportValidity();
  }
  async function save(work) {
    busy = true; submit.disabled = pick.disabled = true; status.textContent = '正在读取样式…';
    try {
      const result = await work();
      if (closed) return;
      if (result?.file) { status.textContent = ''; selectFile(result.file); }
      else if (result) { onSaved(result); dialog.close(); }
      else status.textContent = '';
    } catch (error) {
      if (!closed) {
        status.textContent = error.code === 'FILE_PICKER_UNAVAILABLE' ? '' : error.message;
        if (error.code === 'FILE_PICKER_UNAVAILABLE') file.click();
      }
    } finally { busy = false; submit.disabled = pick.disabled = false; }
  }
  function selectFiles(selected) {
    const root = selected[0]?.webkitRelativePath?.split('/')[0];
    files = selected.filter(item => RESOURCE_EXTENSIONS.test(item.name)).map(item => ({ file: item,
      path: root ? item.webkitRelativePath.slice(root.length + 1) : item.name }));
    const entries = files.filter(item => /\.(html?|css)$/i.test(item.path));
    const html = entries.filter(item => /\.html?$/i.test(item.path));
    const indexes = html.filter(item => /(?:^|\/)index\.html?$/i.test(item.path));
    const preferred = html.find(item => /^index\.html?$/i.test(item.path))
      || (indexes.length === 1 ? indexes[0] : html.length === 1 ? html[0] : entries.length === 1 ? entries[0] : null);
    entry.replaceChildren();
    if (!preferred) { const option = previewElement('option', '', '请选择要使用的样式'); option.value = ''; entry.append(option); }
    for (const value of entries) {
      const option = previewElement('option', '', value.path); option.value = value.path; entry.append(option);
    }
    if (preferred) entry.value = preferred.path;
    entryLabel.hidden = entries.length < 2;
    const pasting = paste.open && text.value.trim();
    if (!pasting && entries.length > 1 && !preferred) advanced.open = true;
    updateActions();
    status.textContent = pasting ? `已带上 ${files.length} 个配套文件。`
      : preferred ? `已选择「${preferred.file.name}」，点击添加即可。`
        : entries.length ? '文件夹里有多个样式，请在更多设置中选择要用的一个。' : '没有找到样式文件，请重新选择，或粘贴作者提供的代码。';
  }
  function selectFile(selected) {
    if (/\.(html?|css)$/i.test(selected.name)) {
      text.value = ''; paste.open = false; selectFiles([selected]); return;
    }
    if (/\.zip$/i.test(selected.name) && onArchive) { dialog.close(); onArchive(selected); return; }
    if (/\.(png|jpe?g|gif|webp|mp4|webm)$/i.test(selected.name)) {
      if (!MEDIA_STYLE_TYPES.includes(type)) { status.textContent = '这个组件不能使用图片或视频，请选择作者提供的样式文件。'; return; }
      if (selected.size > 512 * 1024 * 1024) { status.textContent = '单个素材不能超过 512 MiB。'; return; }
      dialog.close(); onMedia(selected); return;
    }
    status.textContent = '暂不支持这个文件，请选择样式文件、图片、视频或样式压缩包。';
  }
  const pick = action(form, '选择文件', () => {
    if (valid()) return save(() => request('pick-web', { kind: 'auto', description: describe(), signal: requests.signal }));
  });
  pick.className = 'primary component-source-file';
  const fileIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  fileIcon.setAttribute('viewBox', '0 0 24 24'); fileIcon.setAttribute('aria-hidden', 'true'); fileIcon.setAttribute('focusable', 'false');
  const fileShape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  fileShape.setAttribute('d', 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8m-8 4h5');
  fileIcon.append(fileShape); pick.prepend(fileIcon);
  advanced.append(details, entryLabel);
  action(advanced, '选择整个素材文件夹', () => folder.click());
  advanced.append(previewElement('p', 'hint', '作者提供了配套图片或字体时可选。保留原来的文件夹结构即可。'));
  function updateActions() {
    submit.hidden = !paste.open && !files.length;
    pick.classList.toggle('primary', submit.hidden); pick.classList.toggle('secondary', !submit.hidden);
  }
  paste.addEventListener('toggle', updateActions);
  file.addEventListener('change', () => { if (file.files[0]) selectFile(file.files[0]); file.value = ''; });
  folder.addEventListener('change', () => { if (folder.files.length) selectFiles([...folder.files]); folder.value = ''; });
  form.noValidate = true;
  form.addEventListener('submit', event => {
    event.preventDefault(); if (busy || !valid()) return;
    const pasted = paste.open ? text.value.trim() : '';
    if (paste.open && !pasted) { status.textContent = '请先粘贴作者提供的网址或代码。'; text.focus(); return; }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pasted)) {
      try {
        const config = normalizeBrowserSourceConfig({ url: pasted, viewportWidth: Number(width.value), viewportHeight: Number(height.value) });
        void save(async () => {
          await onUse({ type: 'browser', name: name.value.trim() || new URL(config.url).hostname, config });
          if (!closed) dialog.close();
          return null;
        });
      } catch (error) { status.textContent = error.message; }
      return;
    }
    let upload = files; let selectedEntry = entry.value;
    if (pasted) {
      const html = pasted.startsWith('<');
      if (!html && !/[{}]|@import\s/i.test(pasted)) { status.textContent = '没有识别出网址或样式代码，请完整复制作者提供的内容。'; return; }
      selectedEntry = html ? 'lira-pasted-style.html' : 'lira-pasted-style.css';
      upload = [...files.filter(item => item.path !== selectedEntry), { path: selectedEntry, file: new Blob([pasted], { type: html ? 'text/html' : 'text/css' }) }];
    }
    if (!selectedEntry) { status.textContent = files.length ? '请在更多设置中选择要使用的样式文件。' : '请先选择文件，或粘贴作者提供的网址或代码。'; return; }
    const description = { ...describe(), entry: selectedEntry };
    if (pasted && !description.name) description.name = '粘贴的样式';
    void save(() => request('web', { file: createWebUpload(upload), description, signal: requests.signal }));
  });
  dialog.addEventListener('close', () => { closed = true; requests.abort(); dialog.remove(); }, { once: true });
  const options = previewElement('div', 'component-source-options'); options.append(paste, advanced);
  const actions = previewElement('div', 'component-source-actions'); actions.append(close, submit);
  form.prepend(heading); form.append(options, status, actions, file, folder);
  dialog.append(form); document.body.append(dialog); dialog.showModal();
  return { dispose: () => dialog.close() };
}
