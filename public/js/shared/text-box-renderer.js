import { normalizeTextBoxConfig } from './text-box-config.js';
import { setGiftImage } from './gift-image-fallback.js';

export function renderTextBox(host, input, { editable = false } = {}) {
  const config = normalizeTextBoxConfig(input);
  const document = host.ownerDocument;
  host.classList.add('text-box-content');
  Object.assign(host.style, { fontSize: `${config.fontSize}px`, color: config.color,
    textAlign: config.align, lineHeight: String(config.lineHeight), whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
  const nodes = config.nodes.map((node) => {
    const span = document.createElement('span');
    span.style.fontSize = `${node.fontSize ?? config.fontSize}px`;
    if (node.type === 'text') {
      span.textContent = node.text;
      Object.assign(span.style, { color: node.color ?? config.color, fontWeight: node.bold ? '700' : '400',
        fontStyle: node.italic ? 'italic' : 'normal', textDecoration: node.underline ? 'underline' : 'none',
        webkitTextStroke: node.stroke ? '0.06em #141a24' : '0px', paintOrder: 'stroke fill',
        textShadow: node.shadow ? '0 0.06em 0.16em rgb(0 0 0 / 60%)' : 'none' });
    } else {
      span.className = 'text-box-token';
      span.contentEditable = 'false';
      if (editable) span.dataset.textBoxNode = JSON.stringify(node);
      span.title = node.name;
      const image = document.createElement('img');
      image.alt = node.name;
      image.draggable = false;
      Object.assign(image.style, { height: node.type === 'gift' ? '1.3em' : '2em', maxWidth: '4em',
        objectFit: 'contain', verticalAlign: 'middle' });
      if (node.type === 'gift') setGiftImage(image, node.src);
      else image.src = node.src;
      span.append(image);
      if (editable) {
        span.style.fontSize = '14px';
        const label = document.createElement('span');
        label.textContent = `${node.type === 'gift' ? '礼物图片' : '图片'}·${node.name}`;
        span.append(label);
      }
    }
    return span;
  });
  host.replaceChildren(...nodes);
  return config;
}
