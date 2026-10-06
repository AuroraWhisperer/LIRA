import { previewElement } from './component-preview-surface.js';
import { requestComponentStyles, loadComponentStyleCss } from './component-style-api.js';
import { editComponentMediaFile } from './component-style-editor.js';
import { MEDIA_STYLE_TITLES } from '../shared/component-media-style.js';
import { componentStyleMedia } from '../shared/component-resource-style.js';

export function mountComponentStyleLibrary(host, { type, request = requestComponentStyles, onUse, actionLabel = '添加到画布' } = {}) {
  loadComponentStyleCss();
  const root = previewElement('section', 'component-style-library');
  const header = previewElement('header'); header.append(previewElement('h3', '', type ? '本机样式' : '样式与套装'));
  const importButton = previewElement('button', 'secondary', '导入套装'); importButton.type = 'button'; header.append(importButton);
  const list = previewElement('div', 'component-style-list');
  const status = previewElement('p', 'hint'); status.setAttribute('role', 'status');
  root.append(header, list, status); host.append(root);
  const requests = new AbortController();
  let editor; let closed = false; let revision = 0;
  function report(error) { status.textContent = error.message || error; }
  const input = previewElement('input'); input.type = 'file'; input.accept = '.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm'; input.hidden = true;
  root.append(input);
  input.addEventListener('change', () => {
    const file = input.files[0]; input.value = '';
    if (!file) return;
    if (file.size > 512 * 1024 * 1024) { report('单个素材不能超过 512 MiB。'); return; }
    editor = editComponentMediaFile(file, type, { request, onSaved: () => { void refresh(); }, onError: report });
  });
  const zip = previewElement('input'); zip.type = 'file'; zip.accept = '.zip'; zip.hidden = true; root.append(zip);
  importButton.addEventListener('click', () => zip.click());
  zip.addEventListener('change', async () => {
    const file = zip.files[0]; zip.value = ''; if (!file) return;
    importButton.disabled = true; status.textContent = '正在读取套装…';
    let pack;
    try {
      pack = await request('inspect', { file, signal: requests.signal });
      if (closed) return;
      status.textContent = '';
      const dialog = previewElement('dialog', 'component-style-dialog'); dialog.setAttribute('aria-label', '确认导入套装');
      dialog.append(previewElement('h2', '', pack.name), previewElement('p', '', `版本 ${pack.version} · ${pack.styles.length} 个样式 · ${(pack.bytes / 1024 / 1024).toFixed(1)} MiB`));
      const members = previewElement('ul', 'component-style-pack-list');
      for (const style of pack.styles) members.append(previewElement('li', '', `${MEDIA_STYLE_TITLES[style.type]}：${style.name}`));
      const hint = previewElement('p', 'hint', '导入后加入对应组件的样式列表。可以逐项添加到画布，保存并应用后才会改变直播。');
      const install = previewElement('button', 'primary', '导入套装'); const cancel = previewElement('button', 'secondary', '取消');
      const message = previewElement('p', 'hint'); message.setAttribute('role', 'status');
      let installed = false; let installing = false;
      install.type = cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
      dialog.addEventListener('cancel', event => { if (installing) event.preventDefault(); });
      install.addEventListener('click', async () => {
        install.disabled = cancel.disabled = installing = true;
        try {
          const result = await request('install', { id: pack.id, signal: requests.signal });
          installed = true; dialog.close();
          await refresh(); report(result.alreadyInstalled ? '这个版本已经导入。' : `已导入「${pack.name}」，可在对应组件中选择。`);
        } catch (error) { message.textContent = error.message; }
        finally { install.disabled = cancel.disabled = installing = false; }
      });
      dialog.addEventListener('close', () => {
        dialog.remove();
        if (!installed) void request('cancel', { id: pack.id }).catch(report);
      }, { once: true });
      dialog.append(members, hint, install, cancel, message); document.body.append(dialog); dialog.showModal();
      editor = { dispose: () => { if (!installing) dialog.close(); } };
    } catch (error) { if (!closed) report(error); }
    finally { importButton.disabled = false; }
  });
  async function refresh() {
    const current = ++revision;
    try {
      const packs = await request('list', { signal: requests.signal });
      if (closed || current !== revision) return;
      list.replaceChildren();
      for (const pack of packs) {
        if (!type && pack.styles.length) {
          const heading = previewElement('h4', 'component-style-pack-heading', pack.packageId
            ? `${pack.name} · ${pack.styles.length} 个样式` : '单独添加的样式');
          list.append(heading);
        }
        for (const style of pack.styles) {
        if (type && style.type !== type) continue;
        const card = previewElement('div', 'component-style-card'); card.dataset.customStyleId = style.id;
        const select = previewElement('button', 'component-style-select'); select.type = 'button';
        select.setAttribute('aria-label', `${actionLabel}：${style.name}`);
        const presentation = componentStyleMedia(style.config);
        const media = previewElement(presentation.kind === 'video' ? 'video' : 'img'); media.src = presentation.src;
        if (media.tagName === 'VIDEO') { media.muted = true; media.preload = 'metadata'; } else { media.alt = ''; media.loading = 'lazy'; }
        const prefix = `${pack.name} · `;
        const caption = pack.packageId && style.name.startsWith(prefix) ? style.name.slice(prefix.length) : style.name;
        select.append(media, previewElement('span', '', caption));
        select.title = `${pack.packageId ? `${pack.name} ${pack.version} · ` : ''}${MEDIA_STYLE_TITLES[style.type]} · 本机`;
        select.addEventListener('click', async () => {
          select.disabled = true;
          try { await onUse?.(style); } catch (error) { report(error); }
          finally { select.disabled = false; }
        });
        const remove = previewElement('button', 'component-style-delete', '×'); remove.type = 'button';
        remove.setAttribute('aria-label', `删除样式：${style.name}`); remove.title = `从样式库删除「${style.name}」，保留场景中已使用的组件`;
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          try { await request('remove', { id: style.id, signal: requests.signal }); await refresh(); report('已从样式库移除，现有场景仍可使用。'); }
          catch (error) { report(error); remove.disabled = false; }
        });
        card.append(select, remove); list.append(card);
        }
      }
      if (type) {
        const add = previewElement('button', 'component-style-add', '＋ 添加样式'); add.type = 'button';
        add.addEventListener('click', () => input.click()); list.append(add);
      }
      status.textContent = '本机样式需要保持 LIRA 运行。第三方素材请先解压，再选择图片或视频。';
    } catch (error) { if (!closed) report(error); }
  }
  void refresh();
  return { refresh, dispose() { closed = true; requests.abort(); editor?.dispose(); root.remove(); } };
}

export function openComponentStyleLibrary(options) {
  loadComponentStyleCss();
  const dialog = previewElement('dialog', 'component-style-dialog'); dialog.setAttribute('aria-label', options.type ? `${MEDIA_STYLE_TITLES[options.type]}样式` : '样式与套装');
  const close = previewElement('button', 'secondary', '关闭'); close.type = 'button'; close.addEventListener('click', () => dialog.close());
  dialog.append(close); document.body.append(dialog);
  const library = mountComponentStyleLibrary(dialog, { ...options, onUse: async style => { await options.onUse?.(style); dialog.close(); } });
  dialog.addEventListener('close', () => { library.dispose(); dialog.remove(); }, { once: true }); dialog.showModal();
  return { dispose: () => dialog.close() };
}
