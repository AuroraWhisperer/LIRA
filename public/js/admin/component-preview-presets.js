import { previewElement, previewToolbarIcon } from './component-preview-surface.js';
import { enhanceSelects } from '../shared/select-menu.js';
import { showConfirmationDialog } from '../shared/confirmation-dialog.js';

export function mountPreviewPresets(host, { controller, connection, beforeChange, setBusy, report }) {
  const bar = previewElement('div', 'preview-canvas-presets');
  const label = previewElement('label', '', '场景');
  const select = previewElement('select');
  select.setAttribute('aria-label', '场景');
  label.append(select);
  const live = previewElement('span', 'preview-canvas-live-preset');
  const buttons = [];
  let disposed = false;
  let busy = false;
  let signature = '';
  bar.append(label);
  const more = previewElement('button', 'secondary preview-canvas-icon-button preview-canvas-preset-more');
  more.type = 'button';
  more.title = '场景操作：新建、复制、保存、删除';
  more.setAttribute('aria-label', '场景操作');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.append(previewToolbarIcon('more'));
  const menu = previewElement('div', 'preview-canvas-preset-menu');
  menu.id = 'previewPresetMenu';
  menu.popover = 'auto';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '场景操作');
  more.setAttribute('aria-controls', menu.id);
  more.popoverTargetElement = menu;
  bar.append(more, menu);
  buttons.push(more);
  const closeMenu = () => { if (menu.matches(':popover-open')) menu.hidePopover(); };
  menu.addEventListener('beforetoggle', event => {
    more.setAttribute('aria-expanded', String(event.newState === 'open'));
    if (event.newState !== 'open') return;
    const rect = more.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.right - 176, window.innerWidth - 184))}px`;
    menu.style.top = `${rect.bottom + 8}px`;
  });
  more.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (!menu.matches(':popover-open')) menu.showPopover({ source: more });
    (event.key === 'ArrowUp' ? menu.lastElementChild : menu.firstElementChild)?.focus();
  });
  menu.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const actions = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = actions.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) % actions.length;
    actions[next]?.focus();
  });
  window.addEventListener('resize', closeMenu);
  function button(text, action, className = 'secondary') {
    const node = previewElement('button', className, text);
    node.type = 'button';
    node.setAttribute('role', 'menuitem');
    node.autofocus = !menu.children.length;
    node.addEventListener('click', () => { closeMenu(); more.focus({ preventScroll: true }); action(); });
    buttons.push(node);
    menu.append(node);
    return node;
  }
  async function run(action, change) {
    if (busy || !beforeChange()) return;
    busy = true;
    setBusy(true);
    try {
      await controller.flush();
      if (change?.action === 'delete') {
        const state = controller.getState();
        const { document } = state.draft;
        if (document.id !== change.id) throw new Error('当前场景已变化，请重新选择后删除。');
        const effect = state.activeSceneId === document.id
          ? '这是当前输出场景。删除后，直播源将切换到剩余场景的已保存版本；没有剩余场景时变为透明空画面。其他场景的未保存修改不会应用。'
          : state.presets.length > 1 ? '删除后自动选择剩余场景，当前直播输出不变。' : '删除后画布将显示“暂无场景”。';
        const confirmed = await showConfirmationDialog({
          title: `删除场景“${document.title}”？`,
          description: `将删除此场景及其未保存修改，无法撤销。${effect}`,
          variant: 'destructive', confirmLabel: '删除场景',
        });
        if (!confirmed || disposed) return;
      }
      if (action === 'save') {
        await controller.save();
        await controller.flush();
        while (controller.getState().saving) {
          await new Promise(resolve => window.setTimeout(resolve, 100));
          if (disposed || !controller.getState().loaded) return;
        }
        const state = controller.getState();
        if (state.error || state.dirty) throw new Error(state.error || '仍有未保存修改，请重试。');
        report('场景已保存，直播画面保持当前场景');
      } else {
        report(change.action === 'create' ? (change.duplicate ? '正在复制场景…' : '正在新建场景…')
          : change.action === 'delete' ? '正在删除场景…' : '正在切换场景…');
        await connection.execute('preset', change);
        if (!disposed) report(change.action === 'delete' ? '场景已删除' : '');
      }
    } catch (error) {
      if (!disposed) report(error.message);
    } finally {
      busy = false;
      if (!disposed) { setBusy(false); render(); }
    }
  }
  function create(duplicate) {
    const state = controller.getState();
    const title = duplicate ? `${state.draft.document.title.slice(0, 75)} 副本` : `场景 ${state.presets.length + 1}`;
    void run('preset', { action: 'create', title, duplicate });
  }
  select.addEventListener('change', () => { void run('preset', { action: 'select', id: select.value }); });
  const createButton = button('新建场景', () => create(false));
  button('复制场景', () => create(true));
  button('保存场景', () => { void run('save'); });
  button('删除场景', () => { void run('preset', { action: 'delete', id: controller.getState().draft.document.id }); }, 'secondary danger');
  bar.append(live);
  host.prepend(bar);
  function render(disabled = false) {
    const state = controller.getState();
    const next = JSON.stringify([state.presets, state.activeSceneId]);
    if (signature !== next) {
      signature = next;
      select.replaceChildren(...state.presets.map(preset => {
        const option = previewElement('option', '', `${preset.title}${preset.id === state.activeSceneId ? ' · 当前输出' : ''}${preset.dirty ? ' · 未保存' : ''}`);
        option.value = preset.id;
        return option;
      }));
      if (!state.presets.length) {
        const option = previewElement('option', '', '暂无场景');
        option.value = '';
        select.append(option);
      }
    }
    select.value = state.draft.document.id;
    const active = state.presets.find(preset => preset.id === state.activeSceneId);
    const liveTitle = state.activeSceneTitle || active?.title;
    live.textContent = !state.presets.length ? '无场景输出' : !active ? '尚未应用' : `当前输出：${liveTitle}`;
    live.title = active ? '最后一次保存并应用的场景。未保存修改尚未应用；此标记不代表 OBS 或直播姬正在显示。' : '当前没有已应用的场景';
    const blocked = disabled || busy || state.saving || !state.loaded;
    select.disabled = blocked || !state.presets.length;
    if (!state.presets.length) select.value = '';
    for (const node of buttons) node.disabled = blocked || !state.presets.length && node !== more && node !== createButton;
    if (blocked) closeMenu();
    enhanceSelects();
  }
  render();
  return { render, dispose() { disposed = true; closeMenu(); window.removeEventListener('resize', closeMenu); bar.remove(); } };
}
