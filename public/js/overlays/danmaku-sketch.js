// Decorative linework uses masks so every stroke follows the selected theme color.
export function decorateSketchMessage(document, bubble, item) {
  bubble.dataset.sketchVariant = [1, 2, 3].includes(Number(item.guardLevel)) ? '1' : '0';
  const ornaments = document.createElement('span');
  ornaments.className = 'sketch-ornaments';
  ornaments.setAttribute('aria-hidden', 'true');
  for (const part of ['star', 'left', 'right']) {
    const ornament = document.createElement('i');
    ornament.className = `sketch-${part}`;
    ornaments.append(ornament);
  }
  const body = bubble.children[bubble.children.length - 1];
  const message = body.children[body.children.length - 1];
  (item.kind === 'gift' ? body : message).append(ornaments);
}
