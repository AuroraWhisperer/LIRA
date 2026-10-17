import { previewElement } from './component-preview-surface.js';
import { mountRichTextFormatControls } from './rich-text-format-controls.js';
import { colorPickerContains } from '../shared/color-picker.js';
import { registerFontSelect, ensureSavedFontOption } from '../shared/font-library.js';

// Content, atomic nodes and persistence remain with each editor. Commands act on
// its saved range so focusing a font menu or color picker never loses the selection.
export function mountRichTextToolbar(editor, { getRange, getConfig, readNodes, format, clearFormat,
  isDisabled = () => false, isApplying = () => false }) {
  const lifetime = new AbortController();
  const listen = (node, event, callback) => node.addEventListener(event, callback, { signal: lifetime.signal });
  const toolbar = previewElement('div', 'rich-text-toolbar');
  toolbar.hidden = true;
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '文字格式');
  editor.after(toolbar);
  const marks = new Map();
  const textNodes = range => readNodes(range).filter(node => !node.type || node.type === 'text');

  function toggle(key) {
    const range = getRange();
    if (!range || range.collapsed || isDisabled()) return;
    const nodes = textNodes(range);
    if (nodes.length) format(key, !nodes.every(node => node[key] ?? getConfig()[key]));
  }
  for (const [key, label, text] of [['bold', '加粗 (Ctrl+B)', 'B'], ['italic', '斜体 (Ctrl+I)', 'I'], ['underline', '下划线 (Ctrl+U)', 'U']]) {
    const button = previewElement('button', `rich-text-format rich-text-format-${key}`, text);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', 'false');
    listen(button, 'mousedown', event => event.preventDefault());
    listen(button, 'click', () => toggle(key));
    toolbar.append(button);
    marks.set(key, button);
  }
  const font = previewElement('select', 'rich-text-font-family');
  font.setAttribute('aria-label', '文字字体');
  const defaultFont = previewElement('option', '', '默认字体');
  defaultFont.value = '';
  defaultFont.defaultSelected = true;
  font.append(defaultFont);
  const releaseFonts = registerFontSelect(font, { maxLength: 200 });
  listen(font, 'change', () => format('fontFamily', font.value || null));
  const size = previewElement('select', 'rich-text-font-size');
  size.setAttribute('aria-label', '文字字号');
  for (const number of [12, 16, 20, 24, 28, 32, 40, 48, 64, 72, 96, 120]) {
    const option = previewElement('option', '', `${number}`); option.value = number; size.append(option);
  }
  listen(size, 'change', () => format('fontSize', Number(size.value)));
  toolbar.append(font, size);
  const controls = mountRichTextFormatControls(toolbar, { listen, format, clearFormat });

  function update() {
    if (isApplying()) return;
    const range = getRange();
    const focused = toolbar.contains(document.activeElement) || colorPickerContains(toolbar, document.activeElement);
    const selected = range && !range.collapsed && editor.contains(range.commonAncestorContainer) ? textNodes(range) : [];
    toolbar.hidden = isDisabled() || !selected.length || !(document.activeElement === editor || focused);
    if (toolbar.hidden) { controls.close(); return; }
    const config = getConfig();
    for (const [key, button] of marks) {
      const count = selected.filter(node => node[key] ?? config[key]).length;
      button.setAttribute('aria-pressed', count === selected.length ? 'true' : count ? 'mixed' : 'false');
    }
    if (!focused) {
      const family = selected[0].fontFamily || '';
      ensureSavedFontOption(font, family);
      font.value = family;
      size.value = String(selected[0].fontSize || config.fontSize);
    }
    const rect = range.getClientRects()[0] || range.getBoundingClientRect();
    const bounds = editor.getBoundingClientRect();
    toolbar.hidden = rect.bottom <= Math.max(0, bounds.top) || rect.top >= Math.min(window.innerHeight, bounds.bottom);
    const left = Math.max(8, Math.min(bounds.left, window.innerWidth - toolbar.offsetWidth - 8));
    const right = Math.min(window.innerWidth - toolbar.offsetWidth - 8, Math.max(left, bounds.right - toolbar.offsetWidth));
    toolbar.style.left = `${Math.max(left, Math.min(rect.left + rect.width / 2 - toolbar.offsetWidth / 2, right))}px`;
    toolbar.style.top = `${Math.max(8, rect.top - toolbar.offsetHeight - 10)}px`;
    controls.update(selected, config);
    if (toolbar.hidden) controls.close();
    else controls.position(range.getBoundingClientRect());
  }
  listen(document, 'selectionchange', update);
  listen(document, 'focusin', update);
  listen(window, 'resize', update);
  document.addEventListener('scroll', update, { capture: true, signal: lifetime.signal });
  listen(editor, 'keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
    const key = { b: 'bold', i: 'italic', u: 'underline' }[event.key.toLowerCase()];
    if (key) { event.preventDefault(); toggle(key); }
  });
  return { update, dispose() { lifetime.abort(); releaseFonts?.(); toolbar.remove(); } };
}
