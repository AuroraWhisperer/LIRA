import { renderTextBox } from '../shared/text-box-renderer.js';
import { normalizeTextBoxConfig } from '../shared/text-box-config.js';
import { previewElement } from './component-preview-surface.js';
import { mountRichTextToolbar } from './rich-text-toolbar.js';
import { readTextStyle } from '../shared/text-style.js';

function contentSignature({ scrollMode, scrollSpeed, ...content }) {
  return JSON.stringify(content);
}

export function readTextBoxNodes(editor, config, range) {
  const nodes = [];
  function text(value, element) {
    if (!value) return;
    const node = { type: 'text', text: value, ...readTextStyle(element, editor, config) };
    const previous = nodes.at(-1);
    if (previous?.type === 'text' && JSON.stringify({ ...previous, text: '' }) === JSON.stringify({ ...node, text: '' })) previous.text += value;
    else nodes.push(node);
  }
  function visit(node) {
    if (range && !range.intersectsNode(node)) return;
    if (node !== editor && node.previousSibling && (!range || nodes.length)
      && [node.nodeName, node.previousSibling.nodeName].some(name => ['DIV', 'P'].includes(name))) {
      text('\n', node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
    }
    if (node.nodeType === Node.TEXT_NODE) {
      text(node.data.slice(range?.startContainer === node ? range.startOffset : 0,
        range?.endContainer === node ? range.endOffset : node.data.length), node.parentElement);
      return;
    }
    if (node.dataset?.textBoxNode) { nodes.push(JSON.parse(node.dataset.textBoxNode)); return; }
    if (node.nodeName === 'BR') { text('\n', node.parentElement); return; }
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
  const editor = previewElement('div', 'text-box-editor');
  editor.contentEditable = 'true';
  editor.setAttribute('role', 'textbox');
  editor.setAttribute('aria-label', '文本框内容');
  editor.setAttribute('aria-multiline', 'true');
  editor.dataset.placeholder = '输入文字，也可以插入礼物、图片和颜文字…';
  editor.spellcheck = false;
  wrapper.append(editor);
  host.append(wrapper);
  let savedRange = null;
  let previous = '';
  let disabled = false;
  let applyingCommand = false;

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
      previous = contentSignature(config);
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
      restore();
      document.execCommand(name, false, value);
    });
  }
  function insertText(value) {
    if (!value.includes('\n')) { command('insertText', value); return; }
    // insertText emits a separate edit for every line. One escaped text span
    // keeps large pastes compact, including trailing newlines and native undo.
    edit(() => {
      const range = restore();
      let source = range.startContainer;
      if (source.nodeType === Node.ELEMENT_NODE) source = source.childNodes[range.startOffset] || source;
      const element = source.nodeType === Node.TEXT_NODE ? source.parentElement : source;
      const config = getConfig();
      const fragment = previewElement('div');
      renderTextBox(fragment, { ...config, nodes: [{ type: 'text', text: value, ...readTextStyle(element, editor, config) }] });
      document.execCommand('insertHTML', false, fragment.innerHTML);
    });
  }
  function transformSelection(transform) {
    edit(() => {
      const range = expandAtoms(restore());
      if (!hasTextSelection(range)) return false;
      const config = getConfig();
      const nodes = transform(readTextBoxNodes(editor, config, range));
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
    transformSelection(nodes => nodes.map(node => {
      if (node.type !== 'text' && property !== 'fontSize') return node;
      const formatted = { ...node, [property]: value };
      if (value === null) delete formatted[property];
      return formatted;
    }));
  }
  function clearFormat() {
    transformSelection(nodes => nodes.map(node => node.type === 'text' ? { type: 'text', text: node.text } : node));
  }
  const toolbar = mountRichTextToolbar(editor, {
    getRange() { const range = currentRange(); if (range) savedRange = range.cloneRange(); return range || savedRange; },
    getConfig, readNodes: range => readTextBoxNodes(editor, getConfig(), range), format, clearFormat,
    isDisabled: () => disabled, isApplying: () => applyingCommand,
  });
  const updateSelection = () => toolbar.update();
  listen(editor, 'input', () => { if (!applyingCommand) sync(); });
  listen(editor, 'beforeinput', event => {
    if (disabled) { event.preventDefault(); return; }
    const range = currentRange();
    if (range && !range.collapsed) select(expandAtoms(range));
  });
  listen(editor, 'paste', event => {
    event.preventDefault();
    const range = currentRange();
    if (range) savedRange = range.cloneRange();
    insertText(event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'));
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
    insertText,
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
      const serialized = contentSignature(config);
      if (serialized !== previous) {
        renderTextBox(editor, config, { editable: true });
        previous = serialized;
        savedRange = null;
      }
      updateSelection();
    },
    dispose() { lifetime.abort(); toolbar.dispose(); wrapper.remove(); },
  };
}
