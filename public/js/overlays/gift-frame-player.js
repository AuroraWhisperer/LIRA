// 全屏礼物感谢播放器：只播放当前支持的林间花信主题。
'use strict';

import { createFrameController } from './gift-effects-frame.js';

export function createGiftFramePlayer({ frameRoot }) {
  const woodland = frameRoot ? createFrameController({ frameRoot }) : null;
  let disposed = false;

  return {
    play(payload) {
      if (disposed || (payload?.themeId && payload.themeId !== 'woodland-bloom')) return Promise.resolve();
      return woodland ? woodland.play(payload) : Promise.resolve();
    },
    dispose() {
      disposed = true;
      woodland?.dispose();
    },
  };
}
