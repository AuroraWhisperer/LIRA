import { showConfirmationDialog } from '../shared/confirmation-dialog.js';

export function createSongEditor({ value, setValue, api, toast, onSaved }) {
  let savedForm = null;
  let formVersion = 0;
  let saving = false;
  // 上一次完整歌库的 ID；新保存、尚未出现在列表里的歌曲不会被当成已删除。
  let completeSongIds = null;

  function readSongForm() {
    return JSON.stringify([
      'songId', 'songName', 'songArtist', 'songCategory', 'songTags', 'songIsEnabled',
      'songLanguage', 'songRequestPrice', 'songClip', 'songSourcePlatform', 'songNote',
    ].map((id) => document.getElementById(id)?.value || ''));
  }

  async function confirmDiscard() {
    if (savedForm === null || readSongForm() === savedForm) return true;
    return showConfirmationDialog({
      variant: 'caution',
      title: '放弃未保存的歌曲修改？',
      description: '当前表单中尚未保存的内容将会丢失。',
      confirmLabel: '放弃修改',
      cancelLabel: '继续编辑',
      initialFocus: 'cancel',
    });
  }

  function init() {
    savedForm = readSongForm();
    renderSongEditMode();
    document.getElementById('songRequestPrice').addEventListener('input', () => {
      setValue('songPricePreset', '');
      updateSongPricePreview();
    });
    document.getElementById('songPricePreset').addEventListener('change', () => {
      const preset = value('songPricePreset');
      if (!preset) return;
      setValue('songRequestPrice', preset);
      updateSongPricePreview();
      document.getElementById('songRequestPrice').focus();
    });
    document.getElementById('songForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      updateSongPricePreview();
      if (!document.getElementById('songRequestPrice').reportValidity()) return;
      const submittedForm = readSongForm();
      const submittedVersion = formVersion;
      const submitButton = document.querySelector('#songForm button[type="submit"]');
      saving = true;
      submitButton.disabled = true;
      try {
        const result = await api('/api/songs/save', {
          id: value('songId') || undefined,
          name: value('songName'),
          categoryName: value('songCategory') || '默认',
          artist: value('songArtist'),
          tags: value('songTags'),
          isEnabled: value('songIsEnabled') === 'true',
          language: value('songLanguage'),
          requestPrice: value('songRequestPrice'),
          songClip: value('songClip'),
          sourcePlatform: value('songSourcePlatform'),
          note: value('songNote'),
        });
        if (submittedVersion === formVersion) {
          if (readSongForm() === submittedForm) {
            resetSongForm();
          } else {
            const savedValues = JSON.parse(submittedForm);
            savedValues[0] = String(result.data.id);
            setValue('songId', savedValues[0]);
            savedForm = JSON.stringify(savedValues);
            renderSongEditMode(savedValues[1]);
          }
        }
        toast('歌曲已保存到本地', { type: 'success' });
        await onSaved();
      } finally {
        saving = false;
        submitButton.disabled = false;
      }
    });

    document.getElementById('resetSongForm').addEventListener('click', async () => {
      if (await confirmDiscard()) resetSongForm();
    });
  }

  function updateSongPricePreview() {
    const input = document.getElementById('songRequestPrice');
    const length = input.value.length;
    const error = length > 1000 ? '点歌价格过长，请缩短后保存（上限 1000）。' : '';
    input.setCustomValidity(error);
    document.getElementById('songPriceLength').textContent = `${length} / 1000${error ? ' · 超出长度，请修正' : ''}`;
    document.getElementById('songPricePreview').textContent = input.value.trim();
  }

  function resetSongForm() {
    formVersion += 1;
    setValue('songId', '');
    setValue('songName', '');
    setValue('songArtist', '');
    setValue('songCategory', '默认');
    setValue('songTags', '');
    setValue('songIsEnabled', 'true');
    setValue('songLanguage', '');
    setValue('songRequestPrice', '');
    setValue('songClip', '');
    setValue('songPricePreset', '');
    updateSongPricePreview();
    setValue('songSourcePlatform', '');
    setValue('songNote', '');
    savedForm = readSongForm();
    renderSongEditMode();
  }

  function renderSongEditMode(name = value('songName')) {
    const editing = Boolean(value('songId'));
    const heading = document.getElementById('songFormTitle');
    if (heading) {
      heading.hidden = !editing;
      heading.textContent = editing ? `正在编辑《${name}》` : '';
    }
    document.getElementById('resetSongForm').textContent = editing ? '取消编辑' : '清空表单';
  }

  async function edit(song) {
    if (String(song.id) === value('songId')) {
      document.getElementById('songName')?.focus();
      return;
    }
    if (!(await confirmDiscard())) {
      document.getElementById('songName')?.focus();
      return;
    }
    formVersion += 1;
    setValue('songId', song.id);
    setValue('songName', song.name);
    setValue('songArtist', song.artist || '');
    setValue('songCategory', song.category_name || '默认');
    setValue('songTags', song.tags || '');
    setValue('songIsEnabled', song.is_enabled ? 'true' : 'false');
    setValue('songLanguage', song.language || '');
    setValue('songRequestPrice', song.request_price ?? '');
    setValue('songClip', song.song_clip ?? '');
    setValue('songPricePreset', '');
    updateSongPricePreview();
    setValue('songSourcePlatform', song.source_platform || '');
    setValue('songNote', song.note || '');
    savedForm = readSongForm();
    renderSongEditMode(song.name);
    document.getElementById('songName')?.focus();
  }

  function reconcileSongs(songs, { complete }) {
    if (complete) {
      const ids = new Set(songs.map((song) => String(song.id)));
      const editingId = value('songId');
      // 清空或替换歌库后，正在编辑的歌曲已不存在时回到添加状态。
      if (editingId && completeSongIds?.has(editingId) && !ids.has(editingId)) resetSongForm();
      completeSongIds = ids;
    }
  }

  function handleSongDeleted(id) {
    if (value('songId') === String(id)) resetSongForm();
  }

  return { init, edit, handleSongDeleted, reconcileSongs, reset: resetSongForm };
}
