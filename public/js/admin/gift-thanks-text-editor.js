import { GIFT_THANKS_TOKENS, splitGiftThanksTemplate } from '../shared/gift-thanks-templates.js';

function content(value, documentRef) {
  const fragment = documentRef.createElement('div');
  for (const part of splitGiftThanksTemplate(value)) {
    if (!Object.hasOwn(GIFT_THANKS_TOKENS, part)) {
      fragment.append(documentRef.createTextNode(part));
      continue;
    }
    const token = documentRef.createElement('span');
    token.className = 'danmaku-thanks-token';
    token.contentEditable = 'false';
    token.dataset.thanksToken = part;
    token.textContent = GIFT_THANKS_TOKENS[part];
    fragment.append(token);
  }
  return fragment;
}

function read(node) {
  if (node.nodeType === 3) return node.data;
  if (node.dataset?.thanksToken) return node.dataset.thanksToken;
  return [...node.childNodes].map(read).join('');
}

export function createGiftThanksTextEditor(editor, changed) {
  const documentRef = editor.ownerDocument;
  const lifetime = new AbortController();
  const selection = () => documentRef.defaultView.getSelection();
  let savedRange = null;
  const disabled = () => editor.contentEditable !== 'true';
  function currentRange() {
    const selected = selection();
    if (!selected.rangeCount) return null;
    const range = selected.getRangeAt(0);
    return editor.contains(range.commonAncestorContainer) ? range : null;
  }
  function select(range) {
    selection().removeAllRanges();
    selection().addRange(range);
    savedRange = range.cloneRange();
  }
  function expand(range) {
    for (const edge of ['start', 'end']) {
      const node = range[`${edge}Container`];
      const token = (node.nodeType === 1 ? node : node.parentElement)?.closest('[data-thanks-token]');
      if (token && editor.contains(token)) {
        if (edge === 'start') range.setStartBefore(token);
        else range.setEndAfter(token);
      }
    }
    return range;
  }
  function insert(value) {
    if (disabled()) return;
    editor.focus({ preventScroll: true });
    const range = savedRange && editor.contains(savedRange.commonAncestorContainer)
      ? savedRange.cloneRange() : documentRef.createRange();
    if (!savedRange || !editor.contains(range.commonAncestorContainer)) {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    select(expand(range));
    // DOM-built HTML keeps token insertion in Chromium's native undo history.
    documentRef.execCommand('insertHTML', false, content(value.replace(/[\r\n]+/gu, ' '), documentRef).innerHTML);
  }
  function listen(type, handler) {
    editor.addEventListener(type, handler, { signal: lifetime.signal });
  }
  listen('input', () => {
    const range = currentRange();
    if (range) {
      const token = range.startContainer.parentElement?.closest('[data-thanks-token]');
      if (range.collapsed && token && editor.contains(token)) {
        if (range.startOffset === 0) range.setStartBefore(token);
        else range.setStartAfter(token);
        range.collapse(true);
        select(range);
      }
      savedRange = range.cloneRange();
    }
    changed();
  });
  listen('blur', () => {
    const range = currentRange();
    if (range) savedRange = range.cloneRange();
  });
  listen('click', event => {
    const token = event.target.closest('[data-thanks-token]');
    if (!token || disabled() || !selection().isCollapsed) return;
    const range = documentRef.createRange();
    range.selectNode(token);
    select(range);
  });
  listen('beforeinput', event => {
    if (disabled() || event.inputType.startsWith('format') || ['insertParagraph', 'insertLineBreak'].includes(event.inputType)) {
      event.preventDefault();
      return;
    }
    const range = currentRange();
    if (range && !range.collapsed) select(expand(range));
  });
  for (const type of ['copy', 'cut']) {
    listen(type, event => {
      const range = currentRange();
      if (!range || range.collapsed || (type === 'cut' && disabled())) return;
      select(expand(range));
      event.preventDefault();
      event.clipboardData.setData('text/plain', read(range.cloneContents()));
      if (type === 'cut') documentRef.execCommand('delete');
    });
  }
  listen('paste', event => {
    event.preventDefault();
    const range = currentRange();
    if (range) savedRange = range.cloneRange();
    insert(event.clipboardData.getData('text/plain'));
  });
  listen('drop', event => event.preventDefault());
  return {
    insert,
    read: () => read(editor),
    setValue(value) {
      editor.replaceChildren(...content(value, documentRef).childNodes);
      savedRange = null;
    },
    setDisabled(value) {
      editor.contentEditable = String(!value);
      editor.setAttribute('aria-disabled', String(value));
      editor.tabIndex = value ? -1 : 0;
    },
    dispose() { lifetime.abort(); },
  };
}
