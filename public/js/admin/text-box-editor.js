import { renderTextBox } from '../shared/text-box-renderer.js';
import { normalizeTextBoxConfig } from '../shared/text-box-config.js';
import { previewElement } from './component-preview-surface.js';
import { mountTextBoxFormatControls } from './text-box-format-controls.js';

function hexColor(value) {
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  const channels = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return channels ? `#${channels.slice(1).map(value => Number(value).toString(16).padStart(2, '0')).join('')}` : null;
}

export function readTextBoxNodes(editor, config, range) {
  const nodes = [];
  function text(value, element) {
    if (!value) return;
    const style = getComputedStyle(element);
    const node = { type: 'text', text: value };
    if (Number(style.fontWeight) >= 600) node.bold = true;
    if (style.fontStyle === 'italic') node.italic = true;
    if (parseFloat(style.webkitTextStrokeWidth) > 0) node.stroke = true;
    if (style.textShadow !== 'none') node.shadow = true;
    for (let parent = element; parent && editor.contains(parent); parent = parent.parentElement) {
      if (getComputedStyle(parent).textDecorationLine.includes('underline')) { node.underline = true; break; }
    }
    const size = Math.round(parseFloat(style.fontSize));
    if (size !== config.fontSize) node.fontSize = size;
    const color = hexColor(style.color);
    if (color && color !== config.color) node.color = color;
    const previous = nodes.at(-1);
    if (previous?.type === 'text' && JSON.stringify({ ...previous, text: '' }) === JSON.stringify({ ...node, text: '' })) previous.text += value;
    else nodes.push(node);
  }
  function visit(node) {
    if (range && !range.intersectsNode(node)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      text(node.data.slice(range?.startContainer === node ? range.startOffset : 0,
        range?.endContainer === node ? range.endOffset : node.data.length), node.parentElement);
      return;
    }
    if (node.dataset?.textBoxNode) { nodes.push(JSON.parse(node.dataset.textBoxNode)); return; }
    if (node.nodeName === 'BR') { text('\n', node.parentElement); return; }
    if (['DIV', 'P'].includes(node.nodeName) && node !== editor && node.previousSibling && (!range || nodes.length)) text('\n', node);
    for (const child of node.childNodes) {
      if (child.nodeName === 'BR' && !child.nextSibling && ['DIV', 'P'].includes(node.nodeName)) continue;
      visit(child);
    }
  }
  visit(editor);
  return nodes;
}

export function mountTextBoxEditor(host, { getConfig, onChange, onError }) {
  const lifetime = new AbortController();
  const listen = (node, event, callback) => node.addEventListener(event, callback, { signal: lifetime.signal });
  const wrapper = previewElement('div', 'text-box-composer');
  const toolbar = previewElement('div', 'text-box-toolbar');
  toolbar.hidden = true;
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '文字格式');
  const editor = previewElement('div', 'text-box-editor');
  editor.contentEditable = 'true';
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-label', '文本框内容');
  editor.setAttribute('aria-multiline', 'true');
  editor.dataset.placeholder = '输入文字，也可以插入礼物、图片和颜文字…';
  editor.spellcheck = false;
  wrapper.append(editor, toolbar);
  host.append(wrapper);
  let savedRange = null;
  let previous = '';
  let disabled = false;
  let applyingCommand = false;
  const marks = new Map();

  function currentRange() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    return editor.contains(range.commonAncestorContainer) ? range : null;
  }
  function select(range) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    savedRange = range.cloneRange();
  }
  function hasTextSelection(range) {
    return range && !range.collapsed && editor.contains(range.commonAncestorContainer)
      && readTextBoxNodes(editor, getConfig(), range).some(node => node.type === 'text' && node.text.length);
  }
  function restore() {
    const range = savedRange && editor.contains(savedRange.commonAncestorContainer) ? savedRange.cloneRange() : document.createRange();
    if (!savedRange || !editor.contains(savedRange.commonAncestorContainer)) { range.selectNodeContents(editor); range.collapse(false); }
    editor.focus({ preventScroll: true });
    select(range);
    return range;
  }
  function expandAtoms(range) {
    for (const edge of ['start', 'end']) {
      const container = range[`${edge}Container`];
      const atom = (container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement)?.closest('[data-text-box-node]');
      if (atom && editor.contains(atom)) {
        if (edge === 'start') range.setStartBefore(atom); else range.setEndAfter(atom);
      }
    }
    return range;
  }
  function sync() {
    try {
      const config = normalizeTextBoxConfig({ ...getConfig(), nodes: readTextBoxNodes(editor, getConfig()) });
      previous = JSON.stringify(config);
      onChange(config);
      const range = currentRange();
      const atom = range?.startContainer.parentElement?.closest('[data-text-box-node]');
      if (range?.collapsed && atom && editor.contains(atom)) {
        range.setStartAfter(atom); range.collapse(true); select(range);
      }
    } catch (error) { onError(error); }
  }
  function edit(action) {
    if (disabled) return;
    applyingCommand = true;
    try {
      if (action() !== false) sync();
    } finally {
      applyingCommand = false;
      updateSelection();
    }
  }
  function command(name, value) {
    edit(() => {
      const range = restore();
      if (marks.has(name) && !hasTextSelection(range)) return false;
      document.execCommand(name, false, value);
    });
  }
  function transformSelection(transform) {
    edit(() => {
      const range = expandAtoms(restore());
      if (!hasTextSelection(range)) return false;
      const config = getConfig();
      const nodes = readTextBoxNodes(editor, config, range).map(transform);
      const fragment = previewElement('div');
      renderTextBox(fragment, { ...config, nodes }, { editable: true });
      const span = previewElement('span');
      const marker = crypto.randomUUID();
      span.dataset.textFormat = marker;
      span.append(...fragment.childNodes);
      const content = previewElement('div');
      content.append(span);
      select(range);
      document.execCommand('insertHTML', false, content.innerHTML);
      const inserted = editor.querySelector(`[data-text-format="${marker}"]`);
      if (inserted) {
        delete inserted.dataset.textFormat;
        const selection = document.createRange();
        selection.selectNodeContents(inserted);
        select(selection);
      }
    });
  }
  function format(property, value) {
    transformSelection(node => node.type === 'text' || property === 'fontSize' ? { ...node, [property]: value } : node);
  }
  function clearFormat() {
    transformSelection(node => node.type === 'text' ? { type: 'text', text: node.text } : node);
  }
  for (const [key, label, text] of [['bold', '加粗 (Ctrl+B)', 'B'], ['italic', '斜体 (Ctrl+I)', 'I'], ['underline', '下划线 (Ctrl+U)', 'U']]) {
    const button = previewElement('button', `text-box-format text-box-format-${key}`, text);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', 'false');
    listen(button, 'mousedown', event => event.preventDefault());
    listen(button, 'click', () => command(key));
    toolbar.append(button);
    marks.set(key, button);
  }
  const size = previewElement('select', 'text-box-font-size');
  size.setAttribute('aria-label', '文字字号');
  for (const number of [12, 16, 20, 24, 28, 32, 40, 48, 64, 72, 96, 120]) {
    const option = previewElement('option', '', `${number}`); option.value = number; size.append(option);
  }
  listen(size, 'change', () => format('fontSize', Number(size.value)));
  toolbar.append(size);
  const formatControls = mountTextBoxFormatControls(toolbar, { listen, format, clearFormat });

  function updateSelection() {
    if (applyingCommand) return;
    const activeRange = currentRange();
    if (activeRange) savedRange = activeRange.cloneRange();
    const toolbarFocused = toolbar.contains(document.activeElement);
    const range = activeRange || (toolbarFocused ? savedRange : null);
    toolbar.hidden = disabled || !hasTextSelection(range) || !(document.activeElement === editor || toolbarFocused);
    if (!toolbar.hidden) {
      const rect = range.getClientRects()[0] || range.getBoundingClientRect();
      const bounds = editor.getBoundingClientRect();
      toolbar.hidden = rect.bottom <= Math.max(0, bounds.top) || rect.top >= Math.min(window.innerHeight, bounds.bottom);
      const left = Math.max(8, bounds.left);
      const right = Math.min(window.innerWidth - toolbar.offsetWidth - 8, Math.max(left, bounds.right - toolbar.offsetWidth));
      toolbar.style.left = `${Math.max(left, Math.min(rect.left + rect.width / 2 - toolbar.offsetWidth / 2, right))}px`;
      toolbar.style.top = `${Math.max(8, rect.top - toolbar.offsetHeight - 10)}px`;
      for (const [key, button] of marks) button.setAttribute('aria-pressed', String(document.queryCommandState(key)));
      const selectedNodes = readTextBoxNodes(editor, getConfig(), range);
      if (!toolbar.contains(document.activeElement)) {
        size.value = String(selectedNodes.find(node => node.type === 'text')?.fontSize || getConfig().fontSize);
      }
      formatControls.update(selectedNodes, getConfig());
    }
    if (toolbar.hidden) formatControls.close();
    else formatControls.position(range.getBoundingClientRect());
  }
  listen(document, 'selectionchange', updateSelection);
  listen(document, 'focusin', updateSelection);
  listen(window, 'resize', updateSelection);
  document.addEventListener('scroll', updateSelection, { capture: true, signal: lifetime.signal });
  listen(editor, 'input', () => { if (!applyingCommand) sync(); });
  listen(editor, 'beforeinput', event => {
    if (disabled) { event.preventDefault(); return; }
    const range = currentRange();
    if (range && !range.collapsed) select(expandAtoms(range));
  });
  listen(editor, 'keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return;
    const key = { b: 'bold', i: 'italic', u: 'underline' }[event.key.toLowerCase()];
    if (key) {
      event.preventDefault();
      const range = currentRange();
      if (hasTextSelection(range)) { savedRange = range.cloneRange(); command(key); }
    }
  });
  listen(editor, 'paste', event => {
    event.preventDefault();
    command('insertText', event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'));
  });
  listen(editor, 'drop', event => event.preventDefault());
  listen(editor, 'click', event => {
    const atom = event.target.closest('[data-text-box-node]');
    if (disabled || !atom || !window.getSelection().isCollapsed) return;
    const range = document.createRange(); range.selectNode(atom); select(range);
  });
  return {
    editor,
    rememberSelection() { const range = currentRange(); if (range) savedRange = range.cloneRange(); },
    insertText(value) { command('insertText', value); },
    insertNode(node) {
      const content = previewElement('div');
      renderTextBox(content, { ...getConfig(), nodes: [node] }, { editable: true });
      const marker = crypto.randomUUID();
      content.firstElementChild.dataset.textInsertion = marker;
      command('insertHTML', content.innerHTML);
      const inserted = editor.querySelector(`[data-text-insertion="${marker}"]`);
      if (inserted) {
        delete inserted.dataset.textInsertion;
        const range = document.createRange(); range.setStartAfter(inserted); range.collapse(true); select(range);
      }
    },
    setConfig(config, locked = false) {
      disabled = locked;
      editor.contentEditable = String(!locked);
      editor.setAttribute('aria-disabled', String(locked));
      for (const input of toolbar.querySelectorAll('button, input, select')) input.disabled = locked;
      const serialized = JSON.stringify(config);
      if (serialized !== previous) {
        renderTextBox(editor, config, { editable: true });
        previous = serialized;
        savedRange = null;
      }
      if (document.activeElement !== size) size.value = String(config.fontSize);
      updateSelection();
    },
    dispose() { lifetime.abort(); wrapper.remove(); },
  };
}
