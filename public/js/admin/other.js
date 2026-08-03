// 编写人：Aurora
// “百宝箱”页面仅负责功能导航，各功能模块继续独立初始化和维护。
'use strict';

(function () {
  const moduleState = {
    initialized: false
  };

  function getFeatureElements(root) {
    return {
      buttons: Array.from(root.querySelectorAll('[data-other-feature]')),
      panels: Array.from(root.querySelectorAll('[data-other-feature-panel]'))
    };
  }

  function isFeatureAvailable(button, panels) {
    return !button.hidden && panels.some((panel) => panel.id === button.dataset.otherFeature);
  }

  /**
   * 根据按钮声明的面板 ID 切换内容，不依赖任何具体功能模块。
   */
  function selectFeature(root, featureId) {
    if (!root) return false;

    const { buttons, panels } = getFeatureElements(root);
    const selectedButton = buttons.find((button) => (
      button.dataset.otherFeature === featureId
      && isFeatureAvailable(button, panels)
    )) || buttons.find((button) => isFeatureAvailable(button, panels));

    if (!selectedButton) return false;

    const selectedId = selectedButton.dataset.otherFeature;
    buttons.forEach((button) => {
      const isActive = button === selectedButton;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });
    panels.forEach((panel) => {
      const isActive = panel.id === selectedId;
      panel.classList.toggle('active', isActive);
      panel.hidden = !isActive;
    });

    return true;
  }

  function selectFeatureById(featureId) {
    return selectFeature(document.getElementById('otherAssistantPage'), featureId);
  }

  function handleFeatureKeydown(root, currentButton, event) {
    const supportedKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!supportedKeys.includes(event.key)) return;

    const { buttons, panels } = getFeatureElements(root);
    const panelIds = new Set(panels.map((panel) => panel.id));
    const availableButtons = buttons.filter((button) => (
      !button.hidden && panelIds.has(button.dataset.otherFeature)
    ));
    const currentIndex = availableButtons.indexOf(currentButton);
    if (currentIndex < 0 || !availableButtons.length) return;

    let nextIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = availableButtons.length - 1;
    else {
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      nextIndex = (currentIndex + step + availableButtons.length) % availableButtons.length;
    }

    event.preventDefault();
    const nextButton = availableButtons[nextIndex];
    selectFeature(root, nextButton.dataset.otherFeature);
    nextButton.focus();
  }

  function initOtherPage() {
    const root = document.getElementById('otherAssistantPage');
    if (!root || moduleState.initialized) return;

    const { buttons } = getFeatureElements(root);
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        selectFeature(root, button.dataset.otherFeature);
      });
      button.addEventListener('keydown', (event) => {
        handleFeatureKeydown(root, button, event);
      });
    });

    const initialButton = buttons.find((button) => button.getAttribute('aria-selected') === 'true');
    selectFeature(root, initialButton?.dataset.otherFeature);
    moduleState.initialized = true;
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.other = {
    initOtherPage,
    selectFeature,
    selectFeatureById
  };
})();
