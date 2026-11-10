import { previewElement } from './component-preview-elements.js';
import { mountPreviewLayerDrag } from './component-preview-layer-drag.js';

export function mountPreviewLayers(layers, heading, { select, toggle: toggleItem, remove, reorder, beforeDrag, beforeAction, report }) {
  layers.setAttribute('aria-label', '图层，左侧在上；拖动排序，松开应用');
  layers.title = '拖动调整图层：左侧在上，右侧在下；拖出此栏松开可取消';
  const layerDrag = mountPreviewLayerDrag(layers, {
    report,
    beforeDrag() { closeLayerMenu(); beforeDrag(); },
    commit: reorder,
  });
  function button(parent, text, action, className = 'secondary') {
    const node = previewElement('button', className, text);
    node.type = 'button';
    node.addEventListener('click', () => {
      try { beforeAction(); action(); } catch (error) { report(error.message); }
    });
    parent.append(node);
    return node;
  }
  let layerSignature;
  function closeLayerMenu() {
    layers.querySelector(':popover-open')?.hidePopover();
  }
  layers.addEventListener('scroll', closeLayerMenu);
  window.addEventListener('resize', closeLayerMenu);
  function render({ items, selected }) {
    const signature = JSON.stringify([selected, items.map(({ id, name, visible, locked }) => [id, name, visible, locked])]);
    if (signature === layerSignature) return;
    layerDrag.cancel();
    layerSignature = signature;
    const scrollLeft = layers.scrollLeft;
    closeLayerMenu();
    layers.replaceChildren();
    heading.textContent = `组件 · ${items.length}`;
    for (const item of items.toReversed()) {
      const row = previewElement('div', 'preview-canvas-layer');
      row.dataset.itemId = item.id;
      const choose = button(row, item.name, () => { select(item.id); }, 'preview-canvas-layer-select');
      choose.dataset.itemId = item.id;
      choose.setAttribute('aria-pressed', String(selected === item.id));
      const toggle = button(row, '', () => {}, 'preview-canvas-layer-action');
      toggle.setAttribute('aria-label', `${item.name}操作`);
      toggle.setAttribute('aria-haspopup', 'menu');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.title = '更多操作';
      const chevron = previewElement('span', 'preview-canvas-layer-chevron');
      chevron.setAttribute('aria-hidden', 'true');
      toggle.append(chevron);
      const menu = previewElement('div', 'preview-canvas-layer-menu');
      menu.id = `preview-layer-menu-${item.id}`;
      menu.popover = 'auto';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', `${item.name}操作`);
      toggle.setAttribute('aria-controls', menu.id);
      toggle.popoverTargetElement = menu;
      for (const [field, label] of [
        ['visible', item.visible ? '隐藏组件' : '显示组件'],
        ['locked', item.locked ? '解锁组件' : '锁定组件'],
      ]) {
        const control = button(menu, label, () => {
          menu.hidePopover();
          toggleItem(item.id, field);
          [...layers.children].find((layer) => layer.dataset.itemId === item.id)
            ?.querySelector('.preview-canvas-layer-action').focus({ preventScroll: true });
        }, `preview-canvas-layer-state preview-canvas-layer-${field}`);
        control.setAttribute('role', 'menuitem');
        control.autofocus = field === 'visible';
        control.dataset.active = String(item[field]);
        const icon = previewElement('span', 'preview-canvas-layer-state-icon');
        icon.setAttribute('aria-hidden', 'true');
        control.prepend(icon);
      }
      const removeButton = button(menu, '删除', () => { menu.hidePopover(); remove(item.id); }, 'danger');
      removeButton.setAttribute('role', 'menuitem');
      removeButton.disabled = item.locked;
      menu.addEventListener('beforetoggle', (event) => {
        const open = event.newState === 'open';
        toggle.setAttribute('aria-expanded', String(open));
        if (!open) return;
        const rect = toggle.getBoundingClientRect();
        const width = Number.parseFloat(window.getComputedStyle(menu).width);
        menu.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8))}px`;
        menu.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      });
      toggle.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        if (!menu.matches(':popover-open')) menu.showPopover({ source: toggle });
      });
      menu.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const actions = [...menu.querySelectorAll('button:not(:disabled)')];
        const index = actions.indexOf(layers.ownerDocument.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? actions.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + actions.length) % actions.length;
        actions[next]?.focus();
      });
      row.append(menu);
      layers.append(row);
    }
    layers.scrollLeft = scrollLeft;
  }
  return {
    render,
    cancelDrag: layerDrag.cancel,
    closeMenu: closeLayerMenu,
    scrollToSelection() {
      layers.querySelector('.preview-canvas-layer-select[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
    dispose() {
      layerDrag.dispose();
      closeLayerMenu();
      layers.removeEventListener('scroll', closeLayerMenu);
      window.removeEventListener('resize', closeLayerMenu);
      layers.replaceChildren();
    },
  };
}
