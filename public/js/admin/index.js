'use strict';

import './contextual-help.js';
import './queue.js';
import './songs.js';
import { initResourceDownloads } from './resource-downloads.js';
import './gifts/index.js';
import './gift-frame.js';
import { initFanProfiles } from './fans/index.js';
import { initFanProfileAutoUpdate } from './fans/automatic-update.js';
import './app.js';
initResourceDownloads();
document.getElementById('giftQuerySettingsLink')?.addEventListener('click', () => {
  document.querySelector('[data-main-page="otherAssistantPage"]')?.click();
  document.querySelector('[data-other-feature="otherDanmakuFeature"]')?.click();
  document.getElementById('danmakuRepliesTab')?.click();
  const toggle = document.getElementById('danmakuQueryToggle');
  const target = toggle?.disabled ? document.getElementById('danmakuQueryControls') : toggle;
  if (!target) return;
  if (target !== toggle) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'center' });
});
initFanProfiles();
initFanProfileAutoUpdate();
