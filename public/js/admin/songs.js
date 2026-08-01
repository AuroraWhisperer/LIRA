// 编写人：Aurora
// 歌曲库管理
'use strict';

(function () {
  const {
    escapeHtml,
    escapeAttr,
    value,
    setValue,
    toast,
    showError,
    api,
    debounce
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
    document.getElementById('categoryFilter').addEventListener('change', () => {
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
    document.getElementById('tagFilter').addEventListener('change', () => {
      if (window.AdminApp.state && window.AdminApp.state.reloadSongs) {
        window.AdminApp.state.reloadSongs();
      }
    });
    document.getElementById('enabledFilter').addEventListener('change', () => {
      if (window.AdminApp.state && window.AdminApp.state.reloadSongs) {
        window.AdminApp.state.reloadSongs();
      }
    });
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
    songTags.clear();
    for (const song of songs) {
      if (song.language) songLanguages.add(song.language);
      if (song.artist) songArtists.add(song.artist);
      if (song.tags) {
        song.tags.split(',').forEach(function(tag) {
          var trimmed = tag.trim();
          if (trimmed) songTags.add(trimmed);
        });
      }
    }
    renderLanguageFilter(songLanguages);
    renderArtistFilter(songArtists);
    renderTagFilter(songTags);

    const table = document.getElementById('songsTable');
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
        <td>${song.is_enabled ? '可点' : '停用'}</td>
        <td>${escapeHtml(song.note || '')}</td>
        <td>
          <div class="actions">
            <button type="button" data-edit-song="${song.id}" title="加载到编辑表单">编辑</button>
            <button type="button" data-add-song="${song.id}" title="以主播身份加入点歌队列">入队</button>
            <button class="danger" type="button" data-delete-song="${song.id}" title="从歌库中移除该歌曲">删除</button>
          </div>
        </td>
      </tr>
    `).join('');

    document.querySelectorAll('[data-edit-song]').forEach((button) => {
      button.addEventListener('click', () => {
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
        if (!confirm('确认删除这首歌？')) return;
        await api('/api/songs/delete', { id: button.dataset.deleteSong });
        toast('歌曲已删除');
        if (window.AdminApp.state && window.AdminApp.state.reloadAll) {
          await window.AdminApp.state.reloadAll();
        }
      });
    });
  }

  function renderCategoryFilter(categories) {
    const select = document.getElementById('categoryFilter');
    const selected = select.value;
    select.innerHTML = '<option value="">全部分类</option>' + categories.map((category) => (
      `<option value="${escapeAttr(category.name)}">${escapeHtml(category.name)}</option>`
    )).join('');
    select.value = selected;
  }

  function renderLanguageFilter(songLanguages) {
    const select = document.getElementById('languageFilter');
    const selected = select.value;
    const sorted = Array.from(songLanguages).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    select.innerHTML = '<option value="">全部语言</option>' + sorted.map((lang) => (
      `<option value="${escapeAttr(lang)}">${escapeHtml(lang)}</option>`
    )).join('');
    select.value = selected;
  }

  function renderArtistFilter(songArtists) {
    const select = document.getElementById('artistFilter');
    const selected = select.value;
    const sorted = Array.from(songArtists).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    select.innerHTML = '<option value="">全部歌手</option>' + sorted.map((artist) => (
      `<option value="${escapeAttr(artist)}">${escapeHtml(artist)}</option>`
    )).join('');
    select.value = selected;
  }

  function renderTagFilter(songTags) {
    const select = document.getElementById('tagFilter');
    const selected = select.value;
    const sorted = Array.from(songTags).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    select.innerHTML = '<option value="">全部标签</option>' + sorted.map((tag) => (
      `<option value="${escapeAttr(tag)}">${escapeHtml(tag)}</option>`
    )).join('');
    select.value = selected;
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
