import { createGiftDisplaySettings } from './gifts/display-settings.js';
import { createGiftWishes } from './gifts/wishes.js';
import { initGiftSprintOverlay } from './gifts/sprint-overlay.js';

let initialized = false;

export function initGiftAssistant() {
  const page = document.getElementById('liveComponentsPage');
  if (initialized || !page) return;
  initialized = true;
  const display = createGiftDisplaySettings();
  const wishes = createGiftWishes();
  initGiftSprintOverlay();
  const displayPanel = document.getElementById('giftDisplayFeature');
  const wishesPanel = document.getElementById('giftWishesFeature');
  const displayError = document.getElementById('giftDisplayError');
  let displayVisible = false;
  let wishesVisible = false;

  function syncVisibility() {
    const pageVisible = page.classList.contains('active');
    const nextWishesVisible = pageVisible && !wishesPanel.hidden;
    if (nextWishesVisible !== wishesVisible) {
      if (nextWishesVisible) wishes.open();
      else wishes.close();
      wishesVisible = nextWishesVisible;
    }
    const nextDisplayVisible = pageVisible && !displayPanel.hidden;
    if (nextDisplayVisible && !displayVisible) {
      display.open().catch((error) => {
        displayError.textContent = `${error.message}。点击「滚动礼物」重试。`;
      });
    }
    displayVisible = nextDisplayVisible;
  }

  document.getElementById('giftAssistantDisplayTab').addEventListener('click', () => {
    if (displayVisible && displayError.textContent) {
      displayVisible = false;
      syncVisibility();
    }
  });
  const visibility = new MutationObserver(syncVisibility);
  visibility.observe(displayPanel, { attributes: true, attributeFilter: ['hidden'] });
  visibility.observe(wishesPanel, { attributes: true, attributeFilter: ['hidden'] });
  visibility.observe(page, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('pagehide', () => {
    visibility.disconnect();
    wishes.close();
  });
  syncVisibility();
}
