import { value, setValue, toast, api, debounce, dangerConfirm } from '../shared/utils.js';
import { escapeHtml, escapeAttr } from '../shared/html-escape.js';
import { stateService } from './state.js';
// 编写人：Aurora
// 歌曲库管理
('use strict');

import { createSongEditor } from './song-editor.js';
import { createSongLibraryFilters } from './song-library-filters.js';

const songUtils = { escapeHtml, escapeAttr, value, setValue, toast, api, debounce, dangerConfirm };

export function createSongs({ state = stateService, utils = songUtils } = {}) {
  const { escapeHtml, escapeAttr, value, setValue, toast, api, debounce, dangerConfirm } = utils;
  const editor = createSongEditor({ value, setValue, api, toast, onSaved: () => state.reloadAll() });
  const filters = createSongLibraryFilters({ value, escapeHtml, escapeAttr, debounce, onChange: () => state.reloadSongs() });
  let initialized = false;
  let songTableBound = false;
  let pendingSongs = null;
  let renderedMarkup;
  // 行内操作按最近一次渲染的歌库快照解析目标，与逐行绑定时的闭包一致。
  let renderedSongs = [];

  function initSongForm() {
    if (initialized) return;
    initialized = true;
    editor.init();
    filters.init();
    const visibility = new MutationObserver(renderPendingSongs);
    visibility.observe(document.getElementById('songsPage'), { attributes: true, attributeFilter: ['class', 'hidden'] });
    const workspace = document.getElementById('songAssistantPage');
    if (workspace) visibility.observe(workspace, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('visibilitychange', renderPendingSongs);
    window.addEventListener('pagehide', () => {
      visibility.disconnect();
      document.removeEventListener('visibilitychange', renderPendingSongs);
    }, { once: true });
    document.addEventListener('click', (event) => {
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
        const nextIndex =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : event.key === 'ArrowUp'
                ? Math.max(0, currentIndex - 1)
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
      const preferredTop = opensUpward ? wrapperRect.top - gap - menuRect.height : wrapperRect.bottom + gap;
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

  function renderSongs(songs, songLanguages, songArtists, songTags, { complete = false } = {}) {
    editor.reconcileSongs(songs, { complete });
    pendingSongs = { songs, songLanguages, songArtists, songTags };
    renderPendingSongs();
  }

  function renderPendingSongs() {
    const page = document.getElementById('songsPage');
    const workspace = document.getElementById('songAssistantPage');
    if (document.hidden || page.hidden || !page.classList.contains('active')
      || workspace && !workspace.classList.contains('active')) return;
    if (!pendingSongs) return;
    const { songs, songLanguages, songArtists, songTags } = pendingSongs;
    pendingSongs = null;
    renderedSongs = songs;
    bindSongTableActions();
    filters.updateOptions(songs, songLanguages, songArtists, songTags);
    const table = document.getElementById('songsTable');
    const visibleColumns = new Set(
      ['request_price', 'note']
        .filter((field) => songs.some((song) => String(song[field] ?? '').trim())),
    );
    for (const header of document.querySelectorAll('#songsPage th[data-song-column]')) {
      header.hidden = !visibleColumns.has(header.dataset.songColumn);
    }
    let markup;
    if (songs.length === 0) {
      const currentFilters = filters.readSongFilters();
      const filtered = currentFilters.query || currentFilters.categories.length || currentFilters.language || currentFilters.artist || currentFilters.tags.length || currentFilters.enabledOnly;
      markup = filtered
        ? '<tr><td colspan="8">没有符合筛选条件的歌曲，请调整或清除筛选。</td></tr>'
        : '<tr><td colspan="8">歌库还没有歌曲。可在上方添加，或到“歌单导入导出”批量导入。</td></tr>';
    } else markup = songs
      .map(
        (song) => `
      <tr>
        <td>${escapeHtml(song.name_initial || '#')}</td>
        <td><strong>${escapeHtml(song.name)}</strong>${song.song_clip ? `<details><summary>歌切</summary><span style="white-space: pre-wrap; overflow-wrap: anywhere">${escapeHtml(song.song_clip)}</span></details>` : ''}</td>
        <td>${escapeHtml(song.artist || '')}</td>
        <td>${escapeHtml(song.category_name || '默认')}</td>
        <td>${escapeHtml(song.tags || '')}</td>
        <td>${escapeHtml(song.language || '')}</td>
        <td>${song.is_enabled ? '可点' : '停用'}</td>
        ${visibleColumns.has('request_price') ? `<td style="white-space: pre-wrap; overflow-wrap: anywhere; max-width: 240px">${escapeHtml(song.request_price ?? '')}</td>` : ''}
        ${visibleColumns.has('note') ? `<td>${escapeHtml(song.note || '')}</td>` : ''}
        <td class="song-actions-cell">
          <div class="song-actions-menu">
            <button class="song-actions-trigger" type="button" data-song-actions-toggle="${song.id}" title="更多操作" aria-label="更多歌曲操作" aria-haspopup="menu" aria-expanded="false" aria-controls="song-actions-${song.id}">
              <span>更多</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                <path d="m3 4.5 3 3 3-3" />
              </svg>
            </button>
            <div id="song-actions-${song.id}" class="song-actions-list" role="menu" aria-label="歌曲操作" popover="manual" hidden>
              <button type="button" role="menuitem" data-edit-song="${song.id}" title="加载到编辑表单">编辑</button>
              <button type="button" role="menuitem" data-add-song="${song.id}" title="以主播身份加入点歌队列">加入点歌队列</button>
              <button class="danger" type="button" role="menuitem" data-delete-song="${song.id}" title="从歌库中移除该歌曲">删除</button>
            </div>
          </div>
        </td>
      </tr>
    `,
      )
      .join('');
    if (markup !== renderedMarkup) {
      closeSongActionsMenus();
      table.innerHTML = markup;
      renderedMarkup = markup;
    }
  }

  // 行内操作统一由表格接收点击，避免每次重画后逐行重新绑定。
  function bindSongTableActions() {
    const table = document.getElementById('songsTable');
    if (!table || songTableBound) return;
    songTableBound = true;
    table.addEventListener('click', (event) => {
      const trigger = event.target.closest?.('[data-song-actions-toggle]');
      if (trigger) {
        toggleSongActions(trigger);
        return;
      }
      const editButton = event.target.closest?.('[data-edit-song]');
      if (editButton) {
        closeSongActionsFor(editButton);
        const song = renderedSongs.find((item) => String(item.id) === editButton.dataset.editSong);
        if (song) void editor.edit(song);
        return;
      }
      const addButton = event.target.closest?.('[data-add-song]');
      if (addButton) {
        void addSongToQueue(addButton);
        return;
      }
      const deleteButton = event.target.closest?.('[data-delete-song]');
      if (deleteButton) void deleteSongFromLibrary(deleteButton);
    });
  }

  async function addSongToQueue(button) {
    closeSongActionsFor(button);
    const song = renderedSongs.find((item) => String(item.id) === button.dataset.addSong);
    if (!song) return;
    await api('/api/queue/add', {
      songName: song.name,
      artist: song.artist,
      categoryName: song.category_name,
      requesterName: '主播',
      source: 'admin',
    });
    toast('已从歌库入队');
    await state.reloadState();
  }

  async function deleteSongFromLibrary(button) {
    closeSongActionsFor(button);
    const confirmed = await dangerConfirm({
      title: '删除歌曲',
      message: '确认从歌库中删除这首歌？',
      deletes: ['歌曲及其歌库信息'],
      confirmLabel: '确认删除',
    });
    if (!confirmed) return;
    await api('/api/songs/delete', { id: button.dataset.deleteSong });
    editor.handleSongDeleted(button.dataset.deleteSong);
    toast('歌曲已删除');
    await state.reloadAll();
  }

  return {
    initSongForm,
    readSongFilters: filters.readSongFilters,
    resetSongForm: editor.reset,
    renderSongs,
    renderCategoryFilter: filters.renderCategoryFilter,
    renderLanguageFilter: filters.renderLanguageFilter,
    renderArtistFilter: filters.renderArtistFilter,
    renderTagFilter: filters.renderTagFilter,
  };
}

export const songs = createSongs();
