// 礼物边框播放器分发：按 themeId 把同一笔事件交给对应特效的播放器。
'use strict';

import { createFrameController } from './gift-effects-frame.js';
import { createRibbonController } from './gift-frame-ribbon.js';

export function createGiftFramePlayer({ frameRoot, ribbonRoot }) {
  const woodland = frameRoot ? createFrameController({ frameRoot }) : null;
  let ribbon = null;
  let disposed = false;

  return {
    play(payload) {
      if (disposed) return Promise.resolve();
      if (payload?.themeId === 'satin-ribbon') {
        if (!ribbonRoot) return Promise.resolve();
        if (!ribbon) ribbon = createRibbonController({ root: ribbonRoot });
        return ribbon.play(payload);
      }
      return woodland ? woodland.play(payload) : Promise.resolve();
    },
    dispose() {
      disposed = true;
      woodland?.dispose();
      ribbon?.dispose();
      ribbon = null;
    },
  };
}
