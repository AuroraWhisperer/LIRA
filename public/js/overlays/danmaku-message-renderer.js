import { DEFAULT_DANMAKU_CLASSES, createDanmakuRenderer, measureDanmakuText } from './danmaku-renderer-core.js';
import { bindGuardImage } from '../shared/bilibili-guard-icons.js';

export { DEFAULT_DANMAKU_CLASSES, measureDanmakuText };

// Keep the desktop's staggered entrance and existing system-message appearance.
export function createDanmakuMessageRenderer(options) {
  return createDanmakuRenderer({ bindGiftImage: bindGuardImage, ...options }, {
    decorateSystemMessages: false,
    entranceDelay: (index) => Math.min(index, 8) * 24,
  });
}
