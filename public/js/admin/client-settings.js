'use strict';

import { bindTabNavigation } from '../shared/tab-navigation.js';
import { initDesktopNotificationSettings } from './desktop-notification-settings.js';

const initializedPanels = new WeakSet();

export function initClientSettings({ documentRef = document, storage } = {}) {
  const root = documentRef.getElementById('otherSettingsFeature');
  if (!root || initializedPanels.has(root)) return;
  initializedPanels.add(root);
  initDesktopNotificationSettings({ documentRef });
  const tabs = [...root.querySelectorAll('[data-client-settings-tab]')];

  function selectTab(selected) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      documentRef.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
    root.querySelector('.client-settings-content').scrollTop = 0;
  }

  bindTabNavigation(tabs, selectTab);

  // Restore the old update-page destination after it joins client settings.
  let restoreAbout = false;
  try {
    const preferences = storage ?? window.localStorage;
    restoreAbout = preferences?.getItem('admin.toolboxSelectedFeature') === 'otherDesktopUpdateFeature';
    if (restoreAbout) {
      preferences.setItem('admin.toolboxSelectedFeature', 'otherSettingsFeature');
    }
  } catch (error) {
    console.warn('[ClientSettings] Failed to migrate the saved settings destination:', error);
  }
  if (restoreAbout) selectTab(documentRef.getElementById('settingsAboutTab'));
}
