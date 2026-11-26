'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { CLIENT_THEMES, DEFAULT_CLIENT_THEME_ID } = require('../../src/shared/client-theme');

const MODULE_PATH = path.resolve(__dirname, '../../public/js/admin/client-appearance.js');

function element(properties = {}) {
  const listeners = new Map();
  return {
    disabled: false,
    hidden: false,
    textContent: '',
    ...properties,
    addEventListener(type, listener) {
      const registered = listeners.get(type) || [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    async dispatch(type) {
      await Promise.all((listeners.get(type) || []).map((listener) => listener()));
    },
  };
}

async function createFixture({ themeId = 'neutral', setClientTheme, themes = CLIENT_THEMES } = {}) {
  const choices = themes.map(({ id }) => element({ value: id, checked: false, defaultChecked: id === DEFAULT_CLIENT_THEME_ID }));
  const feedback = element();
  const panel = {
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    querySelectorAll() {
      return choices;
    },
    querySelector() {
      return feedback;
    },
  };
  const documentRef = {
    documentElement: { dataset: { clientTheme: themeId } },
    getElementById: (id) => (id === 'clientAppearance' ? panel : null),
  };
  const { initClientAppearance } = await loadModuleExports(MODULE_PATH);
  const init = () => initClientAppearance({ documentRef, desktopBridge: { setClientTheme } });
  init();
  return {
    choices,
    feedback,
    panel,
    documentRef,
    init,
    async choose(theme) {
      const choice = choices.find(({ value }) => value === theme);
      choice.checked = true;
      await choice.dispatch('change');
    },
  };
}

test('appearance choices save immediately and commit only after success, with one in-flight request', async () => {
  const requests = [];
  let complete;
  const fixture = await createFixture({
    setClientTheme(themeId) {
      requests.push(themeId);
      return new Promise((resolve) => { complete = resolve; });
    },
  });
  fixture.init();
  const applying = fixture.choose('terracotta');
  assert.deepEqual(requests, ['terracotta']);
  assert.equal(fixture.choices.find(choice => choice.checked).disabled, false, 'The focused radio stays enabled during save.');
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'neutral');
  await fixture.choose('classic');
  assert.deepEqual(requests, ['terracotta']);
  assert.equal(fixture.choices.find((choice) => choice.checked).value, 'terracotta');

  complete({ ok: true, themeId: 'terracotta' });
  await applying;
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'terracotta');
});

test('failed appearance writes restore the current selection and allow retry', async () => {
  for (const failure of [() => ({ ok: false }), () => Promise.reject(new Error('disk full'))]) {
    let attempt = 0;
    const fixture = await createFixture({
      themeId: 'classic',
      setClientTheme(themeId) {
        attempt += 1;
        return attempt === 1 ? failure() : { ok: true, themeId };
      },
    });
    await fixture.choose('terracotta');
    assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'classic');
    assert.equal(fixture.choices.find((choice) => choice.checked).value, 'classic');
    await fixture.choose('terracotta');
    assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'terracotta');
  }
});

test('unknown initial themes select the terracotta fallback and invalid responses do not apply', async () => {
  const fixture = await createFixture({
    themeId: 'future',
    setClientTheme: () => ({ ok: true, themeId: 'invalid' }),
  });
  assert.equal(fixture.choices.find((choice) => choice.checked).value, DEFAULT_CLIENT_THEME_ID);
  await fixture.choose('classic');
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'future');
});

test('appearance controls without the desktop bridge cannot change the preference', async () => {
  const fixture = await createFixture({ themeId: 'classic' });
  await fixture.choose('terracotta');
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'classic');
});

test('appearance accepts a catalog option without a separate frontend allowlist', async () => {
  const themes = [...CLIENT_THEMES, { id: 'catalog-addition' }];
  const fixture = await createFixture({ themes, setClientTheme: (themeId) => ({ ok: true, themeId }) });
  await fixture.choose('catalog-addition');
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'catalog-addition');
  const restored = await createFixture({ themes, themeId: 'catalog-addition', setClientTheme: () => {} });
  assert.equal(restored.choices.find((choice) => choice.checked).value, 'catalog-addition');
  await fixture.choose('classic');
  assert.equal(fixture.documentRef.documentElement.dataset.clientTheme, 'classic');
});

test('dual mode and category filters update counts, empty state, active-hidden reveal and scroll mask', async () => {
  const themes = [
    { id: 'terracotta', name: '暖陶', mode: 'light', category: 'warm-earth', categoryLabel: '暖调大地', surface: 'solid' },
    { id: 'opal-indigo', name: '云母 · 靛光', mode: 'light', category: 'polychrome', categoryLabel: '复合艺彩', surface: 'gradient' },
    { id: 'pine-jade', name: '松墨 · 青玉', mode: 'dark', category: 'botanical', categoryLabel: '青绿森系', surface: 'solid' },
  ];
  const cards = new Map();
  const choices = themes.map((theme) => {
    const card = element({
      dataset: {
        clientThemeCard: theme.id,
        clientThemeMode: theme.mode,
        clientThemeCategory: theme.category,
        clientThemeSurface: theme.surface,
      },
      scrolled: false,
      scrollIntoView() { this.scrolled = true; },
    });
    const choice = element({
      value: theme.id,
      checked: false,
      defaultChecked: theme.id === 'terracotta',
      focused: false,
      dataset: {
        clientThemeName: theme.name,
        clientThemeMode: theme.mode,
        clientThemeCategory: theme.category,
        clientThemeCategoryLabel: theme.categoryLabel,
        clientThemeSurface: theme.surface,
      },
      closest: () => card,
      focus() { this.focused = true; },
    });
    cards.set(theme.id, card);
    return choice;
  });

  const makeFilterButton = (key, value, label = '') => {
    const countSpan = element({ textContent: '0' });
    const labelSpan = element({ textContent: label });
    const attrs = {};
    return element({
      dataset: { [key]: value },
      attributes: attrs,
      setAttribute(name, next) { attrs[name] = next; },
      querySelector(sel) {
        if (sel === 'span' || sel === '.client-appearance-category-count') return countSpan;
        if (sel === '.client-appearance-category-label') return labelSpan;
        return null;
      },
      countSpan,
    });
  };

  const modeButtons = [
    makeFilterButton('clientThemeFilter', 'all'),
    makeFilterButton('clientThemeFilter', 'light'),
    makeFilterButton('clientThemeFilter', 'dark'),
  ];
  const categoryButtons = [
    makeFilterButton('clientThemeCategoryFilter', 'all', '全部色系'),
    makeFilterButton('clientThemeCategoryFilter', 'warm-earth', '暖调大地'),
    makeFilterButton('clientThemeCategoryFilter', 'botanical', '青绿森系'),
    makeFilterButton('clientThemeCategoryFilter', 'polychrome', '复合艺彩'),
  ];
  const groups = [
    element({ dataset: { clientThemeGroup: 'light' } }),
    element({ dataset: { clientThemeGroup: 'dark' } }),
  ];
  const groupClasses = new Set();
  const groupsContainer = element({
    querySelectorAll: () => groups,
    classList: {
      toggle(name, force) {
        if (force) groupClasses.add(name);
        else groupClasses.delete(name);
      },
      contains: (name) => groupClasses.has(name),
    },
  });
  const emptyMessage = element();
  const emptySwitchModeBtn = element();
  const emptyResetBtn = element();
  const emptyStateEl = element({
    hidden: true,
    querySelector(sel) {
      if (sel === '[data-empty-message]') return emptyMessage;
      if (sel === '[data-client-theme-empty-switch-mode]') return emptySwitchModeBtn;
      if (sel === '[data-client-theme-empty-reset]') return emptyResetBtn;
      return null;
    },
  });
  const activeHiddenName = element();
  const revealBtn = element();
  const activeHiddenHintEl = element({
    hidden: true,
    querySelector(sel) {
      if (sel === '[data-active-hidden-name]') return activeHiddenName;
      if (sel === '[data-client-theme-reveal]') return revealBtn;
      return null;
    },
  });
  const scrollContainer = element({
    dataset: { scrollTop: 'false', scrollBottom: 'false' },
    scrollHeight: 600,
    clientHeight: 300,
    scrollTop: 0,
  });
  const currentNameEl = element();
  const currentModeEl = element();
  const currentCategoryEl = element();
  const filterStatusEl = element();
  const feedback = element({ dataset: {} });
  const panel = {
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelectorAll: () => choices,
    querySelector: () => feedback,
  };
  const elementsById = {
    clientAppearance: panel,
    clientThemeCurrentName: currentNameEl,
    clientThemeCurrentMode: currentModeEl,
    clientThemeCurrentCategory: currentCategoryEl,
    clientThemeFilters: element({ querySelectorAll: () => modeButtons }),
    clientThemeCategoryFilters: element({ querySelectorAll: () => categoryButtons }),
    clientThemeGroups: groupsContainer,
    clientThemeScroll: scrollContainer,
    clientThemeEmptyState: emptyStateEl,
    clientThemeActiveHiddenHint: activeHiddenHintEl,
    clientThemeFilterStatus: filterStatusEl,
  };
  const documentRef = {
    documentElement: { dataset: { clientTheme: 'terracotta' } },
    getElementById: (id) => elementsById[id] || null,
  };

  const { initClientAppearance } = await loadModuleExports(MODULE_PATH);
  initClientAppearance({
    documentRef,
    desktopBridge: { setClientTheme: (themeId) => ({ ok: true, themeId }) },
  });

  // Initial scroll mask indicates bottom overflow only
  assert.equal(scrollContainer.dataset.scrollTop, 'false');
  assert.equal(scrollContainer.dataset.scrollBottom, 'true');
  scrollContainer.scrollTop = 120;
  await scrollContainer.dispatch('scroll');
  assert.equal(scrollContainer.dataset.scrollTop, 'true');
  assert.equal(scrollContainer.dataset.scrollBottom, 'true');

  // Filter to dark mode -> active terracotta is hidden, polychrome count drops to 0
  await modeButtons[2].dispatch('click');
  assert.equal(cards.get('terracotta').hidden, true);
  assert.equal(cards.get('pine-jade').hidden, false);
  assert.equal(activeHiddenHintEl.hidden, false);
  assert.equal(activeHiddenName.textContent, '暖陶');
  assert.equal(categoryButtons[3].countSpan.textContent, '0');
  assert.equal(categoryButtons[3].dataset.empty, 'true');

  // Combine dark + polychrome -> empty state appears
  await categoryButtons[3].dispatch('click');
  assert.equal(emptyStateEl.hidden, false);
  assert.match(emptyMessage.textContent, /复合艺彩/);
  assert.equal(activeHiddenHintEl.hidden, true);

  // Switch back to all modes while preserving polychrome category
  await emptySwitchModeBtn.dispatch('click');
  assert.equal(emptyStateEl.hidden, true);
  assert.equal(cards.get('opal-indigo').hidden, false);
  assert.equal(cards.get('terracotta').hidden, true);
  assert.equal(activeHiddenHintEl.hidden, false);

  // Clicking reveal restores all themes and focuses active card
  await revealBtn.dispatch('click');
  assert.equal(cards.get('terracotta').hidden, false);
  assert.equal(cards.get('terracotta').scrolled, true);
  assert.equal(choices[0].focused, true);

  // Saving dark theme updates mode/surface/category metadata on root & console
  choices[2].checked = true;
  await choices[2].dispatch('change');
  assert.equal(documentRef.documentElement.dataset.clientTheme, 'pine-jade');
  assert.equal(documentRef.documentElement.dataset.clientThemeMode, 'dark');
  assert.equal(documentRef.documentElement.dataset.clientThemeSurface, 'solid');
  assert.equal(currentNameEl.textContent, '松墨 · 青玉');
  assert.equal(currentModeEl.textContent, '深色');
  assert.equal(currentCategoryEl.textContent, '青绿森系');
});
