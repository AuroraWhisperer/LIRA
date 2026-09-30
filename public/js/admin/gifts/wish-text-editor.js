const TOKEN_LABELS = {
  '{图片}': '礼物图片',
  '{礼物}': '礼物名称',
  '{已收}': '已收数量',
  '{目标}': '目标数量',
};

function createContent(value) {
  const content = document.createElement('div');
  for (const part of value.split(/(\{(?:图片|礼物|已收|目标)\})/u)) {
    if (!part) continue;
    if (!TOKEN_LABELS[part]) {
      content.append(document.createTextNode(part));
      continue;
    }
    const token = document.createElement('span');
    token.className = 'gift-wish-text-token';
    token.contentEditable = 'false';
    token.dataset.wishToken = part;
    token.textContent = TOKEN_LABELS[part];
    content.append(token);
  }
  return content;
}

function readContent(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.data;
  if (node.dataset?.wishToken) return node.dataset.wishToken;
  if (node.nodeName === 'BR') return '\n';
  let value = '';
  for (const child of node.childNodes) {
    // Chromium adds a final BR as a caret placeholder on an empty line.
    if (child.nodeName === 'BR' && !child.nextSibling) continue;
    if (['DIV', 'P'].includes(child.nodeName) && child.previousSibling) value += '\n';
    value += readContent(child);
  }
  return value;
}

export function createWishTextEditor(editor, input) {
  let savedRange = null;
  const selection = () => window.getSelection();
  const disabled = () => editor.contentEditable !== 'true';

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
    editor.focus();
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

  function insert(value) {
    if (disabled()) return;
    restoreSelection();
    const range = expandTokens(currentRange());
    selectRange(range);
    // Native editing commands keep typing, chip insertion and paste in Chromium's undo history.
    // HTML is built only from text nodes and the fixed token vocabulary above.
    document.execCommand('insertHTML', false, createContent(value.replace(/\r\n?/g, '\n')).innerHTML);
  }

  editor.addEventListener('input', sync);
  editor.addEventListener('blur', () => {
    const range = currentRange();
    if (range) savedRange = range.cloneRange();
  });
  editor.addEventListener('click', (event) => {
    const token = event.target.closest('[data-wish-token]');
    if (disabled() || !token || !selection().isCollapsed) return;
    const range = document.createRange();
    range.selectNode(token);
    editor.focus();
    selectRange(range);
  });
  editor.addEventListener('beforeinput', (event) => {
    if (disabled() || event.inputType.startsWith('format')) {
      event.preventDefault();
      return;
    }
    const range = currentRange();
    if (range && !range.collapsed) selectRange(expandTokens(range));
  });
  for (const type of ['copy', 'cut']) {
    editor.addEventListener(type, (event) => {
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
  editor.addEventListener('paste', (event) => {
    event.preventDefault();
    const range = currentRange();
    if (range) savedRange = range.cloneRange();
    insert(event.clipboardData.getData('text/plain'));
  });
  editor.addEventListener('drop', (event) => event.preventDefault());

  return {
    insert,
    setValue(value) {
      editor.replaceChildren(...createContent(value).childNodes);
      input.value = value;
      savedRange = null;
    },
    setDisabled(value) {
      editor.contentEditable = String(!value);
      editor.setAttribute('aria-disabled', String(value));
      editor.tabIndex = value ? -1 : 0;
    },
  };
}
