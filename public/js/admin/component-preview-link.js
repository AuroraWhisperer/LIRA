import { SHARED_SCENE_TYPES } from '../shared/scene-components.js';

function wait(delay, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => { window.clearTimeout(timer); reject(signal.reason); };
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, delay);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}

async function resolveLink(key, signal) {
  let delay = 1000;
  while (!signal.aborted) {
    try {
      const response = await fetch('/api/component-preview', { method: 'POST', credentials: 'omit', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ action: 'resolve' }), signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
      if (!response.ok) throw Object.assign(new Error('画布连接不可用，请从客户端重新打开。'), { status: response.status });
      const payload = await response.json();
      if (!payload.ok) throw Object.assign(new Error(payload.error || '预览链接无效。'), { status: 400 });
      return payload.data;
    } catch (error) {
      if (signal.aborted || (error.status && ![408, 429].includes(error.status) && error.status < 500)) throw error;
      await wait(delay, signal);
      delay = Math.min(delay * 2, 5000);
    }
  }
  throw signal.reason;
}

export async function readComponentPreviewLink(location, signal) {
  const query = new URLSearchParams(location.search);
  const selectedId = query.get('component');
  const fragment = location.hash.slice(1);
  if (/^(?:[A-Za-z0-9_-]{22}|[A-Za-z0-9_-]{43})$/.test(fragment)) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fragment));
    const cacheKey = `lira.preview-link.${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    let entry;
    try { entry = await resolveLink(fragment, signal); }
    catch (error) {
      try {
        const cached = JSON.parse(window.sessionStorage.getItem(cacheKey));
        if (Array.isArray(cached) && cached.length <= SHARED_SCENE_TYPES.length + 1
          && cached.every(entry => [...SHARED_SCENE_TYPES, 'canvas'].includes(entry?.component)
            && /^[a-f0-9]{64}$/.test(entry.draftKey))) error.links = cached;
      } catch { error.links = []; }
      throw error;
    }
    const { links } = entry;
    try {
      // Only recovery identifiers are retained, never preview credentials.
      window.sessionStorage.setItem(cacheKey, JSON.stringify(links.map(({ component, draftKey }) => ({ component, draftKey }))));
    } catch {
      console.warn('无法缓存画布恢复标识；请在关闭客户端前保存修改。');
    }
    const size = query.get('size');
    const [width, height] = (size || '').split('x').map(Number);
    return { links, selectedId: selectedId || entry.selectedId || null,
      selectedSize: size ? { width, height } : entry.selectedSize || null };
  }
  const params = new URLSearchParams(fragment);
  const others = JSON.parse(params.get('components') || '[]');
  if (!Array.isArray(others)) throw new Error('预览链接无效，请从客户端重新打开。');
  const links = [...(selectedId ? [{ component: selectedId, id: params.get('id'), token: params.get('token'),
    draftKey: params.get('draftKey') }] : []), ...others];
  if (params.has('canvas')) links.push({ ...JSON.parse(params.get('canvas')), component: 'canvas' });
  return { links, selectedId, selectedSize: JSON.parse(params.get('size') || 'null') };
}
