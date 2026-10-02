import { openComponentPreview } from './component-preview-dialog.js';
import { applyDanmakuRegionEdit, createDanmakuPreview } from './danmaku-preview.js';
export { applyDanmakuRegionEdit, createDanmakuPreview };

export function openDanmakuCanvas({ controller }) {
  return openComponentPreview(createDanmakuPreview({ controller }));
}
