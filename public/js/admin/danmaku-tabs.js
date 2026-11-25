import { bindTabNavigation } from '../shared/tab-navigation.js';
const initializedPanels = new WeakSet();

export function initDanmakuTabs({ documentRef = globalThis.document } = {}) {
  const root = documentRef.getElementById('otherDanmakuFeature');
  if (!root || initializedPanels.has(root)) return;
  initializedPanels.add(root);
  const tabs = [...root.querySelectorAll('[data-danmaku-tab]')];

  function selectTab(selected) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      documentRef.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
  }

  bindTabNavigation(tabs, selectTab);
}
