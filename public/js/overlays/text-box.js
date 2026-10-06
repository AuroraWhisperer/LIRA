import { renderTextBox } from '../shared/text-box-renderer.js';
import { TEXT_BOX_SIZE } from '../shared/text-box-config.js';
import { isComponentPreview, createComponentPreviewClient } from './component-preview-client.js';

const host = document.getElementById('textBox');
function resize() {
  host.style.transform = `scale(${window.innerWidth / TEXT_BOX_SIZE[0]})`;
}
if (isComponentPreview()) {
  window.addEventListener('resize', resize);
  createComponentPreviewClient({
    onConfig(config) { renderTextBox(host, config); resize(); },
    onDispose() { window.removeEventListener('resize', resize); host.replaceChildren(); },
  });
}
