import { mountRichTextToolbar } from '../rich-text-toolbar.js';
import { readTextStyle, applyTextStyle, textColorHex } from '../../shared/text-style.js';
import { WISH_TEXT_DEFAULTS } from '../../shared/gift-wish-text.js';

let selectionId = 0;

const TOKEN_LABELS = {
  '{图片}': '礼物图片',
  '{礼物}': '礼物名称',
  '{已收}': '已收数量',
  '{目标}': '目标数量',
};

function createContent(value, tokenLabels, runs = []) {
  const content = document.createElement('div');
  for (const { text, ...format } of runs.length ? runs : [{ text: value }]) {
    for (const part of text.split(/(\{(?:图片|礼物|已收|目标)\})/u)) {
      if (!part) continue;
      if (!TOKEN_LABELS[part]) {
        const span = document.createElement('span');
        span.textContent = part;
        applyTextStyle(span, format, WISH_TEXT_DEFAULTS);
        content.append(span);
        continue;
      }
      const token = document.createElement('span');
      token.className = 'gift-wish-text-token';
      token.contentEditable = 'false';
      token.dataset.wishToken = part;
      token.dataset.wishFormat = JSON.stringify(format);
      token.textContent = tokenLabels[part];
      content.append(token);
    }
  }
  return content;
}

function readRuns(editor, config, range) {
  const runs = [];
  function append(text, format) {
    if (!text) return;
    const previous = runs.at(-1);
    if (previous && JSON.stringify({ ...previous, text: '' }) === JSON.stringify({ text: '', ...format })) previous.text += text;
    else runs.push({ text, ...format });
  }
  function visit(node) {
    if (range && !range.intersectsNode(node)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      append(node.data.slice(range?.startContainer === node ? range.startOffset : 0,
        range?.endContainer === node ? range.endOffset : node.data.length), readTextStyle(node.parentElement, editor, config));
      return;
    }
    if (node.dataset?.wishToken) { append(node.dataset.wishToken, JSON.parse(node.dataset.wishFormat || '{}')); return; }
    if (node.nodeName === 'BR') { append('\n', readTextStyle(node.parentElement, editor, config)); return; }
    for (const child of node.childNodes) {
      if (range && !range.intersectsNode(child)) continue;
      if (child.nodeName === 'BR' && !child.nextSibling) continue;
      if (['DIV', 'P'].includes(child.nodeName) && child.previousSibling
        && child.previousSibling.nodeName !== 'BR' && (!range || runs.length)) {
        append('\n', readTextStyle(child, editor, config));
      }
      visit(child);
    }
  }
  visit(editor);
  return runs;
}

function readContent(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.data;
  if (node.dataset?.wishToken) return node.dataset.wishToken;
  if (node.nodeName === 'BR') return '\n';
  let value = '';
  for (const child of node.childNodes) {
    // Chromium adds a final BR as a caret placeholder on an empty line.
    if (child.nodeName === 'BR' && !child.nextSibling) continue;
    if (['DIV', 'P'].includes(child.nodeName) && child.previousSibling && child.previousSibling.nodeName !== 'BR') value += '\n';
    value += readContent(child);
  }
  return value;
}

export function createWishTextEditor(editor, input) {
  const lifetime = new AbortController();
  const listen = (type, callback) => editor.addEventListener(type, callback, { signal: lifetime.signal });
  let savedRange = null;
  let applying = false;
  let tokenLabels = TOKEN_LABELS;
  const selection = () => window.getSelection();
  const disabled = () => editor.contentEditable !== 'true';
  const getConfig = () => ({ ...WISH_TEXT_DEFAULTS, color: textColorHex(getComputedStyle(editor).color) });

  function currentRange() {
    const selected = selection();
    if (!selected.rangeCount) return null;
    const range = selected.getRangeAt(0);
    return editor.contains(range.commonAncestorContainer) ? range : null;
  }

  function selectRange(range) {
    selection().removeAllRanges();
    selection().addRange(range);
    savedRange = range.cloneRange();
  }

  function restoreSelection() {
    editor.focus({ preventScroll: true });
    if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
      selectRange(savedRange);
    } else {
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selectRange(range);
    }
  }

  function expandTokens(range) {
    for (const edge of ['start', 'end']) {
      const node = range[`${edge}Container`];
      const token = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('[data-wish-token]');
      if (token && editor.contains(token)) {
        if (edge === 'start') range.setStartBefore(token);
        else range.setEndAfter(token);
      }
    }
    return range;
  }

  function sync() {
    input.value = readContent(editor);
    const range = currentRange();
    if (range) {
      const token = range.startContainer.parentElement?.closest('[data-wish-token]');
      // Redo can leave Chromium's caret inside a non-editable token's label.
      if (range.collapsed && token && editor.contains(token)) {
        if (range.startOffset === 0) range.setStartBefore(token);
        else range.setStartAfter(token);
        range.collapse(true);
        selectRange(range);
      }
      savedRange = range.cloneRange();
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function transformSelection(transform) {
    if (disabled()) return;
    applying = true;
    try {
      restoreSelection();
      const range = expandTokens(currentRange());
      if (!range || range.collapsed) return;
      const runs = transform(readRuns(editor, getConfig(), range));
      const content = createContent('', tokenLabels, runs);
      const span = document.createElement('span');
      const marker = String(++selectionId);
      span.dataset.wishFormatSelection = marker;
      span.append(...content.childNodes);
      selectRange(range);
      document.execCommand('insertHTML', false, span.outerHTML);
      const inserted = editor.querySelector(`[data-wish-format-selection="${marker}"]`);
      if (inserted) {
        delete inserted.dataset.wishFormatSelection;
        range.selectNodeContents(inserted);
        selectRange(range);
      }
      sync();
    } finally { applying = false; toolbar.update(); }
  }

  const toolbar = mountRichTextToolbar(editor, {
    getRange() { const range = currentRange(); if (range) savedRange = range.cloneRange(); return range || savedRange; },
    getConfig, readNodes: range => readRuns(editor, getConfig(), range),
    format(property, value) {
      transformSelection(runs => runs.map(run => {
        const formatted = { ...run, [property]: value };
        if (value === null) delete formatted[property];
        return formatted;
      }));
    },
    clearFormat() { transformSelection(runs => runs.map(({ text }) => ({ text }))); },
    isDisabled: disabled, isApplying: () => applying,
  });

  function insert(value) {
    if (disabled()) return;
    restoreSelection();
    const range = expandTokens(currentRange());
    selectRange(range);
    // Native editing commands keep typing, chip insertion and paste in Chromium's undo history.
    // HTML is built only from text nodes and the fixed token vocabulary above.
    document.execCommand('insertHTML', false, createContent(value.replace(/\r\n?/g, '\n'), tokenLabels).innerHTML);
  }

  listen('input', () => { if (!applying) sync(); });
  listen('blur', () => {
    const range = currentRange();
    if (range) savedRange = range.cloneRange();
  });
  listen('click', (event) => {
    const token = event.target.closest('[data-wish-token]');
    if (disabled() || !token || !selection().isCollapsed) return;
    const range = document.createRange();
    range.selectNode(token);
    editor.focus();
    selectRange(range);
  });
  listen('beforeinput', (event) => {
    if (disabled() || event.inputType.startsWith('format')) {
      event.preventDefault();
      return;
    }
    const range = currentRange();
    if (range && !range.collapsed) selectRange(expandTokens(range));
  });
  for (const type of ['copy', 'cut']) {
    listen(type, (event) => {
      const range = currentRange();
      if (!range || range.collapsed || (type === 'cut' && disabled())) return;
      selectRange(expandTokens(range));
      event.preventDefault();
      event.clipboardData.setData('text/plain', readContent(range.cloneContents()));
      if (type === 'cut') {
        document.execCommand('delete');
      }
    });
  }
  listen('paste', (event) => {
    event.preventDefault();
    const range = currentRange();
    if (range) savedRange = range.cloneRange();
    insert(event.clipboardData.getData('text/plain'));
  });
  listen('drop', (event) => event.preventDefault());

  return {
    insert,
    getRuns() { return readRuns(editor, getConfig()); },
    dispose() { lifetime.abort(); toolbar.dispose(); },
    setContext({ giftName, count, target }) {
      const values = { '{图片}': giftName, '{礼物}': giftName, '{已收}': count, '{目标}': target };
      tokenLabels = Object.fromEntries(
        Object.entries(TOKEN_LABELS).map(([token, label]) => [token, `${label}·${values[token]}`]),
      );
      for (const token of editor.querySelectorAll('[data-wish-token]')) {
        const label = tokenLabels[token.dataset.wishToken];
        if (token.textContent !== label) token.textContent = label;
      }
    },
    setValue(value, runs = []) {
      editor.replaceChildren(...createContent(value, tokenLabels, runs).childNodes);
      input.value = value;
      savedRange = null;
      toolbar.update();
    },
    setDisabled(value) {
      editor.contentEditable = String(!value);
      editor.setAttribute('aria-disabled', String(value));
      editor.tabIndex = value ? -1 : 0;
      toolbar.update();
    },
  };
}
