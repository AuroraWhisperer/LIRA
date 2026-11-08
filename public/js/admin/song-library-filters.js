'use strict';

import { positionSelectMenu } from '../shared/select-menu-position.js';

const CATEGORY_SEPARATOR = /[\/／;；,，、]+/;

export function splitCategoryNames(categories) {
  const names = new Set();
  for (const category of categories) {
    const parts = String(category?.name ?? '').split(CATEGORY_SEPARATOR);
    for (const part of parts) {
      const name = part.trim();
      if (name && name !== '默认') names.add(name);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function closeFilterMenusOnOutsideClick(event, filters) {
  for (const filter of filters) {
    if (filter.open && !filter.contains(event.target)) {
      filter.open = false;
    }
  }
}

export function bindFilterMenuPopovers(filters) {
  const states = Array.from(filters, wrapper => ({
    wrapper,
    trigger: wrapper.querySelector('summary'),
    menu: wrapper.querySelector('.lira-multiselect-menu'),
  }));
  for (const state of states) {
    const { wrapper, trigger, menu } = state;
    menu.popover = 'manual';
    wrapper.addEventListener('toggle', () => {
      trigger.setAttribute('aria-expanded', String(wrapper.open));
      if (wrapper.open) {
        menu.showPopover({ source: trigger });
        positionSelectMenu(state);
      } else {
        if (menu.matches(':popover-open')) menu.hidePopover();
        wrapper.classList.remove('is-above');
      }
    });
    menu.addEventListener('toggle', event => {
      if (event.newState === 'closed' && !menu.matches(':popover-open')) wrapper.open = false;
    });
    const reposition = () => { if (wrapper.open) positionSelectMenu(state); };
    menu.addEventListener('change', reposition);
    menu.querySelector('.lira-multiselect-clear').addEventListener('click', reposition);
  }
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    for (const { wrapper, trigger } of states) {
      if (!wrapper.open) continue;
      event.preventDefault();
      wrapper.open = false;
      trigger.focus({ preventScroll: true });
    }
  });
  document.addEventListener('scroll', event => {
    if (event.target.closest?.('.lira-multiselect-menu')) return;
    for (const state of states) {
      if (!state.wrapper.open || !state.anchorRect) continue;
      const rect = state.trigger.getBoundingClientRect();
      if (rect.top !== state.anchorRect.top || rect.left !== state.anchorRect.left) state.wrapper.open = false;
    }
  }, true);
  window.addEventListener('resize', () => {
    for (const { wrapper } of states) wrapper.open = false;
  });
}

export function readSelectedCategories(root = document) {
  return Array.from(root.querySelectorAll('[data-category-filter]:checked')).map((input) => input.value);
}

export function readSelectedTags(root = document) {
  return Array.from(root.querySelectorAll('[data-tag-filter]:checked')).map((input) => input.value);
}

export function createSongLibraryFilters({ value, escapeHtml, escapeAttr, debounce, onChange }) {
  const renderedOptions = new Map();
  let previousFields = null;
  let previousFiltered;
  let previousLanguages;
  let previousArtists;

  function optionsChanged(key, values) {
    const previous = renderedOptions.get(key);
    if (previous?.size === (values.size ?? values.length)) {
      let unchanged = true;
      for (const value of values) {
        if (!previous.has(value)) { unchanged = false; break; }
      }
      if (unchanged) return false;
    }
    renderedOptions.set(key, new Set(values));
    return true;
  }

  function readSongFilters() {
    return {
      query: value('songSearch'),
      categories: readSelectedCategories(),
      language: value('languageFilter'),
      artist: value('artistFilter'),
      tags: readSelectedTags(),
      enabledOnly: value('enabledFilter') === 'true',
    };
  }
  function init() {
    document.getElementById('songSearch').addEventListener(
      'input',
      debounce(() => {
        onChange();
      }, 180),
    );
    document.getElementById('categoryFilterOptions').addEventListener('change', (event) => {
      if (!event.target.matches('[data-category-filter]')) return;
      updateCategoryFilterSummary();
      onChange();
    });
    document.getElementById('clearCategoryFilter').addEventListener('click', () => {
      for (const input of document.querySelectorAll('[data-category-filter]:checked')) {
        input.checked = false;
      }
      updateCategoryFilterSummary();
      onChange();
    });
    document.getElementById('languageFilter').addEventListener('change', () => {
      onChange();
    });
    document.getElementById('artistFilter').addEventListener('change', () => {
      onChange();
    });
    document.getElementById('tagFilterOptions').addEventListener('change', (event) => {
      if (!event.target.matches('[data-tag-filter]')) return;
      updateTagFilterSummary();
      onChange();
    });
    document.getElementById('clearTagFilter').addEventListener('click', () => {
      for (const input of document.querySelectorAll('[data-tag-filter]:checked')) {
        input.checked = false;
      }
      updateTagFilterSummary();
      onChange();
    });
    document.getElementById('enabledFilter').addEventListener('change', () => {
      onChange();
    });
    const filterMenus = document.querySelectorAll('details[name="songLibraryFilter"]');
    bindFilterMenuPopovers(filterMenus);
    document.addEventListener('click', event => closeFilterMenusOnOutsideClick(event, filterMenus));
  }

  function updateOptions(songs, songLanguages, songArtists, songTags) {
    const filtered = Boolean(['songSearch', 'languageFilter', 'artistFilter'].some((id) => value(id))
      || value('enabledFilter') === 'true' || readSelectedCategories().length || readSelectedTags().length);
    if (filtered !== previousFiltered || songLanguages !== previousLanguages || songArtists !== previousArtists
      || songs.length !== previousFields?.length
      || songs.some((song, index) => song.language !== previousFields[index].language || song.artist !== previousFields[index].artist)) {
      if (!filtered) {
        songLanguages.clear();
        songArtists.clear();
      }
      for (const song of songs) {
        for (const language of splitSongLanguages(song.language)) songLanguages.add(language);
        for (const artist of splitSongArtists(song.artist)) songArtists.add(artist);
      }
      previousFields = songs.map(({ language, artist }) => ({ language, artist }));
      previousFiltered = filtered;
      previousLanguages = songLanguages;
      previousArtists = songArtists;
    }
    renderLanguageFilter(songLanguages);
    renderArtistFilter(songArtists);
    renderTagFilter(songTags);
  }

  function renderCategoryFilter(categories) {
    const options = document.getElementById('categoryFilterOptions');
    const selected = new Set(readSelectedCategories());
    const names = splitCategoryNames(categories);
    if (!optionsChanged('categories', names)) return;
    options.innerHTML =
      names.length === 0
        ? '<span class="lira-select-empty">暂无分类</span>'
        : names
            .map(
              (name) => `
        <label class="lira-multiselect-option">
          <input type="checkbox" value="${escapeAttr(name)}" data-category-filter${selected.has(name) ? ' checked' : ''}>
          <span>${escapeHtml(name)}</span>
        </label>
      `,
            )
            .join('');
    updateCategoryFilterSummary();
  }

  function updateCategoryFilterSummary() {
    const selected = readSelectedCategories();
    document.getElementById('categoryFilterSummary').textContent = selected.length ? selected.join('、') : '全部分类';
    document.getElementById('clearCategoryFilter').disabled = selected.length === 0;
  }

  function renderLanguageFilter(songLanguages) {
    if (!optionsChanged('languages', songLanguages)) return;
    const select = document.getElementById('languageFilter');
    const selected = select.value;
    const languages = new Set();
    for (const language of songLanguages) {
      for (const name of splitSongLanguages(language)) languages.add(name);
    }
    const sorted = Array.from(languages).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    select.innerHTML =
      '<option value="">全部语言</option>' +
      sorted.map((lang) => `<option value="${escapeAttr(lang)}">${escapeHtml(lang)}</option>`).join('');
    select.value = selected;
  }

  function splitSongLanguages(value) {
    return String(value || '')
      .split(/\s*(?:\/|／|、|,|，)\s*/)
      .map((language) => language.trim())
      .filter(Boolean);
  }

  function renderArtistFilter(songArtists) {
    if (!optionsChanged('artists', songArtists)) return;
    const select = document.getElementById('artistFilter');
    const selected = select.value;
    const artists = new Set();
    for (const artist of songArtists) {
      for (const name of splitSongArtists(artist)) artists.add(name);
    }
    const sorted = Array.from(artists).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    select.innerHTML =
      '<option value="">全部歌手</option>' +
      sorted.map((artist) => `<option value="${escapeAttr(artist)}">${escapeHtml(artist)}</option>`).join('');
    select.value = selected;
  }

  function splitSongArtists(value) {
    return String(value || '')
      .split(/\s*(?:\/|／|&|＆|、|,|，)\s*/)
      .map((artist) => artist.trim())
      .filter(Boolean);
  }

  function renderTagFilter(songTags) {
    if (!optionsChanged('tags', songTags)) return;
    const options = document.getElementById('tagFilterOptions');
    const selected = new Set(readSelectedTags());
    const sorted = Array.from(songTags).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    options.innerHTML =
      sorted.length === 0
        ? '<span class="lira-select-empty">暂无标签</span>'
        : sorted
            .map(
              (tag) => `
        <label class="lira-multiselect-option">
          <input type="checkbox" value="${escapeAttr(tag)}" data-tag-filter${selected.has(tag) ? ' checked' : ''}>
          <span>${escapeHtml(tag)}</span>
        </label>
      `,
            )
            .join('');
    updateTagFilterSummary();
  }

  function updateTagFilterSummary() {
    const selected = readSelectedTags();
    document.getElementById('tagFilterSummary').textContent = selected.length ? selected.join('、') : '全部标签';
    document.getElementById('clearTagFilter').disabled = selected.length === 0;
  }

  return { init, readSongFilters, updateOptions, renderCategoryFilter, renderLanguageFilter, renderArtistFilter, renderTagFilter };
}
