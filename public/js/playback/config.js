// 编写人：Aurora
// 播放助手配置常量
'use strict';

/**
 * 播放助手配置常量
 */
export const PlaybackConfig = {
  // 存储相关
  STORAGE_KEY: 'songAssistantPlaybackState:v1',
  CLIENT_ID: 'default',
  STATE_SAVE_DEBOUNCE_MS: 1500,

  // 流媒体相关
  STREAM_REFRESH_MARGIN_MS: 30 * 1000,
  STREAM_MAX_RETRIES: 1,

  // 电台队列相关
  RADIO_REFILL_THRESHOLD: 3,
  RADIO_REFILL_BATCH_SIZE: 10,

  // 历史记录相关
  HISTORY_MAX_SIZE: 50,
  DISPLAY_HISTORY_MAX_SIZE: 200,

  // UI 相关
  FULLSCREEN_BG_THEME_COUNT: 30
};
