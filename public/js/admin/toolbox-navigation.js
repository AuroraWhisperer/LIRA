// 编写人：Aurora
// 功能工作区共用导航行为，每个页面独立保存选中项。
'use strict';

import { createSelectionMotion } from './toolbox-selection-motion.js';

export function createFeatureNavigation({ pageId, storagePrefix }) {
  const SIDEBAR_COLLAPSED_KEY = `${storagePrefix}SidebarCollapsed`;
  const COLLAPSED_FEATURE_GROUPS_KEY = `${storagePrefix}CollapsedFeatureGroups`;
  const SELECTED_FEATURE_KEY = `${storagePrefix}SelectedFeature`;
  const selectionMotion = createSelectionMotion();
  const moduleState = {
    initialized: false,
    onFeatureSelected: null,
    danmakuTool: null,
    aiAssistantSettings: null,
    persistSidebarCollapsed: null,
    persistCollapsedFeatureGroups: null,
    sidebarPreferenceReconciled: false,
    featureGroupPreferenceReconciled: false,
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
    const durableValue = settingValue === 'true' ? true : settingValue === 'false' ? false : null;
    const collapsed = cachedValue ?? durableValue ?? false;

    setSidebarCollapsed(root, collapsed);
    if (durableValue !== collapsed) persistSidebarCollapsed(collapsed);
  }

  function parseCollapsedFeatureGroups(root, rawValue) {
    if (typeof rawValue !== 'string' || !rawValue.trim()) return null;
    try {
      const parsed = JSON.parse(rawValue);
      if (!Array.isArray(parsed)) return null;
      const storedIds = new Set(parsed.filter((value) => typeof value === 'string'));
      return getFeatureGroupElements(root)
        .map((heading) => heading.dataset.otherFeatureGroup)
        .filter((groupId) => storedIds.has(groupId));
    } catch {
      return null;
    }
  }

  function readCollapsedFeatureGroups(root) {
    try {
      return parseCollapsedFeatureGroups(root, window.localStorage?.getItem(COLLAPSED_FEATURE_GROUPS_KEY));
    } catch {
      return null;
    }
  }

  function storeCollapsedFeatureGroups(groupIds) {
    try {
      window.localStorage?.setItem(COLLAPSED_FEATURE_GROUPS_KEY, JSON.stringify(groupIds));
    } catch (error) {
      console.warn('[Toolbox] Failed to cache feature group preferences:', error);
    }
  }

  function persistCollapsedFeatureGroups(groupIds) {
    if (!moduleState.persistCollapsedFeatureGroups) return;
    try {
      const request = moduleState.persistCollapsedFeatureGroups([...groupIds]);
      request?.catch?.((error) => {
        console.warn('[Toolbox] Failed to persist feature group preferences:', error);
      });
    } catch (error) {
      console.warn('[Toolbox] Failed to persist feature group preferences:', error);
    }
  }

  function getCollapsedFeatureGroups(root) {
    return getFeatureGroupElements(root)
      .filter((heading) => heading.getAttribute('aria-expanded') === 'false')
      .map((heading) => heading.dataset.otherFeatureGroup);
  }

  function applyCollapsedFeatureGroups(root, groupIds) {
    const collapsedIds = new Set(groupIds);
    getFeatureGroupElements(root).forEach((heading) => {
      setFeatureGroupExpanded(root, heading, !collapsedIds.has(heading.dataset.otherFeatureGroup));
    });
  }

  function saveCollapsedFeatureGroups(root) {
    const groupIds = getCollapsedFeatureGroups(root);
    storeCollapsedFeatureGroups(groupIds);
    persistCollapsedFeatureGroups(groupIds);
  }

  function reconcileCollapsedFeatureGroups(root, settings) {
    if (moduleState.featureGroupPreferenceReconciled) return;
    moduleState.featureGroupPreferenceReconciled = true;

    const cachedValue = readCollapsedFeatureGroups(root);
    const durableValue = parseCollapsedFeatureGroups(root, settings?.toolboxCollapsedFeatureGroups);
    const collapsedGroups = cachedValue ?? durableValue ?? [];

    applyCollapsedFeatureGroups(root, collapsedGroups);
    storeCollapsedFeatureGroups(collapsedGroups);
    if (JSON.stringify(durableValue) !== JSON.stringify(collapsedGroups)) {
      persistCollapsedFeatureGroups(collapsedGroups);
    }
  }

  function getFeatureElements(root) {
    return {
      buttons: Array.from(root.querySelectorAll('[data-other-feature]')),
      panels: Array.from(root.querySelectorAll('[data-other-feature-panel]')),
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
    if (sibling?.dataset?.otherFeatureSubmenu !== undefined) {
      return Array.from(sibling.querySelectorAll('[data-other-feature]'));
    }
    while (sibling && !sibling.dataset?.otherFeatureGroup) {
      if (sibling.dataset?.otherFeature) buttons.push(sibling);
      sibling = sibling.nextElementSibling;
    }
    return buttons;
  }

  function getFeatureGroupForButton(root, targetButton) {
    return getFeatureGroupElements(root).find((heading) => getGroupButtons(heading).includes(targetButton));
  }

  function setFeatureGroupExpanded(root, heading, expanded) {
    const isExpanded = Boolean(expanded);
    const groupLabel = heading.querySelector?.('strong')?.textContent?.trim() || '功能分组';
    const actionLabel = `${isExpanded ? '收起' : '展开'}${groupLabel}`;
    heading.setAttribute('aria-expanded', String(isExpanded));
    heading.setAttribute('aria-label', actionLabel);
    heading.title = actionLabel;

    getGroupButtons(heading).forEach((button) => {
      if (!isExpanded) {
        if (!button.hidden) button.dataset.otherFeatureGroupHidden = 'true';
        if (button.dataset.otherFeatureGroupHidden === 'true') button.inert = true;
        button.hidden = true;
        return;
      }

      if (button.dataset.otherFeatureGroupHidden === 'true') {
        button.hidden = false;
        button.inert = false;
        delete button.dataset.otherFeatureGroupHidden;
      }
    });
    syncFeatureTabStop(root);
  }

  function syncFeatureTabStop(root) {
    const { buttons, panels } = getFeatureElements(root);
    const visible = buttons.filter((button) => isFeatureAvailable(button, panels));
    const entry = visible.find((button) => button.getAttribute('aria-selected') === 'true')
      || visible.find((button) => button.tabIndex === 0) || visible[0];
    buttons.forEach((button) => { button.tabIndex = button === entry ? 0 : -1; });
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

  let pendingPanelFrame = 0;

  function cancelPendingPanel() {
    if (!pendingPanelFrame) return;
    window.cancelAnimationFrame?.(pendingPanelFrame);
    pendingPanelFrame = 0;
  }

  /**
   * 根据按钮声明的面板 ID 切换内容，不依赖任何具体功能模块。
   */
  function selectFeature(root, featureId, { deferPanel = false } = {}) {
    if (!root) return false;
    cancelPendingPanel();

    const { buttons, panels } = getFeatureElements(root);
    const targetButton = buttons.find(
      (button) =>
        button.dataset.otherFeature === featureId && panels.some((panel) => panel.id === button.dataset.otherFeature),
    );
    if (targetButton?.hidden) {
      const groupHeading = getFeatureGroupForButton(root, targetButton);
      if (groupHeading?.getAttribute('aria-expanded') === 'false') {
        setFeatureGroupExpanded(root, groupHeading, true);
        saveCollapsedFeatureGroups(root);
      }
    }
    const selectedButton =
      buttons.find((button) => button.dataset.otherFeature === featureId && isFeatureAvailable(button, panels)) ||
      buttons.find((button) => isFeatureAvailable(button, panels));

    if (!selectedButton) return false;

    const selectedId = selectedButton.dataset.otherFeature;
    const animated = selectionMotion.transition(
      root,
      selectedButton,
      () => {
        buttons.forEach((button) => {
          const isActive = button === selectedButton;
          button.classList.toggle('active', isActive);
          button.setAttribute('aria-selected', String(isActive));
          button.tabIndex = isActive ? 0 : -1;
        });
      },
      { animate: moduleState.initialized },
    );
    storeSelectedFeature(selectedId);

    const commitPanel = () => {
      panels.forEach((panel) => {
        const isActive = panel.id === selectedId;
        panel.classList.toggle('active', isActive);
        panel.hidden = !isActive;
      });
      moduleState.onFeatureSelected?.(selectedId);

      if (selectedId === 'otherDanmakuFeature') {
        moduleState.danmakuTool?.refresh({ reconnectIfDisconnected: true });
        if (moduleState.initialized) moduleState.aiAssistantSettings?.refresh();
      }
    };

    // Let the compositor claim the spring indicator on frame 0 before heavy panels lay out on frame 1.
    if (deferPanel && animated && typeof window?.requestAnimationFrame === 'function') {
      pendingPanelFrame = window.requestAnimationFrame(() => {
        pendingPanelFrame = 0;
        commitPanel();
      });
    } else {
      commitPanel();
    }

    return true;
  }

  function selectFeatureById(featureId) {
    return selectFeature(document.getElementById(pageId), featureId);
  }

  function handleFeatureKeydown(root, currentButton, event) {
    const supportedKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!supportedKeys.includes(event.key)) return;

    const { buttons, panels } = getFeatureElements(root);
    const panelIds = new Set(panels.map((panel) => panel.id));
    const availableButtons = buttons.filter((button) => !button.hidden && panelIds.has(button.dataset.otherFeature));
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
    selectFeature(root, nextButton.dataset.otherFeature, { deferPanel: true });
    nextButton.focus();
  }

  function bindSidebarToggleCraft(toggle) {
    if (!toggle || typeof toggle.addEventListener !== 'function') return;

    const SETTLE_RELEASE_MS = 360;
    const SETTLE_RELEASE_DISTANCE = 4;
    let settledAt = 0;
    let settledX = 0;
    let settledY = 0;

    function prefersReducedMotion() {
      try {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
      } catch {
        return false;
      }
    }

    function clearMagnetic() {
      toggle.classList?.remove?.('is-magnetic');
      toggle.style?.setProperty('--toggle-tx', '0px');
      toggle.style?.setProperty('--toggle-ty', '0px');
      toggle.style?.setProperty('--toggle-itx', '0px');
      toggle.style?.setProperty('--toggle-ity', '0px');
      toggle.style?.setProperty('--toggle-mx', '50%');
      toggle.style?.setProperty('--toggle-my', '50%');
    }

    function clearSettled() {
      if (toggle.dataset) delete toggle.dataset.toggleSettled;
    }

    function markSettled(event) {
      if (toggle.dataset) toggle.dataset.toggleSettled = 'true';
      settledAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      settledX = typeof event?.clientX === 'number' ? event.clientX : 0;
      settledY = typeof event?.clientY === 'number' ? event.clientY : 0;
    }

    toggle.addEventListener('pointermove', (event) => {
      if (event?.pointerType === 'touch') return;
      if (toggle.dataset?.toggleSettled === 'true') {
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const moved = Math.hypot((event.clientX || 0) - settledX, (event.clientY || 0) - settledY);
        if (now - settledAt >= SETTLE_RELEASE_MS && moved >= SETTLE_RELEASE_DISTANCE) {
          clearSettled();
        }
      }
      if (prefersReducedMotion() || typeof toggle.getBoundingClientRect !== 'function' || !toggle.style) return;
      const rect = toggle.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const ny = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      const dx = (nx - 0.5) * 2;
      const dy = (ny - 0.5) * 2;
      toggle.classList?.add?.('is-magnetic');
      toggle.style.setProperty('--toggle-mx', `${(nx * 100).toFixed(1)}%`);
      toggle.style.setProperty('--toggle-my', `${(ny * 100).toFixed(1)}%`);
      toggle.style.setProperty('--toggle-tx', `${(dx * 1.6).toFixed(2)}px`);
      toggle.style.setProperty('--toggle-ty', `${(dy * 1.6).toFixed(2)}px`);
      toggle.style.setProperty('--toggle-itx', `${(dx * 1.25).toFixed(2)}px`);
      toggle.style.setProperty('--toggle-ity', `${(dy * 1.25).toFixed(2)}px`);
    });

    toggle.addEventListener('pointerleave', () => {
      clearMagnetic();
      clearSettled();
    });
    toggle.addEventListener('pointercancel', () => {
      clearMagnetic();
      clearSettled();
    });
    toggle.addEventListener('blur', clearSettled);

    return { markSettled };
  }

  function initOtherPage(options = {}) {
    const root = document.getElementById(pageId);
    if (!root || moduleState.initialized) return;

    moduleState.onFeatureSelected = options.onFeatureSelected;
    moduleState.danmakuTool = options.danmakuTool;
    moduleState.aiAssistantSettings = options.aiAssistantSettings;

    moduleState.persistSidebarCollapsed =
      typeof options.persistSidebarCollapsed === 'function' ? options.persistSidebarCollapsed : null;
    moduleState.persistCollapsedFeatureGroups =
      typeof options.persistCollapsedFeatureGroups === 'function' ? options.persistCollapsedFeatureGroups : null;
    const { buttons, panels } = getFeatureElements(root);
    const sidebarToggle = root.querySelector?.('[data-other-sidebar-toggle]');
    const navigationLinks = Array.from(root.querySelectorAll?.('[data-main-page-link]') || []);
    setSidebarCollapsed(root, readSidebarCollapsed() ?? false, false);
    const cachedCollapsedGroups = readCollapsedFeatureGroups(root);
    if (cachedCollapsedGroups) applyCollapsedFeatureGroups(root, cachedCollapsedGroups);
    window.addEventListener?.('app:settings-state', (event) => {
      reconcileSidebarCollapsed(root, event.detail || {});
      reconcileCollapsedFeatureGroups(root, event.detail || {});
    });
    const mobileLayout = window.matchMedia?.('(max-width: 900px)');
    const syncMobileGroupAvailability = () => syncFeatureGroupAvailability(root);
    if (mobileLayout?.addEventListener) mobileLayout.addEventListener('change', syncMobileGroupAvailability);
    else mobileLayout?.addListener?.(syncMobileGroupAvailability);
    const sidebarToggleCraft = bindSidebarToggleCraft(sidebarToggle);
    sidebarToggle?.addEventListener('click', (event) => {
      sidebarToggleCraft?.markSettled(event);
      const apply = () => {
        const collapsed = !root.classList.contains('sidebar-collapsed');
        setSidebarCollapsed(root, collapsed);
        persistSidebarCollapsed(collapsed);
      };
      if (options.transitionSidebar) options.transitionSidebar(apply);
      else apply();
    });
    navigationLinks.forEach((link) =>
      link.addEventListener('click', () => {
        options.onNavigate?.(link.dataset.mainPageLink);
        const targetTab = link.dataset.songTabTarget;
        if (targetTab) document.querySelector(`[data-tab="${targetTab}"]`)?.click();
        const targetFeature = link.dataset.otherFeatureTarget;
        if (targetFeature) {
          // The main page switch is synchronous; select the requested toolbox panel after it becomes visible.
          selectFeatureById(targetFeature);
        }
      }),
    );

    getFeatureGroupElements(root).forEach((heading) => {
      heading.addEventListener('click', () => {
        setFeatureGroupExpanded(root, heading, heading.getAttribute('aria-expanded') !== 'true');
        saveCollapsedFeatureGroups(root);
      });
    });

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        selectFeature(root, button.dataset.otherFeature, { deferPanel: true });
      });
      button.addEventListener('keydown', (event) => {
        handleFeatureKeydown(root, button, event);
      });
    });
    window.addEventListener?.('pagehide', cancelPendingPanel, { once: true });

    moduleState.danmakuTool?.init({ reconnectBilibili: options.reconnectBilibili });
    moduleState.aiAssistantSettings?.init();

    const storedFeature = readSelectedFeature();
    const storedButton = buttons.find(
      (button) => button.dataset.otherFeature === storedFeature && isFeatureAvailable(button, panels),
    );
    const initialButton =
      storedButton ||
      buttons.find((button) => button.getAttribute('aria-selected') === 'true' && isFeatureAvailable(button, panels));
    selectFeature(root, initialButton?.dataset.otherFeature);
    moduleState.initialized = true;
  }

  return {
    initOtherPage,
    selectFeature,
    selectFeatureById,
    setSidebarCollapsed,
  };
}
export const other = createFeatureNavigation({ pageId: 'otherAssistantPage', storagePrefix: 'admin.toolbox' });
