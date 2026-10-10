import { mountComponentStyleLibrary } from './component-style-library.js';
import { createResourceStyleSettings } from './resource-style-settings.js';
import { addStyleToCanvas } from './component-style-client.js';
import { previewElement } from './component-preview-surface.js';

export function mountOpeningStylePicker({ onBuiltin, beforeSelect }) {
  const host = document.getElementById('openingStyleOptions');
  host.dataset.localStyles = 'opening';
  const settings = document.getElementById('openingImportedSettings');
  const sessions = new Map();
  let selected = null;
  let panel = null;
  let ready = false;
  let cards = [];
  const builtins = Array.from(host.querySelectorAll('[data-opening-style]'));
  function render() {
    const builtin = document.getElementById('openingStyle').value;
    for (const button of builtins) {
      button.disabled = !ready;
      button.setAttribute('aria-pressed', String(!selected && button.dataset.openingStyle === builtin));
    }
    for (const { style, card } of cards) {
      const button = card.querySelector('.component-style-select');
      button.disabled = !ready;
      button.setAttribute('aria-pressed', String(selected?.id === style.id));
    }
    document.getElementById('openingAnimationForm').hidden = Boolean(selected);
    settings.hidden = !selected;
    document.getElementById('openingSourceAddress').hidden = Boolean(selected);
    document.getElementById('openingPreviewBtn').textContent = selected ? '在画布中使用' : '预览';
  }
  function select(style) {
    if (!ready || selected?.id === style?.id) return;
    beforeSelect();
    panel?.dispose(); panel = null; settings.replaceChildren();
    selected = style;
    if (style?.config.resourceStyle) {
      if (!sessions.has(style.id)) sessions.set(style.id, createResourceStyleSettings(style));
      panel = sessions.get(style.id).mount(settings);
    } else if (style) {
      settings.append(previewElement('p', 'hint', '此样式使用导入时保存的画面与布局，在画布中调整尺寸和位置。'));
    }
    render();
  }
  for (const button of builtins) button.addEventListener('click', () => {
    if (!ready) return;
    select(null);
    onBuiltin(button.dataset.openingStyle);
    render();
  });
  const library = mountComponentStyleLibrary(host, { type: 'opening', inline: true,
    actionLabel: '选择样式', onUse: select,
    renderList(value) {
      cards = value.cards;
      for (const { card } of cards) card.querySelector('.component-style-select').firstElementChild.remove();
      if (selected && !cards.some(({ style }) => style.id === selected.id)) select(null);
      render();
    },
  });
  const refresh = () => { void library.refresh(); };
  window.addEventListener('component-styles:changed', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('pagehide', () => {
    window.removeEventListener('component-styles:changed', refresh);
    window.removeEventListener('focus', refresh);
    panel?.dispose(); library.dispose();
  }, { once: true });
  return {
    render,
    setReady(value) { ready = value; render(); },
    isImported: () => Boolean(selected),
    async useImported() {
      const style = selected;
      if (style) await addStyleToCanvas(sessions.has(style.id) ? await sessions.get(style.id).savedStyle() : style);
    },
  };
}
