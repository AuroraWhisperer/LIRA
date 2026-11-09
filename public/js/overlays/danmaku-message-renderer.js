import { DEFAULT_DANMAKU_CLASSES, createDanmakuRenderer, measureDanmakuText } from './danmaku-renderer-core.js';
import { createRipploidGuardCard, decorateRipploidMessage } from './danmaku-ripploid.js';
import { decorateTwitterMessage } from './danmaku-twitter.js';
import { bindGiftImage, resolveGiftImageSource } from '../shared/gift-image.js';
import { createSpookyMessageRenderer } from './danmaku-spooky.js';
import { createNotebookMessageRenderer } from './danmaku-notebook.js';
import { createFlowerLetterMessageRenderer } from './danmaku-flower-letter.js';
import { createChristmasMessageRenderer } from './danmaku-christmas.js';
import { createChristmasLetterMessageRenderer } from './danmaku-christmas-letter.js';
import { createWireframeMessageRenderer } from './danmaku-wireframe.js';
import { createDarkMoonMessageRenderer } from './danmaku-dark-moon.js';
import { createComicMessageRenderer } from './danmaku-comic.js';
import { createWindowMessageRenderer } from './danmaku-window.js';
import { createStardustMessageRenderer } from './danmaku-stardust.js';
import { createSinkingMessageRenderer } from './danmaku-sinking.js';
import { createGlowyMessageRenderer } from './danmaku-glowy.js';
import { createGlassMessageRenderer } from './danmaku-glass.js';
import { createGlassBubbleMessageRenderer } from './danmaku-glass-bubble.js';
import { createAnimatedGradientMessageRenderer } from './danmaku-animated-gradient.js';
import { createStartrailMessageRenderer } from './danmaku-startrail.js';
import { createAuroraMessageRenderer } from './danmaku-aurora.js';
import { createSeaBreezeMessageRenderer } from './danmaku-sea-breeze.js';
import { createStargazerMessageRenderer } from './danmaku-stargazer.js';
import { createRandomEntranceRenderer } from './danmaku-random-entrance.js';
import { DANMAKU_STYLE_OPTIONS } from '../shared/danmaku-style-options.js';
import { createCelestialHorizontalMessageRenderer } from './danmaku-celestial-horizontal.js';
import { createNeonGlassMessageRenderer } from './danmaku-neon-glass.js';
import { createHorizontalCharmMessageRenderer } from './danmaku-horizontal-charm.js';
import { createAstralMessageRenderer } from './danmaku-astral.js';
import { createCoffeeMessageRenderer } from './danmaku-coffee.js';
import { isHarborGiftVisible } from './danmaku-harbor.js';

export { DEFAULT_DANMAKU_CLASSES, measureDanmakuText };

export function createDanmakuMessageFilter(options, fullscreen) {
  const showSuperchat = !fullscreen || ['mist', 'comic', 'window', 'stardust'].includes(options.style)
    || DANMAKU_STYLE_OPTIONS[options.style]?.fullscreenSuperchat === true;
  return (item) => (showSuperchat || item?.kind !== 'superchat')
    && (options.style !== 'harbor' || isHarborGiftVisible(item, options.minGiftAmount));
}

// Keep the desktop's staggered entrance and existing system-message appearance.
export function createDanmakuMessageRenderer(options) {
  const render = createStyleRenderer(options);
  return (item = {}, index = 0) => {
    if (item.kind === 'gift' && [1, 2, 3].includes(Number(item.giftGuardLevel))) {
      item = { ...item, giftImageUrl: options.style === 'twitter' ? '' : resolveGiftImageSource('', item.giftGuardLevel) };
    }
    return render(item, index);
  };
}

function createStyleRenderer(options) {
  if (options.style === 'neon-glass') options = { ...options, showAvatar: false };
  const seaBreeze = ['sea-breeze', 'sea-breeze-random'].includes(options.style);
  if (seaBreeze || ['celestial-horizontal', 'horizontal-charm'].includes(options.style)) options = { ...options, showAvatar: false };
  const render = createDanmakuRenderer({ bindGiftImage, showGiftTotal: options.style === 'aurora', ...options,
    ...(['dark-moon', 'glass', 'animated-gradient', 'glass-bubble', 'astral'].includes(options.style) ? { showAvatar: false } : {}),
  }, {
    decorateSystemMessages: false,
    entranceDelay: (index) => Math.min(index, 8) * 24,
  });
  if (seaBreeze) {
    const decorate = createSeaBreezeMessageRenderer(options, render);
    return options.fullscreen ? createRandomEntranceRenderer(options, decorate, DANMAKU_STYLE_OPTIONS[options.style]) : decorate;
  }
  if (options.style === 'celestial-horizontal') return createCelestialHorizontalMessageRenderer(options, render);
  if (options.style === 'neon-glass') return createNeonGlassMessageRenderer(options, render);
  if (options.style === 'horizontal-charm') return createHorizontalCharmMessageRenderer(options, render);
  if (options.style === 'astral') return createAstralMessageRenderer(options, render);
  if (options.style === 'coffee') return createCoffeeMessageRenderer(options, render);
  if (options.style === 'aurora') return createAuroraMessageRenderer(options, render);
  if (options.style === 'stargazer') return createStargazerMessageRenderer(options, render);
  if (options.style === 'notebook') return createNotebookMessageRenderer(options, render);
  if (options.style === 'spooky') return createSpookyMessageRenderer(options, render);
  if (options.style === 'flower-letter') return createFlowerLetterMessageRenderer(options, render);
  if (options.style === 'christmas') return createChristmasMessageRenderer(options, render);
  if (options.style === 'christmas-letter') return createChristmasLetterMessageRenderer(options, render);
  if (options.style === 'wireframe') return createWireframeMessageRenderer(options, render);
  if (options.style === 'dark-moon') return createDarkMoonMessageRenderer(options, render);
  if (options.style === 'comic') return createComicMessageRenderer(options, render);
  if (options.style === 'window') return createWindowMessageRenderer(options, render);
  if (options.style === 'stardust') return createStardustMessageRenderer(options, render);
  if (options.style === 'sinking') return createSinkingMessageRenderer(options, render);
  if (options.style === 'glowy') return createGlowyMessageRenderer(options, render);
  if (options.style === 'glass') return createGlassMessageRenderer(options, render);
  if (options.style === 'glass-bubble') return createGlassBubbleMessageRenderer(options, render);
  if (options.style === 'animated-gradient') return createAnimatedGradientMessageRenderer(options, render);
  if (options.style === 'startrail') return createStartrailMessageRenderer(options, render);
  if (DANMAKU_STYLE_OPTIONS[options.style]?.entranceAnimation) {
    return createRandomEntranceRenderer(options, render, DANMAKU_STYLE_OPTIONS[options.style]);
  }
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
