// 编写人：Aurora
// 播放助手模块入口文件
'use strict';

import { createPlaybackController } from './controller.js';

let playbackController = null;

export function initPlaybackAssistant(options = {}) {
  if (!playbackController) playbackController = createPlaybackController(options);
  playbackController.init();
}

export function closeQueuePopup() {
  playbackController?.closeQueuePopup();
}
