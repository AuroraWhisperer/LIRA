const initializedPanels = new WeakSet();

export function initDanmakuTabs({ documentRef = globalThis.document } = {}) {
  const root = documentRef.getElementById('otherDanmakuFeature');
  if (!root || initializedPanels.has(root)) return;
  initializedPanels.add(root);
  const tabs = [...root.querySelectorAll('[data-danmaku-tab]')];

  function selectTab(selected, focus = false) {
    for (const tab of tabs) {
      const active = tab === selected;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      documentRef.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
    }
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
}
