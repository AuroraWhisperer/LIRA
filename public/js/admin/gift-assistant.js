import { createGiftDisplaySettings } from './gifts/display-settings.js';

let initialized = false;

export function initGiftAssistant() {
  const root = document.getElementById('otherGiftFeature');
  if (initialized || !root) return;
  initialized = true;
  const display = createGiftDisplaySettings();
  const tabs = [...root.querySelectorAll('[data-gift-tab]')];

  function select(tab) {
    for (const button of tabs) {
      const active = button === tab;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      document.getElementById(button.getAttribute('aria-controls')).hidden = !active;
    }
    if (tab.dataset.giftTab === 'display') {
      display.open().catch((error) => {
        document.getElementById('giftDisplayError').textContent = `${error.message}。点击「滚动礼物」重试。`;
      });
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[next].focus();
      select(tabs[next]);
    });
  });
}
