'use strict';

const initializedPanels = new WeakSet();

export function initClientAppearance({ documentRef = document, desktopBridge = window.songAssistantDesktop } = {}) {
  const panel = documentRef.getElementById('clientAppearance');
  if (!panel || initializedPanels.has(panel)) return;
  initializedPanels.add(panel);

  const choices = [...panel.querySelectorAll('input[name="clientTheme"]')];
  const themeIds = new Set(choices.map((choice) => choice.value));
  const feedback = panel.querySelector('[data-client-theme-feedback]');
  const currentNameEl = documentRef.getElementById('clientThemeCurrentName');
  const filterBar = documentRef.getElementById('clientThemeFilters');
  const canApply = typeof desktopBridge?.setClientTheme === 'function';
  const initialTheme = documentRef.documentElement.dataset.clientTheme;
  let currentTheme = themeIds.has(initialTheme) ? initialTheme : choices.find((choice) => choice.defaultChecked).value;
  let pendingTheme = '';

  function setFeedback(text, state = '') {
    if (!feedback) return;
    feedback.textContent = text;
    if (feedback.dataset) feedback.dataset.state = state;
  }

  function render() {
    const activeTheme = pendingTheme || currentTheme;
    for (const choice of choices) {
      choice.checked = choice.value === activeTheme;
      choice.disabled = !canApply || (Boolean(pendingTheme) && !choice.checked);
    }
    if (currentNameEl) {
      const selectedChoice = choices.find((choice) => choice.value === activeTheme);
      const label = selectedChoice?.dataset?.clientThemeName;
      if (label) currentNameEl.textContent = label;
    }
    panel.setAttribute('aria-busy', String(Boolean(pendingTheme)));
  }

  if (filterBar && typeof filterBar.querySelectorAll === 'function') {
    const filterButtons = [...filterBar.querySelectorAll('[data-client-theme-filter]')];
    const groupsContainer = panel.querySelector('.client-appearance-groups');
    const groups = groupsContainer ? [...groupsContainer.querySelectorAll('[data-client-theme-group]')] : [];

    for (const button of filterButtons) {
      button.addEventListener('click', () => {
        const mode = button.dataset.clientThemeFilter || 'all';
        for (const item of filterButtons) {
          item.setAttribute('aria-pressed', String(item === button));
        }
        if (groupsContainer) groupsContainer.classList.toggle('is-filtered', mode !== 'all');
        for (const group of groups) {
          group.hidden = mode !== 'all' && group.dataset.clientThemeGroup !== mode;
        }
      });
    }
  }

  for (const choice of choices) {
    choice.addEventListener('change', async () => {
      if (pendingTheme || !canApply || !choice.checked || !themeIds.has(choice.value) || choice.value === currentTheme) {
        render();
        return;
      }
      pendingTheme = choice.value;
      setFeedback('正在保存…', 'busy');
      render();
      try {
        const result = await desktopBridge.setClientTheme(choice.value);
        if (result?.ok !== true || !themeIds.has(result.themeId)) {
          throw new Error('Client theme was not saved');
        }
        currentTheme = result.themeId;
        documentRef.documentElement.dataset.clientTheme = currentTheme;
        setFeedback('配色已保存', 'saved');
      } catch {
        setFeedback('配色未保存，请重新选择', 'error');
      } finally {
        pendingTheme = '';
        render();
      }
    });
  }

  if (!canApply) setFeedback('请在桌面客户端设置配色。');
  render();
}
