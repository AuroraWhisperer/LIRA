import { createTextBoxPlayback } from './text-box-scroll.js';
import { isComponentPreview, createComponentPreviewClient } from './component-preview-client.js';

if (isComponentPreview()) {
  const playback = createTextBoxPlayback(document.getElementById('textBox'));
  createComponentPreviewClient({
    onConfig(config) { return playback.update(config); },
    onDispose() { playback.dispose(); },
  });
}
