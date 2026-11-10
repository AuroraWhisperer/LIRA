export function previewElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function previewToolbarIcon(name) {
  const paths = {
    close: 'M6 6l12 12M18 6 6 18',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    undo: 'M9 14 4 9l5-5M4 9h8a8 8 0 0 1 8 8v3',
    redo: 'm15 14 5-5-5-5M20 9h-8a8 8 0 0 0-8 8v3',
    canvas: 'M4 4h16v12H4ZM8 20h8m-4-4v4',
    panel: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm10 0v16',
    settings: 'M4 7h6m4 0h6M4 17h10m4 0h2M10 4v6m4 4v6',
    save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM17 21v-8H7v8M7 3v5h8V3',
    link: 'm10 14 4-4M9 7l2-2a4.24 4.24 0 0 1 6 6l-2 2M15 17l-2 2a4.24 4.24 0 0 1-6-6l2-2',
  };
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', paths[name]);
  icon.append(shape);
  return icon;
}
