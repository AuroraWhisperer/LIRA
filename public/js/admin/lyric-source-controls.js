'use strict';

const SOURCE_LABELS = {
  internal: '内置播放器',
  'qq-client': '外部 QQ 音乐',
  'netease-client': '外部网易云音乐',
  wesing: '全民 K 歌',
};

export function createLyricSourceControls({ api, state }) {
  let initialized = false;
  let current = null;
  let saving = false;
  let received = 0;
  let requestVersion = 0;
  let requestError = '';
  let externalSelection = 'auto';

  function init() {
    const root = document.getElementById('desktopLyricSourceControls');
    if (!root || initialized) return;
    initialized = true;
    const status = document.getElementById('desktopLyricSourceStatus');
    const track = document.getElementById('desktopLyricSourceTrack');
    const externalControls = document.getElementById('desktopLyricExternalControls');
    const weSingSettings = document.getElementById('desktopLyricWeSingSettings');
    const clients = [
      { source: 'qq-client', key: 'qqClient', label: 'QQ 音乐',
        status: document.getElementById('desktopLyricQQStatus'), retry: document.getElementById('desktopLyricSourceRetry') },
      { source: 'netease-client', key: 'neteaseClient', label: '网易云音乐',
        status: document.getElementById('desktopLyricNetEaseStatus'), retry: document.getElementById('desktopLyricNetEaseRetry') },
    ];

    function render() {
      root.disabled = saving || !current;
      const group = current && (['internal', 'wesing'].includes(current.selection) ? current.selection : 'external');
      if (group === 'external') externalSelection = current.selection;
      root.querySelectorAll('input[name="desktopLyricSourceGroup"]').forEach((input) => {
        input.checked = input.value === group;
      });
      externalControls.hidden = group !== 'external';
      weSingSettings.hidden = group !== 'wesing';
      root.querySelectorAll('input[name="desktopLyricSource"]').forEach((input) => {
        input.checked = input.value === externalSelection;
        const client = clients.find((item) => item.source === input.value);
        input.disabled = !!client && current?.[client.key]?.supported === false;
      });
      status.textContent = requestError || (current
        ? `当前跟随：${SOURCE_LABELS[current.source]}` : '正在读取歌词来源…');
      const followedClient = clients.find((client) => client.source === current?.source);
      const followed = followedClient && current[followedClient.key];
      track.textContent = followed?.trackTitle
        ? [followed.trackTitle, followed.artists?.join(' / '), followed.lyricSource ? `歌词：${followedClient.label}` : ''].filter(Boolean).join(' · ') : '';
      track.hidden = !track.textContent;
      for (const client of clients) {
        const detail = current?.[client.key];
        client.status.textContent = `${client.label}：${detail?.message || '正在读取检测状态…'}`;
        client.retry.disabled = detail?.supported === false;
      }
    }

    async function request(path, body) {
      const version = received;
      const operation = ++requestVersion;
      saving = true;
      requestError = '';
      render();
      try {
        const result = await api(path, body, { notifyError: false });
        if (operation === requestVersion && version === received) {
          current = result.data;
          window.dispatchEvent(new CustomEvent('app:lyric-source', { detail: current }));
        }
      } catch (error) {
        if (operation === requestVersion && version === received) {
          requestError = error.message || '更新歌词跟随设置失败，请重试';
        }
      } finally {
        if (operation === requestVersion) {
          saving = false;
          render();
        }
      }
    }

    root.addEventListener('input', (event) => {
      if (['desktopLyricSourceGroup', 'desktopLyricSource'].includes(event.target.name)) event.stopPropagation();
    });
    root.addEventListener('change', (event) => {
      const { name, value, checked } = event.target;
      if (!['desktopLyricSourceGroup', 'desktopLyricSource'].includes(name)) return;
      event.stopPropagation();
      if (!checked) return;
      if (name === 'desktopLyricSourceGroup') {
        void request('/api/playback/lyric-source', { source: value === 'external' ? externalSelection : value });
      } else if (name === 'desktopLyricSource') {
        void request('/api/playback/lyric-source', { source: value });
      }
    });
    for (const client of clients) {
      client.retry.addEventListener('click', () => {
        void request('/api/playback/lyric-source/refresh', { source: client.source });
      });
    }
    window.addEventListener('app:lyric-source', (event) => {
      if (!event.detail) return;
      received++;
      current = event.detail;
      requestError = '';
      render();
    });
    current = state.getAppState()?.lyricSource || null;
    render();
  }

  return { init };
}
