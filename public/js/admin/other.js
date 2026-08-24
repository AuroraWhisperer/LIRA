// 编写人：Aurora
// “百宝箱”页面仅负责功能导航，各功能模块继续独立初始化和维护。
'use strict';

(function () {
  const SIDEBAR_COLLAPSED_KEY = 'admin.toolboxSidebarCollapsed';
  const SELECTED_FEATURE_KEY = 'admin.toolboxSelectedFeature';
  const moduleState = {
    initialized: false,
    persistSidebarCollapsed: null,
    sidebarPreferenceReconciled: false
  };

  function readSidebarCollapsed() {
    try {
      const value = window.localStorage?.getItem(SIDEBAR_COLLAPSED_KEY);
      if (value === 'true') return true;
      if (value === 'false') return false;
      return null;
    } catch {
      return null;
    }
  }

  function persistSidebarCollapsed(collapsed) {
    if (!moduleState.persistSidebarCollapsed) return;
    try {
      const request = moduleState.persistSidebarCollapsed(Boolean(collapsed));
      request?.catch?.((error) => {
        console.warn('[Toolbox] Failed to persist sidebar preference:', error);
      });
    } catch (error) {
      console.warn('[Toolbox] Failed to persist sidebar preference:', error);
    }
  }

  function setSidebarCollapsed(root, collapsed, persist = true) {
    if (!root) return;

    const isCollapsed = Boolean(collapsed);
    root.classList?.toggle('sidebar-collapsed', isCollapsed);

    const toggle = root.querySelector?.('[data-other-sidebar-toggle]');
    if (toggle) {
      const actionLabel = isCollapsed ? '展开功能导航' : '收起功能导航';
      toggle.setAttribute('aria-label', actionLabel);
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      toggle.title = actionLabel;
    }

    getFeatureElements(root).buttons.forEach((button) => {
      const label = button.querySelector?.('.other-feature-label strong')?.textContent?.trim();
      if (isCollapsed && label) button.title = label;
      else button.removeAttribute?.('title');
    });

    syncFeatureGroupAvailability(root);

    if (!persist) return;
    try {
      window.localStorage?.setItem(SIDEBAR_COLLAPSED_KEY, String(isCollapsed));
    } catch {
      // The navigation still works when storage is disabled.
    }
  }

  function reconcileSidebarCollapsed(root, settings) {
    if (moduleState.sidebarPreferenceReconciled) return;
    moduleState.sidebarPreferenceReconciled = true;

    const cachedValue = readSidebarCollapsed();
    const settingValue = settings?.toolboxSidebarCollapsed;
    const durableValue = settingValue === 'true'
      ? true
      : settingValue === 'false'
        ? false
        : null;
    const collapsed = cachedValue ?? durableValue ?? false;

    setSidebarCollapsed(root, collapsed);
    if (durableValue !== collapsed) persistSidebarCollapsed(collapsed);
  }

  function getFeatureElements(root) {
    return {
      buttons: Array.from(root.querySelectorAll('[data-other-feature]')),
      panels: Array.from(root.querySelectorAll('[data-other-feature-panel]'))
    };
  }

  function getFeatureGroupElements(root) {
    return Array.from(root.querySelectorAll('[data-other-feature-group]'));
  }

  function isMobileOtherLayout() {
    try {
      return window.matchMedia?.('(max-width: 900px)').matches === true;
    } catch {
      return false;
    }
  }

  function syncFeatureGroupAvailability(root) {
    const iconOnly = root.classList?.contains?.('sidebar-collapsed') === true && !isMobileOtherLayout();
    getFeatureGroupElements(root).forEach((heading) => {
      heading.disabled = iconOnly;
      heading.tabIndex = iconOnly ? -1 : 0;
      heading.setAttribute('aria-hidden', String(iconOnly));
    });
  }

  function getGroupButtons(heading) {
    const buttons = [];
    let sibling = heading?.nextElementSibling;
    while (sibling && !sibling.dataset?.otherFeatureGroup) {
      if (sibling.dataset?.otherFeature) buttons.push(sibling);
      sibling = sibling.nextElementSibling;
    }
    return buttons;
  }

  function getFeatureGroupForButton(root, targetButton) {
    return getFeatureGroupElements(root).find((heading) => (
      getGroupButtons(heading).includes(targetButton)
    ));
  }

  function setFeatureGroupExpanded(heading, expanded) {
    const isExpanded = Boolean(expanded);
    const groupLabel = heading.querySelector?.('strong')?.textContent?.trim() || '功能分组';
    const actionLabel = `${isExpanded ? '收起' : '展开'}${groupLabel}`;
    heading.setAttribute('aria-expanded', String(isExpanded));
    heading.setAttribute('aria-label', actionLabel);
    heading.title = actionLabel;

    getGroupButtons(heading).forEach((button) => {
      if (!isExpanded) {
        if (!button.hidden) button.dataset.otherFeatureGroupHidden = 'true';
        button.hidden = true;
        return;
      }

      if (button.dataset.otherFeatureGroupHidden === 'true') {
        button.hidden = false;
        delete button.dataset.otherFeatureGroupHidden;
      }
    });
  }

  function isFeatureAvailable(button, panels) {
    return !button.hidden && panels.some((panel) => panel.id === button.dataset.otherFeature);
  }

  function readSelectedFeature() {
    try {
      return window.localStorage?.getItem(SELECTED_FEATURE_KEY) || '';
    } catch {
      return '';
    }
  }

  function storeSelectedFeature(featureId) {
    try {
      window.localStorage?.setItem(SELECTED_FEATURE_KEY, featureId);
    } catch {
      // The navigation still works when storage is disabled.
    }
  }

  /**
   * 根据按钮声明的面板 ID 切换内容，不依赖任何具体功能模块。
   */
  function selectFeature(root, featureId) {
    if (!root) return false;

    const { buttons, panels } = getFeatureElements(root);
    const targetButton = buttons.find((button) => (
      button.dataset.otherFeature === featureId
      && panels.some((panel) => panel.id === button.dataset.otherFeature)
    ));
    if (targetButton?.hidden) {
      const groupHeading = getFeatureGroupForButton(root, targetButton);
      if (groupHeading?.getAttribute('aria-expanded') === 'false') {
        setFeatureGroupExpanded(groupHeading, true);
      }
    }
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
    storeSelectedFeature(selectedId);

    if (selectedId === 'otherDanmakuFeature') {
      window.AdminApp.danmakuTool?.refresh({ reconnectIfDisconnected: true });
      window.AdminApp.aiAssistantSettings?.refresh();
    }

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

  function initOtherPage(options = {}) {
    const root = document.getElementById('otherAssistantPage');
    if (!root || moduleState.initialized) return;

    moduleState.persistSidebarCollapsed = typeof options.persistSidebarCollapsed === 'function'
      ? options.persistSidebarCollapsed
      : null;
    const { buttons, panels } = getFeatureElements(root);
    const sidebarToggle = root.querySelector?.('[data-other-sidebar-toggle]');
    const navigationLinks = Array.from(root.querySelectorAll?.('[data-main-page-link]') || []);
    setSidebarCollapsed(root, readSidebarCollapsed() ?? false, false);
    window.addEventListener?.('app:settings-state', (event) => {
      reconcileSidebarCollapsed(root, event.detail || {});
    });
    const mobileLayout = window.matchMedia?.('(max-width: 900px)');
    const syncMobileGroupAvailability = () => syncFeatureGroupAvailability(root);
    if (mobileLayout?.addEventListener) mobileLayout.addEventListener('change', syncMobileGroupAvailability);
    else mobileLayout?.addListener?.(syncMobileGroupAvailability);
    sidebarToggle?.addEventListener('click', () => {
      const collapsed = !root.classList.contains('sidebar-collapsed');
      setSidebarCollapsed(root, collapsed);
      persistSidebarCollapsed(collapsed);
    });
    navigationLinks.forEach((link) => link.addEventListener('click', () => {
      window.AdminApp.navigation?.setMainPage(link.dataset.mainPageLink);
      const targetFeature = link.dataset.otherFeatureTarget;
      if (targetFeature) {
        // The main page switch is synchronous; select the requested toolbox panel after it becomes visible.
        selectFeatureById(targetFeature);
      }
    }));

    getFeatureGroupElements(root).forEach((heading) => {
      heading.addEventListener('click', () => {
        setFeatureGroupExpanded(heading, heading.getAttribute('aria-expanded') !== 'true');
      });
    });

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        selectFeature(root, button.dataset.otherFeature);
      });
      button.addEventListener('keydown', (event) => {
        handleFeatureKeydown(root, button, event);
      });
    });

    window.AdminApp.danmakuTool?.init();
    window.AdminApp.aiAssistantSettings?.init();

    const storedFeature = readSelectedFeature();
    const storedButton = buttons.find((button) => (
      button.dataset.otherFeature === storedFeature
      && isFeatureAvailable(button, panels)
    ));
    const initialButton = storedButton
      || buttons.find((button) => (
        button.getAttribute('aria-selected') === 'true'
        && isFeatureAvailable(button, panels)
      ));
    selectFeature(root, initialButton?.dataset.otherFeature);
    moduleState.initialized = true;
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.other = {
    initOtherPage,
    selectFeature,
    selectFeatureById,
    setSidebarCollapsed
  };
})();
