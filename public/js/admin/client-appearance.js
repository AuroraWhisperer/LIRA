'use strict';

import { initClientFontSettings } from './client-font-settings.js';
import { applyClientTheme } from '../shared/client-theme-runtime.js';

const initializedPanels = new WeakSet();

function attachHorizontalKeyboardNav(container, buttons, { onEscape } = {}) {
  if (!container || !buttons.length || typeof container.addEventListener !== 'function') return;
  container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && typeof onEscape === 'function') {
      onEscape();
      return;
    }
    const index = buttons.indexOf(event.target);
    if (index === -1) return;
    let nextIndex = -1;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = buttons.length - 1;
    if (nextIndex === -1) return;
    event.preventDefault();
    buttons[nextIndex].focus?.();
  });
}

export function initClientAppearance({ documentRef = document, desktopBridge = window.songAssistantDesktop } = {}) {
  const panel = documentRef.getElementById('clientAppearance');
  if (!panel || initializedPanels.has(panel)) return;
  initializedPanels.add(panel);
  initClientFontSettings(documentRef, desktopBridge);

  const choices = [...panel.querySelectorAll('input[name="clientTheme"]')];
  const entries = choices.map((choice) => {
    const card = typeof choice.closest === 'function' ? choice.closest('[data-client-theme-card]') : null;
    const mode = choice.dataset?.clientThemeMode || card?.dataset?.clientThemeMode || '';
    const category = choice.dataset?.clientThemeCategory || card?.dataset?.clientThemeCategory || '';
    const categoryLabel = choice.dataset?.clientThemeCategoryLabel || '';
    const surface = choice.dataset?.clientThemeSurface || card?.dataset?.clientThemeSurface || '';
    const name = choice.dataset?.clientThemeName || choice.value;
    return { choice, card, id: choice.value, name, mode, category, categoryLabel, surface };
  });
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const themeIds = new Set(entries.map((entry) => entry.id));

  const feedback = panel.querySelector('[data-client-theme-feedback]');
  const currentNameEl = documentRef.getElementById('clientThemeCurrentName');
  const currentModeEl = documentRef.getElementById('clientThemeCurrentMode');
  const currentCategoryEl = documentRef.getElementById('clientThemeCurrentCategory');
  const filterBar = documentRef.getElementById('clientThemeFilters');
  const categoryFilterBar = documentRef.getElementById('clientThemeCategoryFilters');
  const groupsContainer = documentRef.getElementById('clientThemeGroups');
  const scrollContainer = documentRef.getElementById('clientThemeScroll');
  const emptyStateEl = documentRef.getElementById('clientThemeEmptyState');
  const activeHiddenHintEl = documentRef.getElementById('clientThemeActiveHiddenHint');
  const filterStatusEl = documentRef.getElementById('clientThemeFilterStatus');

  const canApply = typeof desktopBridge?.setClientTheme === 'function';
  const initialTheme = documentRef.documentElement?.dataset?.clientTheme;
  const fallbackChoice = choices.find((choice) => choice.defaultChecked) || choices[0];
  let currentTheme = themeIds.has(initialTheme) ? initialTheme : (fallbackChoice?.value || 'terracotta');
  let pendingTheme = '';
  let activeMode = 'all';
  let activeCategory = 'all';

  const modeButtons = filterBar && typeof filterBar.querySelectorAll === 'function'
    ? [...filterBar.querySelectorAll('[data-client-theme-filter]')]
    : [];
  const categoryButtons = categoryFilterBar && typeof categoryFilterBar.querySelectorAll === 'function'
    ? [...categoryFilterBar.querySelectorAll('[data-client-theme-category-filter]')]
    : [];
  const groups = groupsContainer && typeof groupsContainer.querySelectorAll === 'function'
    ? [...groupsContainer.querySelectorAll('[data-client-theme-group]')]
    : [];
  const emptyMessageEl = emptyStateEl && typeof emptyStateEl.querySelector === 'function'
    ? emptyStateEl.querySelector('[data-empty-message]')
    : null;
  const emptySwitchModeBtn = emptyStateEl && typeof emptyStateEl.querySelector === 'function'
    ? emptyStateEl.querySelector('[data-client-theme-empty-switch-mode]')
    : null;
  const emptyResetBtn = emptyStateEl && typeof emptyStateEl.querySelector === 'function'
    ? emptyStateEl.querySelector('[data-client-theme-empty-reset]')
    : null;
  const activeHiddenNameEl = activeHiddenHintEl && typeof activeHiddenHintEl.querySelector === 'function'
    ? activeHiddenHintEl.querySelector('[data-active-hidden-name]')
    : null;
  const revealActiveBtn = activeHiddenHintEl && typeof activeHiddenHintEl.querySelector === 'function'
    ? activeHiddenHintEl.querySelector('[data-client-theme-reveal]')
    : null;

  function setFeedback(text, state = '') {
    if (!feedback) return;
    feedback.textContent = text;
    if (feedback.dataset) feedback.dataset.state = state;
  }

  function updateScrollFade() {
    if (!scrollContainer?.dataset) return;
    const scrollHeight = Number(scrollContainer.scrollHeight) || 0;
    const clientHeight = Number(scrollContainer.clientHeight) || 0;
    const scrollTop = Number(scrollContainer.scrollTop) || 0;
    const maxScroll = scrollHeight - clientHeight;
    const hasTop = maxScroll > 4 && scrollTop > 4;
    const hasBottom = maxScroll > 4 && scrollTop < maxScroll - 4;
    scrollContainer.dataset.scrollTop = String(hasTop);
    scrollContainer.dataset.scrollBottom = String(hasBottom);
  }

  function scheduleScrollFade() {
    if (!scrollContainer) return;
    updateScrollFade();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(updateScrollFade);
    }
  }

  function updateActiveHiddenNotice(totalVisible) {
    if (!activeHiddenHintEl) return;
    const currentEntry = entryById.get(currentTheme);
    const isHidden = Boolean(currentEntry?.card?.hidden) && totalVisible > 0;
    activeHiddenHintEl.hidden = !isHidden;
    if (isHidden && activeHiddenNameEl) {
      activeHiddenNameEl.textContent = currentEntry.name;
    }
  }

  function applyFilters({ announce = false, resetScroll = false } = {}) {
    for (const button of modeButtons) {
      button.setAttribute('aria-pressed', String((button.dataset?.clientThemeFilter || 'all') === activeMode));
    }
    for (const button of categoryButtons) {
      button.setAttribute(
        'aria-pressed',
        String((button.dataset?.clientThemeCategoryFilter || 'all') === activeCategory),
      );
    }

    let totalVisible = 0;
    const visibleByMode = { light: 0, dark: 0 };
    const modeCountsForCategory = { all: 0, light: 0, dark: 0 };
    const categoryCountsForMode = new Map();
    let categoryTotalForMode = 0;

    for (const entry of entries) {
      const matchesMode = activeMode === 'all' || entry.mode === activeMode;
      const matchesCategory = activeCategory === 'all' || entry.category === activeCategory;
      const visible = matchesMode && matchesCategory;
      if (entry.card) entry.card.hidden = !visible;
      if (visible) {
        totalVisible += 1;
        if (entry.mode === 'dark') visibleByMode.dark += 1;
        else visibleByMode.light += 1;
      }
      if (matchesCategory) {
        modeCountsForCategory.all += 1;
        if (entry.mode === 'dark') modeCountsForCategory.dark += 1;
        else modeCountsForCategory.light += 1;
      }
      if (matchesMode) {
        categoryTotalForMode += 1;
        if (entry.category) {
          categoryCountsForMode.set(entry.category, (categoryCountsForMode.get(entry.category) || 0) + 1);
        }
      }
    }

    for (const button of modeButtons) {
      const countEl = typeof button.querySelector === 'function' ? button.querySelector('span') : null;
      if (!countEl) continue;
      const modeKey = button.dataset?.clientThemeFilter || 'all';
      countEl.textContent = String(modeCountsForCategory[modeKey] ?? 0);
    }

    for (const button of categoryButtons) {
      const catKey = button.dataset?.clientThemeCategoryFilter || 'all';
      const count = catKey === 'all' ? categoryTotalForMode : (categoryCountsForMode.get(catKey) || 0);
      const countEl = typeof button.querySelector === 'function'
        ? button.querySelector('.client-appearance-category-count')
        : null;
      if (countEl) countEl.textContent = String(count);
      if (button.dataset) button.dataset.empty = String(catKey !== 'all' && count === 0);
    }

    let visibleGroups = 0;
    for (const group of groups) {
      const groupMode = group.dataset?.clientThemeGroup || '';
      const groupCount = groupMode === 'dark' ? visibleByMode.dark : visibleByMode.light;
      const hidden = groupCount === 0 || (activeMode !== 'all' && groupMode !== activeMode);
      group.hidden = hidden;
      if (!hidden) visibleGroups += 1;
    }

    if (groupsContainer?.classList) {
      groupsContainer.classList.toggle('is-filtered', activeMode !== 'all' || visibleGroups <= 1);
    }

    if (emptyStateEl) {
      emptyStateEl.hidden = totalVisible > 0;
      if (totalVisible === 0) {
        const activeCatBtn = categoryButtons.find(
          (button) => (button.dataset?.clientThemeCategoryFilter || 'all') === activeCategory,
        );
        const catLabel = activeCatBtn?.querySelector?.('.client-appearance-category-label')?.textContent || '';
        const modeLabel = activeMode === 'dark' ? '深色' : activeMode === 'light' ? '浅色' : '';
        if (emptyMessageEl) {
          emptyMessageEl.textContent = catLabel && modeLabel
            ? `「${catLabel}」色系下暂无${modeLabel}主题`
            : '当前筛选条件下暂无匹配的主题';
        }
        if (emptySwitchModeBtn) {
          emptySwitchModeBtn.hidden = activeMode === 'all';
        }
      }
    }

    updateActiveHiddenNotice(totalVisible);

    if (announce && filterStatusEl) {
      filterStatusEl.textContent = totalVisible > 0 ? `已显示 ${totalVisible} 套主题` : '当前筛选条件下暂无匹配主题';
    }

    if (resetScroll && scrollContainer) {
      scrollContainer.scrollTop = 0;
    }
    scheduleScrollFade();
  }

  function render() {
    const activeChoiceTheme = pendingTheme || currentTheme;
    for (const choice of choices) {
      choice.checked = choice.value === activeChoiceTheme;
      choice.disabled = !canApply || (Boolean(pendingTheme) && !choice.checked);
    }
    const committedEntry = entryById.get(currentTheme);
    if (currentNameEl && committedEntry?.name) {
      currentNameEl.textContent = committedEntry.name;
    }
    if (currentModeEl && committedEntry?.mode) {
      currentModeEl.textContent = committedEntry.mode === 'dark' ? '深色' : '浅色';
    }
    if (currentCategoryEl) {
      currentCategoryEl.textContent = committedEntry?.categoryLabel || '';
    }
    panel.setAttribute('aria-busy', String(Boolean(pendingTheme)));
    updateActiveHiddenNotice(entries.filter((entry) => !entry.card?.hidden).length);
  }

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      const nextMode = button.dataset?.clientThemeFilter || 'all';
      if (nextMode === activeMode) return;
      activeMode = nextMode;
      applyFilters({ announce: true, resetScroll: true });
    });
  }

  for (const button of categoryButtons) {
    button.addEventListener('click', () => {
      const nextCategory = button.dataset?.clientThemeCategoryFilter || 'all';
      activeCategory = nextCategory === activeCategory && nextCategory !== 'all' ? 'all' : nextCategory;
      applyFilters({ announce: true, resetScroll: true });
    });
  }

  attachHorizontalKeyboardNav(filterBar, modeButtons);
  attachHorizontalKeyboardNav(categoryFilterBar, categoryButtons, {
    onEscape: () => {
      if (activeCategory === 'all') return;
      activeCategory = 'all';
      applyFilters({ announce: true, resetScroll: true });
      categoryButtons[0]?.focus?.();
    },
  });

  if (emptySwitchModeBtn) {
    emptySwitchModeBtn.addEventListener('click', () => {
      activeMode = 'all';
      applyFilters({ announce: true, resetScroll: true });
    });
  }

  if (emptyResetBtn) {
    emptyResetBtn.addEventListener('click', () => {
      activeMode = 'all';
      activeCategory = 'all';
      applyFilters({ announce: true, resetScroll: true });
    });
  }

  if (revealActiveBtn) {
    revealActiveBtn.addEventListener('click', () => {
      activeMode = 'all';
      activeCategory = 'all';
      applyFilters({ announce: true, resetScroll: false });
      const activeEntry = entryById.get(currentTheme);
      activeEntry?.card?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      activeEntry?.choice?.focus?.();
    });
  }

  if (scrollContainer && typeof scrollContainer.addEventListener === 'function') {
    scrollContainer.addEventListener('scroll', updateScrollFade, { passive: true });
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(updateScrollFade);
      observer.observe(scrollContainer);
      if (groupsContainer) observer.observe(groupsContainer);
    } else if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', updateScrollFade, { passive: true });
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
        const committed = entryById.get(currentTheme);
        applyClientTheme(currentTheme, {
          broadcast: true,
          documentRef,
          mode: committed?.mode || undefined,
          surface: committed?.surface || undefined,
        });
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
  if (modeButtons.length || categoryButtons.length || scrollContainer) {
    applyFilters({ announce: false, resetScroll: false });
  }
}
