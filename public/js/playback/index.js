// 编写人：Aurora
// 播放助手模块入口文件
'use strict';

import { createPlaybackController } from './controller.js';

(function () {
  let playbackController = null;

  function initPlaybackAssistant(options = {}) {
    if (!playbackController) playbackController = createPlaybackController(options);
    playbackController.init(options);
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.playback = {
    initPlaybackAssistant
  };

  // 模块加载完成后触发自定义事件，通知 main.js 可以初始化了
  if (typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('playback-module-loaded'));
  }
})();
