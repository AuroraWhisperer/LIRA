// 编写人：Aurora
// 歌曲库管理
'use strict';

import {
  closeFilterMenusOnOutsideClick,
  readSelectedCategories,
  readSelectedTags,
  splitCategoryNames
} from './song-category-filter.js';

(function () {
  const {
    escapeHtml,
    escapeAttr,
    value,
    setValue,
    toast,
    showError,
    api,
    debounce,
    dangerConfirm
  } = window.AdminApp.utils;

  function initSongForm() {
    document.getElementById('songForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      await api('/api/songs/save', {
        id: value('songId') || undefined,
        name: value('songName'),
        categoryName: value('songCategory') || '默认',
        artist: value('songArtist'),
        tags: value('songTags'),
        isEnabled: value('songIsEnabled') === 'true',
        language: value('songLanguage'),
        sourcePlatform: value('songSourcePlatform'),
        note: value('songNote')
      });
      resetSongForm();
      toast('歌曲已保存');
      if (window.AdminApp.state && window.AdminApp.state.reloadAll) {
        await window.AdminApp.state.reloadAll();
      }
    });

    document.getElementById('resetSongForm').addEventListener('click', resetSongForm);
    document.getElementById('songSearch').addEventListener('input', debounce(() => {
      if (window.AdminApp.state && window.AdminApp.state.reloadSongs) {
        window.AdminApp.state.reloadSongs();
      }
    }, 180));
    document.getElementById('categoryFilterOptions').addEventListener('change', (event) => {
      if (!event.target.matches('[data-category-filter]')) return;
      updateCategoryFilterSummary();
      if (window.AdminApp.state && window.AdminApp.state.reloadSongs) {
        window.AdminApp.state.reloadSongs();
      }
    });
    document.getElementById('clearCategoryFilter').addEventListener('click', () => {
      for (const input of document.querySelectorAll('[data-category-filter]:checked')) {
        input.checked = false;
      }
      updateCategoryFilterSummary();
      if (window.AdminApp.state && window.AdminApp.state.reloadSongs) {
        window.AdminApp.state.reloadSongs();
      }
    });
    document.getElementById('languageFilter').addEventListener('change', () => {
      if (window.AdminApp.state && window.AdminApp.state.reloadSongs) {
        window.AdminApp.state.reloadSongs();
      }
    });
    document.getElementById('artistFilter').addEventListener('change', () => {
      if (window.AdminApp.state && window.AdminApp.state.reloadSongs) {
        window.AdminApp.state.reloadSongs();
      }
    });
    document.getElementById('tagFilterOptions').addEventListener('change', (event) => {
      if (!event.target.matches('[data-tag-filter]')) return;
      updateTagFilterSummary();
      if (window.AdminApp.state && window.AdminApp.state.reloadSongs) {
        window.AdminApp.state.reloadSongs();
      }
    });
    document.getElementById('clearTagFilter').addEventListener('click', () => {
      for (const input of document.querySelectorAll('[data-tag-filter]:checked')) {
        input.checked = false;
      }
      updateTagFilterSummary();
      if (window.AdminApp.state && window.AdminApp.state.reloadSongs) {
        window.AdminApp.state.reloadSongs();
      }
    });
    document.getElementById('enabledFilter').addEventListener('change', () => {
      if (window.AdminApp.state && window.AdminApp.state.reloadSongs) {
        window.AdminApp.state.reloadSongs();
      }
    });
    const filterMenus = document.querySelectorAll('details[name="songLibraryFilter"]');
    document.addEventListener('click', (event) => {
      closeFilterMenusOnOutsideClick(event, filterMenus);
      if (!event.target.closest('.song-actions-menu')) closeSongActionsMenus();
    });
    document.addEventListener('scroll', closeSongActionsMenus, true);
    window.addEventListener('resize', closeSongActionsMenus);
    document.addEventListener('keydown', (event) => {
      const menu = event.target.closest('.song-actions-list');
      if (!menu) return;
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
      const currentIndex = items.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const nextIndex = event.key === 'Home' ? 0
          : event.key === 'End' ? items.length - 1
            : event.key === 'ArrowUp' ? Math.max(0, currentIndex - 1)
              : Math.min(items.length - 1, currentIndex + 1);
        items[nextIndex]?.focus();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeSongActionsMenu(menu, true);
      }
    });
  }

  function closeSongActionsMenu(menu, restoreFocus = false) {
    if (!menu) return;
    if (typeof menu.hidePopover === 'function' && menu.matches(':popover-open')) {
      menu.hidePopover();
    }
    menu.hidden = true;
    menu.classList.remove('opens-upward');
    menu.style.removeProperty('top');
    menu.style.removeProperty('left');
    const trigger = menu.closest('.song-actions-menu')?.querySelector('[data-song-actions-toggle]');
    trigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger?.focus();
  }

  function closeSongActionsMenus(except = null) {
    document.querySelectorAll('.song-actions-list:not([hidden])').forEach((menu) => {
      if (menu !== except) closeSongActionsMenu(menu);
    });
  }

  function closeSongActionsFor(button) {
    const menu = button.closest?.('.song-actions-menu')?.querySelector('.song-actions-list');
    closeSongActionsMenu(menu);
  }

  function toggleSongActions(button) {
    const menu = document.getElementById(button.getAttribute('aria-controls'));
    if (!menu) return;
    const shouldOpen = menu.hidden;
    closeSongActionsMenus(menu);
    if (!shouldOpen) {
      closeSongActionsMenu(menu, true);
      return;
    }

    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const wrapperRect = button.closest('.song-actions-menu').getBoundingClientRect();
    if (typeof menu.showPopover === 'function') {
      menu.showPopover();
      const gap = 6;
      const viewportPadding = 8;
      const menuRect = menu.getBoundingClientRect();
      const spaceAbove = wrapperRect.top - viewportPadding - gap;
      const spaceBelow = window.innerHeight - wrapperRect.bottom - viewportPadding - gap;
      const opensUpward = spaceBelow < menuRect.height && spaceAbove > spaceBelow;
      const preferredTop = opensUpward
        ? wrapperRect.top - gap - menuRect.height
        : wrapperRect.bottom + gap;
      const maxTop = Math.max(viewportPadding, window.innerHeight - viewportPadding - menuRect.height);
      const maxLeft = Math.max(viewportPadding, window.innerWidth - viewportPadding - menuRect.width);
      menu.style.top = `${Math.min(Math.max(preferredTop, viewportPadding), maxTop)}px`;
      menu.style.left = `${Math.min(Math.max(wrapperRect.right - menuRect.width, viewportPadding), maxLeft)}px`;
      menu.querySelector('[role="menuitem"]')?.focus();
      return;
    }

    const tableRect = button.closest('.table-wrap')?.getBoundingClientRect();
    const boundaryTop = Math.max(tableRect?.top ?? 0, 0);
    const boundaryBottom = Math.min(tableRect?.bottom ?? window.innerHeight, window.innerHeight);
    const spaceAbove = wrapperRect.top - boundaryTop;
    const spaceBelow = boundaryBottom - wrapperRect.bottom;
    menu.classList.toggle('opens-upward', spaceBelow < menu.offsetHeight + 6 && spaceAbove > spaceBelow);
    menu.querySelector('[role="menuitem"]')?.focus();
  }

  function resetSongForm() {
    setValue('songId', '');
    setValue('songName', '');
    setValue('songArtist', '');
    setValue('songCategory', '默认');
    setValue('songTags', '');
    setValue('songIsEnabled', 'true');
    setValue('songLanguage', '');
    setValue('songSourcePlatform', '');
    setValue('songNote', '');
  }

  function renderSongs(songs, songLanguages, songArtists, songTags) {
    songLanguages.clear();
    songArtists.clear();
    for (const song of songs) {
      for (const language of splitSongLanguages(song.language)) songLanguages.add(language);
      for (const artist of splitSongArtists(song.artist)) songArtists.add(artist);
    }
    renderLanguageFilter(songLanguages);
    renderArtistFilter(songArtists);
    renderTagFilter(songTags);

    const table = document.getElementById('songsTable');
    const showNoteColumn = songs.some((song) => String(song.note || '').trim());
    document.getElementById('songNoteColumnHeader').hidden = !showNoteColumn;
    if (songs.length === 0) {
      table.innerHTML = '<tr><td colspan="8">暂无歌曲</td></tr>';
      return;
    }
    table.innerHTML = songs.map((song) => `
      <tr>
        <td>${escapeHtml(song.name_initial || '#')}</td>
        <td><strong>${escapeHtml(song.name)}</strong></td>
        <td>${escapeHtml(song.artist || '')}</td>
        <td>${escapeHtml(song.category_name || '默认')}</td>
        <td>${escapeHtml(song.tags || '')}</td>
        <td>${escapeHtml(song.language || '')}</td>
        <td>${song.is_enabled ? '可点' : '停用'}</td>
        ${showNoteColumn ? `<td>${escapeHtml(song.note || '')}</td>` : ''}
        <td class="song-actions-cell">
          <div class="song-actions-menu">
            <button class="song-actions-trigger" type="button" data-song-actions-toggle="${song.id}" title="更多操作" aria-label="展开歌曲操作" aria-haspopup="menu" aria-expanded="false" aria-controls="song-actions-${song.id}">…</button>
            <div id="song-actions-${song.id}" class="song-actions-list" role="menu" aria-label="歌曲操作" popover="manual" hidden>
              <button type="button" role="menuitem" data-edit-song="${song.id}" title="加载到编辑表单">编辑</button>
              <button type="button" role="menuitem" data-add-song="${song.id}" title="以主播身份加入点歌队列">入队</button>
              <button class="danger" type="button" role="menuitem" data-delete-song="${song.id}" title="从歌库中移除该歌曲">删除</button>
            </div>
          </div>
        </td>
      </tr>
    `).join('');

    document.querySelectorAll('[data-song-actions-toggle]').forEach((button) => {
      button.addEventListener('click', () => toggleSongActions(button));
    });

    document.querySelectorAll('[data-edit-song]').forEach((button) => {
      button.addEventListener('click', () => {
        closeSongActionsFor(button);
        const song = songs.find((item) => String(item.id) === button.dataset.editSong);
        if (!song) return;
        setValue('songId', song.id);
        setValue('songName', song.name);
        setValue('songArtist', song.artist || '');
        setValue('songCategory', song.category_name || '默认');
        setValue('songTags', song.tags || '');
        setValue('songIsEnabled', song.is_enabled ? 'true' : 'false');
        setValue('songLanguage', song.language || '');
        setValue('songSourcePlatform', song.source_platform || '');
        setValue('songNote', song.note || '');
        toast('已加载到编辑表单');
      });
    });

    document.querySelectorAll('[data-add-song]').forEach((button) => {
      button.addEventListener('click', async () => {
        closeSongActionsFor(button);
        const song = songs.find((item) => String(item.id) === button.dataset.addSong);
        if (!song) return;
        await api('/api/queue/add', {
          songName: song.name,
          artist: song.artist,
          categoryName: song.category_name,
          requesterName: '主播',
          source: 'admin'
        });
        toast('已从歌库入队');
        if (window.AdminApp.state && window.AdminApp.state.reloadState) {
          await window.AdminApp.state.reloadState();
        }
      });
    });

    document.querySelectorAll('[data-delete-song]').forEach((button) => {
      button.addEventListener('click', async () => {
        closeSongActionsFor(button);
        const confirmed = await dangerConfirm({
          title: '删除歌曲',
          message: '确认从歌库中删除这首歌？',
          deletes: ['歌曲及其歌库信息'],
          confirmLabel: '确认删除'
        });
        if (!confirmed) return;
        await api('/api/songs/delete', { id: button.dataset.deleteSong });
        toast('歌曲已删除');
        if (window.AdminApp.state && window.AdminApp.state.reloadAll) {
          await window.AdminApp.state.reloadAll();
        }
      });
    });
  }

  function renderCategoryFilter(categories) {
    const options = document.getElementById('categoryFilterOptions');
    const selected = new Set(readSelectedCategories());
    const names = splitCategoryNames(categories);
    options.innerHTML = names.length === 0
      ? '<span class="category-filter-empty">暂无分类</span>'
      : names.map((name) => `
        <label class="category-filter-option">
          <input type="checkbox" value="${escapeAttr(name)}" data-category-filter${selected.has(name) ? ' checked' : ''}>
          <span>${escapeHtml(name)}</span>
        </label>
      `).join('');
    updateCategoryFilterSummary();
  }

  function updateCategoryFilterSummary() {
    const selected = readSelectedCategories();
    document.getElementById('categoryFilterSummary').textContent = selected.length
      ? selected.join(' + ')
      : '全部分类';
    document.getElementById('clearCategoryFilter').disabled = selected.length === 0;
  }

  function renderLanguageFilter(songLanguages) {
    const select = document.getElementById('languageFilter');
    const selected = select.value;
    const languages = new Set();
    for (const language of songLanguages) {
      for (const name of splitSongLanguages(language)) languages.add(name);
    }
    const sorted = Array.from(languages).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    select.innerHTML = '<option value="">全部语言</option>' + sorted.map((lang) => (
      `<option value="${escapeAttr(lang)}">${escapeHtml(lang)}</option>`
    )).join('');
    select.value = selected;
  }

  function splitSongLanguages(value) {
    return String(value || '')
      .split(/\s*(?:\/|／|、|,|，)\s*/)
      .map((language) => language.trim())
      .filter(Boolean);
  }

  function renderArtistFilter(songArtists) {
    const select = document.getElementById('artistFilter');
    const selected = select.value;
    const artists = new Set();
    for (const artist of songArtists) {
      for (const name of splitSongArtists(artist)) artists.add(name);
    }
    const sorted = Array.from(artists).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    select.innerHTML = '<option value="">全部歌手</option>' + sorted.map((artist) => (
      `<option value="${escapeAttr(artist)}">${escapeHtml(artist)}</option>`
    )).join('');
    select.value = selected;
  }

  function splitSongArtists(value) {
    return String(value || '')
      .split(/\s*(?:\/|／|&|＆|、|,|，)\s*/)
      .map((artist) => artist.trim())
      .filter(Boolean);
  }

  function renderTagFilter(songTags) {
    const options = document.getElementById('tagFilterOptions');
    const selected = new Set(readSelectedTags());
    const sorted = Array.from(songTags).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    options.innerHTML = sorted.length === 0
      ? '<span class="category-filter-empty">暂无标签</span>'
      : sorted.map((tag) => `
        <label class="category-filter-option">
          <input type="checkbox" value="${escapeAttr(tag)}" data-tag-filter${selected.has(tag) ? ' checked' : ''}>
          <span>${escapeHtml(tag)}</span>
        </label>
      `).join('');
    updateTagFilterSummary();
  }

  function updateTagFilterSummary() {
    const selected = readSelectedTags();
    document.getElementById('tagFilterSummary').textContent = selected.length
      ? selected.join(' + ')
      : '全部标签';
    document.getElementById('clearTagFilter').disabled = selected.length === 0;
  }

  window.AdminApp = window.AdminApp || {};
  window.AdminApp.songs = {
    initSongForm,
    resetSongForm,
    renderSongs,
    renderCategoryFilter,
    renderLanguageFilter,
    renderArtistFilter,
    renderTagFilter
  };
})();
