const PREVIEW_PROFILE = Object.freeze({
  roomId: '100',
  uid: '10001',
  name: '合成房主',
  avatarUrl: '/img/overlays/danmaku-ranked/viewer.webp',
});

// The header has its own request lifetime; it never owns or delays message playback.
export function createTwitterRoomProfile({ document, resolveAvatarUrl = (value) => value, loadProfile }) {
  const avatar = document.getElementById('twitterProfileAvatar');
  const fallback = document.getElementById('twitterProfileAvatarFallback');
  const name = document.getElementById('twitterProfileName');
  const uid = document.getElementById('twitterProfileUid');
  let generation = 0;
  let avatarGeneration = 0;
  let key = '';
  let controller = null;
  let disposed = false;

  function showPreview() {
    if (disposed || key === 'preview') return;
    invalidate();
    key = 'preview';
    render(PREVIEW_PROFILE);
  }

  function update(style, expectedRoomId) {
    if (disposed) return;
    if (style !== 'twitter') {
      if (key) clear();
      return;
    }
    const roomId = String(expectedRoomId || '').trim();
    const nextKey = `room:${roomId}`;
    if (key === nextKey) return;
    invalidate();
    key = nextKey;
    if (!roomId || typeof loadProfile !== 'function') {
      render(null, '等待当前房间');
      return;
    }
    const activeGeneration = generation;
    controller = typeof AbortController === 'function' ? new AbortController() : null;
    render(null, '正在读取');
    Promise.resolve(loadProfile({ signal: controller?.signal })).then((profile) => {
      if (disposed || activeGeneration !== generation || key !== nextKey) return;
      if (String(profile?.roomId || '').trim() !== roomId) {
        render(null, '等待当前房间');
        return;
      }
      render(profile);
    }).catch(() => {
      if (!disposed && activeGeneration === generation && key === nextKey) render(null, '读取失败');
    });
  }

  function clear() {
    invalidate();
    key = '';
    render(null, '等待当前房间');
  }

  function invalidate() {
    generation += 1;
    controller?.abort();
    controller = null;
  }

  function render(profile, pendingText = '') {
    const displayName = String(profile?.name || '').trim() || '当前房主';
    const displayUid = String(profile?.uid || '').trim();
    name.textContent = displayName;
    uid.textContent = displayUid ? `@UID ${displayUid}` : `@UID ${pendingText || '等待读取'}`;
    fallback.textContent = Array.from(displayName)[0] || '房';
    renderAvatar(profile?.avatarUrl, displayName);
  }

  function renderAvatar(value) {
    const activeGeneration = ++avatarGeneration;
    let source = '';
    try { source = String(resolveAvatarUrl(value) || ''); } catch { source = ''; }
    avatar.hidden = true;
    fallback.hidden = false;
    avatar.onload = () => {
      if (activeGeneration !== avatarGeneration) return;
      fallback.hidden = true;
      avatar.hidden = false;
    };
    avatar.onerror = () => {
      if (activeGeneration !== avatarGeneration) return;
      avatar.hidden = true;
      fallback.hidden = false;
    };
    if (source) avatar.src = source;
    else avatar.removeAttribute('src');
  }

  function dispose() {
    disposed = true;
    invalidate();
  }

  return { showPreview, update, clear, dispose };
}
