import { previewElement } from './component-preview-surface.js';
import { requestComponentStyles, loadComponentStyleCss } from './component-style-api.js';
import { editComponentMediaFile } from './component-style-editor.js';
import { MEDIA_STYLE_TITLES } from '../shared/component-media-style.js';
import { componentStyleMedia } from '../shared/component-resource-style.js';
import { openComponentSourceImport } from './component-source-import.js';
import { SCENE_EXTRA_COMPONENTS } from '../shared/scene-extra-components.js';

const styleTitle = type => MEDIA_STYLE_TITLES[type] || SCENE_EXTRA_COMPONENTS[type]?.title
  || ({ overtime: '加班机', browser: '浏览器源', 'text-box': '文本框' })[type] || '组件';
const isComponentSuite = pack => new Set(pack.styles.map(style => style.category || style.type)).size > 1;

export function mountComponentStyleLibrary(host, { type, request = requestComponentStyles, onUse, actionLabel = '添加到画布', inline = false, suitesOnly = false } = {}) {
  loadComponentStyleCss();
  const root = previewElement('section', 'component-style-library');
  root.classList.toggle('component-style-library-inline', inline);
  const header = previewElement('header');
  if (!suitesOnly) header.append(previewElement('h3', '', type ? '本机样式' : '样式与套装'));
  header.hidden = inline;
  const importButton = previewElement('button', 'secondary', '导入套装'); importButton.type = 'button';
  if (!type) header.append(importButton);
  const list = previewElement('div', 'component-style-list');
  const status = previewElement('p', 'hint'); status.setAttribute('role', 'status');
  status.hidden = inline;
  root.append(header, list, status); host.append(root);
  const requests = new AbortController();
  let editor; let closed = false; let revision = 0;
  function report(error) { status.hidden = false; status.textContent = error.message || error; }
  function openImport(initialFile) {
    editor = openComponentSourceImport({ type, request, initialFile, onMedia: () => input.click(),
      onArchive: () => zip.click(),
      onSaved: () => { void refresh(); }, onUse });
  }
  const input = previewElement('input'); input.type = 'file'; input.accept = '.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.html,.htm,.css'; input.hidden = true;
  root.append(input);
  input.addEventListener('change', () => {
    const file = input.files[0]; input.value = '';
    if (!file) return;
    if (file.size > 512 * 1024 * 1024) { report('单个素材不能超过 512 MiB。'); return; }
    if (/\.(html?|css)$/i.test(file.name)) { openImport(file); return; }
    editor = editComponentMediaFile(file, type, { request, onSaved: () => { void refresh(); }, onError: report });
  });
  const zip = previewElement('input'); zip.type = 'file'; zip.accept = '.zip'; zip.hidden = true; root.append(zip);
  importButton.addEventListener('click', () => zip.click());
  zip.addEventListener('change', async () => {
    const file = zip.files[0]; zip.value = ''; if (!file) return;
    importButton.disabled = true; status.hidden = false; status.textContent = '正在读取素材包…';
    let pack;
    try {
      pack = await request('inspect', { file, signal: requests.signal });
      if (closed) return;
      const suite = isComponentSuite(pack);
      const category = pack.styles[0].category || pack.styles[0].type;
      if ((type && (suite || category !== type)) || (!type && !suite)) {
        await request('cancel', { id: pack.id });
        throw new Error(suite ? '这是多个组件组合的套装，请到「样式与套装 → 导入套装」导入。'
          : `这是${styleTitle(category)}的样式包，请从该组件的「＋ 添加样式」导入。`);
      }
      status.textContent = '';
      const dialog = previewElement('dialog', 'component-style-dialog'); dialog.setAttribute('aria-label', suite ? '确认导入套装' : '确认添加样式');
      dialog.append(previewElement('h2', '', pack.name), previewElement('p', '', `版本 ${pack.version} · ${pack.styles.length} 个样式 · ${(pack.bytes / 1024 / 1024).toFixed(1)} MiB`));
      const members = previewElement('ul', 'component-style-pack-list');
      for (const style of pack.styles) members.append(previewElement('li', '', `${styleTitle(style.type)}：${style.name}`));
      const hint = previewElement('p', 'hint', suite
        ? '套装包含多个组件的样式，导入后可在各组件中选用。保存并应用后才会改变直播。'
        : `添加到${styleTitle(type)}的更多样式中。选用并保存应用后才会改变直播。`);
      const install = previewElement('button', 'primary', suite ? '导入套装' : '添加样式'); const cancel = previewElement('button', 'secondary', '取消');
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
        const suite = isComponentSuite(pack);
        if (suitesOnly && !suite) continue;
        if (!type && pack.styles.length) {
          const heading = previewElement('h4', 'component-style-pack-heading', suite
            ? `${pack.name} · ${pack.styles.length} 个样式` : '单独添加的样式');
          list.append(heading);
        }
        for (const style of pack.styles) {
        if (type && (style.category || style.type) !== type && !(type === 'browser' && style.type === 'browser')) continue;
        const card = previewElement('div', 'component-style-card'); card.dataset.customStyleId = style.id;
        const select = previewElement('button', 'component-style-select'); select.type = 'button';
        select.setAttribute('aria-label', `${actionLabel}：${style.name}`);
        const presentation = componentStyleMedia(style.config);
        const webStyle = ['html', 'css'].includes(presentation.kind);
        const media = previewElement(webStyle ? 'span' : presentation.kind === 'video' ? 'video' : 'img', webStyle ? 'component-source-thumbnail' : '',
          webStyle ? presentation.kind.toUpperCase() : '');
        if (!webStyle) media.src = presentation.src;
        if (media.tagName === 'VIDEO') { media.muted = true; media.preload = 'metadata'; } else if (!webStyle) { media.alt = ''; media.loading = 'lazy'; }
        const prefix = `${pack.name} · `;
        const caption = !inline && suite && style.name.startsWith(prefix) ? style.name.slice(prefix.length) : style.name;
        select.append(media, previewElement('span', '', caption));
        select.title = `${pack.packageId ? `${pack.name} ${pack.version} · ` : ''}${styleTitle(style.type)} · 本机`;
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
        add.addEventListener('click', () => openImport()); list.append(add);
      }
      status.textContent = type ? '支持 LIRA 样式包、HTML、CSS 和浏览器源；配套资源随文件保存。'
        : '套装由多个组件类型的样式组合而成；单个组件的样式请从对应组件「＋ 添加样式」添加。';
      status.hidden = inline;
    } catch (error) { if (!closed) report(error); }
  }
  if (!inline) window.addEventListener('focus', () => {
    if (root.closest('dialog')?.open) void refresh();
  }, { signal: requests.signal });
  void refresh();
  return { refresh, dispose() { closed = true; requests.abort(); editor?.dispose(); root.remove(); } };
}

export function openComponentStyleLibrary(options) {
  loadComponentStyleCss();
  const dialog = previewElement('dialog', 'component-style-dialog'); dialog.setAttribute('aria-label', options.type ? `${styleTitle(options.type)}样式` : '样式与套装');
  const close = previewElement('button', 'secondary', '关闭'); close.type = 'button'; close.addEventListener('click', () => dialog.close());
  dialog.append(close); document.body.append(dialog);
  const library = mountComponentStyleLibrary(dialog, { ...options, onUse: async style => { await options.onUse?.(style); dialog.close(); } });
  dialog.addEventListener('close', () => { library.dispose(); dialog.remove(); }, { once: true }); dialog.showModal();
  return { dispose: () => dialog.close() };
}
