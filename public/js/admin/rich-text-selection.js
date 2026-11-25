let selectionId = 0;

// Selection mechanics shared by editors; each editor owns its content and input policy.
export function createRichTextSelection(editor, atomSelector) {
  const documentRef = editor.ownerDocument;
  const selection = () => documentRef.defaultView.getSelection();
  let savedRange = null;
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
  function restore() {
    const valid = savedRange && editor.contains(savedRange.commonAncestorContainer);
    const range = valid ? savedRange.cloneRange() : documentRef.createRange();
    if (!valid) { range.selectNodeContents(editor); range.collapse(false); }
    editor.focus({ preventScroll: true });
    select(range);
    return range;
  }
  function expand(range) {
    for (const edge of ['start', 'end']) {
      const node = range[`${edge}Container`];
      const atom = (node.nodeType === 1 ? node : node.parentElement)?.closest(atomSelector);
      if (atom && editor.contains(atom)) {
        if (edge === 'start') range.setStartBefore(atom);
        else range.setEndAfter(atom);
      }
    }
    return range;
  }
  function replace(range, content) {
    const span = documentRef.createElement('span');
    const marker = String(++selectionId);
    span.dataset.richTextSelection = marker;
    span.append(...content.childNodes);
    select(range);
    documentRef.execCommand('insertHTML', false, span.outerHTML);
    const inserted = editor.querySelector(`[data-rich-text-selection="${marker}"]`);
    if (inserted) {
      delete inserted.dataset.richTextSelection;
      range.selectNodeContents(inserted);
      select(range);
    }
  }
  return { currentRange, select, restore, expand, replace,
    get savedRange() { return savedRange; },
    set savedRange(range) { savedRange = range; },
  };
}
