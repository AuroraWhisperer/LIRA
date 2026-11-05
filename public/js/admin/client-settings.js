'use strict';

import { initDesktopNotificationSettings } from './desktop-notification-settings.js';

const initializedPanels = new WeakSet();

export function initClientSettings({ documentRef = document, storage } = {}) {
  const root = documentRef.getElementById('otherSettingsFeature');
  if (!root || initializedPanels.has(root)) return;
  initializedPanels.add(root);
  initDesktopNotificationSettings({ documentRef });
  const tabs = [...root.querySelectorAll('[data-client-settings-tab]')];

  function selectTab(selected, focus = false) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      documentRef.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
    root.querySelector('.client-settings-content').scrollTop = 0;
    if (focus) selected.focus();
  }

  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (event) => {
      const index = tabs.indexOf(tab);
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      selectTab(tabs[next], true);
    });
  }

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
