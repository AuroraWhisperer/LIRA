import { DEFAULT_DANMAKU_CLASSES, createDanmakuRenderer, measureDanmakuText } from './danmaku-renderer-core.js';
import { createRipploidGuardCard, decorateRipploidMessage } from './danmaku-ripploid.js';
import { decorateTwitterMessage } from './danmaku-twitter.js';
import { bindGuardImage } from '../shared/bilibili-guard-icons.js';
import { createSpookyMessageRenderer } from './danmaku-spooky.js';
import { createNotebookMessageRenderer } from './danmaku-notebook.js';
import { createFlowerLetterMessageRenderer } from './danmaku-flower-letter.js';

export { DEFAULT_DANMAKU_CLASSES, measureDanmakuText };

// Keep the desktop's staggered entrance and existing system-message appearance.
export function createDanmakuMessageRenderer(options) {
  const render = createDanmakuRenderer({ bindGiftImage: bindGuardImage, ...options }, {
    decorateSystemMessages: false,
    entranceDelay: (index) => Math.min(index, 8) * 24,
  });
  if (options.style === 'notebook') return createNotebookMessageRenderer(options, render);
  if (options.style === 'spooky') return createSpookyMessageRenderer(options, render);
  if (options.style === 'flower-letter') return createFlowerLetterMessageRenderer(options, render);
  if (!['ripploid', 'twitter'].includes(options.style)) return render;
  const { document, classNames } = options;
  const resolveAvatarUrl = typeof options.resolveAvatarUrl === 'function' ? options.resolveAvatarUrl : (value) => value;
  return (item = {}, index = 0) => {
    if (options.style === 'ripploid' && item.kind === 'gift' && [1, 2, 3].includes(item.giftGuardLevel)) {
      return createRipploidGuardCard(document, item, classNames, resolveAvatarUrl, options.showAvatar ?? !options.fullscreen);
    }
    const bubble = render(item, index);
    if (item.kind === 'superchat') return bubble;
    const body = bubble.querySelector(`.${classNames.body}`);
    const parts = {
      identity: body.querySelector(`.${classNames.identity}`),
      body,
      message: body.children[1],
      classNames,
    };
    if (options.style === 'twitter') {
      decorateTwitterMessage(document, bubble, item, parts);
      return bubble;
    }
    decorateRipploidMessage(document, bubble, item, parts);
    return bubble;
  };
}
