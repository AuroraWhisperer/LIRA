import { previewElement } from './component-preview-surface.js';
import { requestComponentStyles, loadComponentStyleCss } from './component-style-api.js';
import { editComponentMediaFile } from './component-style-editor.js';
import { MEDIA_STYLE_TITLES } from '../shared/component-media-style.js';
import { componentStyleMedia } from '../shared/component-resource-style.js';
import { openComponentSourceImport } from './component-source-import.js';
import { SCENE_EXTRA_COMPONENTS } from '../shared/scene-extra-components.js';

const styleTitle = type => MEDIA_STYLE_TITLES[type] || SCENE_EXTRA_COMPONENTS[type]?.title
  || ({ overtime: '加班机', browser: '浏览器源', 'text-box': '文本框' })[type] || '组件';
const isComponentSuite = pack => pack.isSuite;

export function mountComponentStyleLibrary(host, { type, request = requestComponentStyles, onUse, actionLabel = '添加到画布', inline = false, suitesOnly = false, renderList } = {}) {
  loadComponentStyleCss();
  const root = previewElement('section', 'component-style-library');
  root.classList.toggle('component-style-library-inline', inline);
  const header = previewElement('header');
  if (!suitesOnly) header.append(previewElement('h3', '', type ? '样式' : '样式与套装'));
  header.hidden = inline;
  const importButton = previewElement('button', 'secondary', '导入套装'); importButton.type = 'button';
  if (!type) header.append(importButton);
  const list = previewElement('div', 'component-style-list');
  const status = previewElement('p', 'hint'); status.setAttribute('role', 'status');
  status.hidden = inline;
  root.append(header, list, status); host.append(root);
  const requests = new AbortController();
  let editor; let closed = false; let revision = 0; let updateTarget = null;
  const add = type ? previewElement('button', 'component-style-add', '＋ 添加样式') : null;
  if (add) { add.type = 'button'; add.addEventListener('click', () => openImport()); }
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
  importButton.addEventListener('click', () => { updateTarget = null; zip.click(); });
  zip.addEventListener('change', async () => {
    const file = zip.files[0]; zip.value = ''; if (!file) return;
    const target = updateTarget; updateTarget = null;
    importButton.disabled = true; status.hidden = false; status.textContent = '正在读取素材包…';
    let pack;
    try {
      pack = await request('inspect', { file, signal: requests.signal });
      if (closed) return;
      if (target && pack.packageId !== target.packageId) {
        await request('cancel', { id: pack.id });
        throw new Error(`请选择「${target.name}」的更新包；其他套装请使用「导入套装」。`);
      }
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
      const replacing = suite && pack.replaces?.length > 0;
      if (replacing) dialog.append(previewElement('p', 'component-style-replacement',
        `将替换已安装版本 ${pack.replaces.map(item => item.version).join('、')} → ${pack.version}，样式库只保留本次导入的版本。`));
      const hint = previewElement('p', 'hint', suite
        ? replacing ? '已有场景保留原效果。请在画布选用新版组件，再保存并应用。'
          : '整套导入后可分别选用组件。选用并保存应用后才会改变直播。'
        : `添加到${styleTitle(type)}的更多样式中。选用并保存应用后才会改变直播。`);
      const install = previewElement('button', 'primary', replacing ? '替换套装' : suite ? '导入套装' : '添加样式'); const cancel = previewElement('button', 'secondary', '取消');
      const message = previewElement('p', 'hint'); message.setAttribute('role', 'status');
      let installed = false; let installing = false;
      install.type = cancel.type = 'button'; cancel.addEventListener('click', () => dialog.close());
      dialog.addEventListener('cancel', event => { if (installing) event.preventDefault(); });
      install.addEventListener('click', async () => {
        install.disabled = cancel.disabled = installing = true;
        try {
          const result = await request('install', { id: pack.id, signal: requests.signal });
          installed = true; dialog.close();
          await refresh(); report(result.alreadyInstalled ? '这个版本已经导入。' : result.replaced
            ? `已更新「${pack.name}」至 ${pack.version}，旧版已从样式库移除。已有场景保留原效果。`
            : `已导入「${pack.name}」，可在对应组件中选择。`);
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
  function confirmRemovePack(pack) {
    const dialog = previewElement('dialog', 'component-style-dialog'); dialog.setAttribute('aria-label', '删除套装');
    const confirm = previewElement('button', 'danger', '删除整套'); const cancel = previewElement('button', 'secondary', '取消');
    confirm.type = cancel.type = 'button';
    const message = previewElement('p', 'hint'); message.setAttribute('role', 'status');
    let removing = false;
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (removing) event.preventDefault(); });
    confirm.addEventListener('click', async () => {
      confirm.disabled = cancel.disabled = removing = true;
      try {
        await request('remove-pack', { id: pack.id, signal: requests.signal });
        dialog.close(); await refresh(); report(`已删除「${pack.name}」套装，已有场景保留原效果。`);
      } catch (error) { message.textContent = error.message; }
      finally { confirm.disabled = cancel.disabled = removing = false; }
    });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.append(previewElement('h2', '', `删除「${pack.name}」？`),
      previewElement('p', '', `版本 ${pack.version} · ${pack.styles.length} 个组件样式，将一起从样式库移除。`),
      previewElement('p', 'hint', '已有场景继续使用原来的素材，不会立即清理磁盘文件。重新导入原安装包可恢复整套。'),
      confirm, cancel, message);
    document.body.append(dialog); dialog.showModal();
    editor = { dispose: () => { if (!removing) dialog.close(); } };
  }
  async function refresh() {
    const current = ++revision;
    try {
      const packs = await request('list', { signal: requests.signal });
      if (closed || current !== revision) return;
      list.replaceChildren();
      const cards = [];
      for (const pack of packs) {
        const suite = isComponentSuite(pack);
        if (suitesOnly && !suite) continue;
        let cardHost = list;
        if (!type && suite) {
          const group = previewElement('section', 'component-style-suite'); group.setAttribute('aria-label', `${pack.name} ${pack.version}`);
          const heading = previewElement('header', 'component-style-suite-header');
          const title = previewElement('div', 'component-style-suite-title');
          title.append(previewElement('h4', '', pack.name), previewElement('p', 'hint', `版本 ${pack.version} · ${pack.styles.length} 个组件样式`));
          const actions = previewElement('div', 'component-style-suite-actions');
          const update = previewElement('button', 'secondary', '更新套装'); update.type = 'button';
          update.addEventListener('click', () => { updateTarget = pack; zip.click(); });
          const remove = previewElement('button', 'danger', '删除套装'); remove.type = 'button';
          remove.addEventListener('click', () => confirmRemovePack(pack));
          actions.append(update, remove); heading.append(title, actions);
          cardHost = previewElement('div', 'component-style-list');
          group.append(heading, cardHost); list.append(group);
          if (!pack.styles.length) cardHost.append(previewElement('p', 'hint', '这套的组件样式已移除，重新导入原安装包即可恢复。'));
        } else if (!type && pack.styles.length) {
          list.append(previewElement('h4', 'component-style-pack-heading', '单独添加的样式'));
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
        select.title = `${pack.packageId ? `${pack.name} ${pack.version} · ` : ''}${styleTitle(style.type)}`;
        select.addEventListener('click', async () => {
          select.disabled = true;
          try { await onUse?.(style); } catch (error) { report(error); }
          finally { select.disabled = false; }
        });
        card.append(select); cardHost.append(card); cards.push({ style, card });
        if (suite) continue;
        const remove = previewElement('button', 'component-style-delete', '×'); remove.type = 'button';
        remove.setAttribute('aria-label', `删除样式：${style.name}`); remove.title = `从样式库删除「${style.name}」，保留场景中已使用的组件`;
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          try { await request('remove', { id: style.id, signal: requests.signal }); await refresh(); report('已从样式库移除，现有场景仍可使用。'); }
          catch (error) { report(error); remove.disabled = false; }
        });
        card.append(remove);
        }
      }
      if (add) list.append(add);
      renderList?.({ list, cards, add });
      if (suitesOnly && !list.childElementCount) {
        const empty = previewElement('div', 'component-style-empty');
        empty.append(previewElement('h4', '', '还没有套装'), previewElement('p', 'hint', '点击「导入套装」，选择作者提供的 ZIP 安装包。'));
        list.append(empty);
      }
      status.textContent = type ? '支持 LIRA 样式包、HTML、CSS 和浏览器源；配套资源随文件保存。'
        : '套装整体导入、更新和删除；点击组件卡片可单独选用。单个样式请从对应组件「＋ 添加样式」添加。';
      status.hidden = inline;
    } catch (error) { if (!closed) report(error); }
  }
  if (!inline || renderList) window.addEventListener('focus', () => {
    if (root.closest('dialog')?.open) void refresh();
  }, { signal: requests.signal });
  renderList?.({ list, cards: [], add });
  void refresh();
  return { refresh, dispose() { closed = true; requests.abort(); editor?.dispose(); add?.remove(); root.remove(); } };
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
