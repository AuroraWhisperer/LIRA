export async function requestComponentStyles(action, { file, description, id, kind, patch, signal } = {}, access) {
  const url = new URL(`${access ? '/api/component-preview/styles' : '/api/component-styles'}/${action}`, location.origin);
  const headers = {};
  if (access) {
    url.searchParams.set('id', access.id); url.searchParams.set('attachmentId', access.attachmentId);
    headers.Authorization = `Bearer ${access.token}`;
  } else if (window.__API_TOKEN__) headers.Authorization = `Bearer ${window.__API_TOKEN__}`;
  if (description && action !== 'pick-web') url.searchParams.set('description', JSON.stringify(description));
  if (action !== 'list') headers['Content-Type'] = file ? 'application/octet-stream' : 'application/json';
  const response = await fetch(url, { method: action === 'list' ? 'GET' : 'POST', headers,
    body: action === 'list' ? undefined : file || JSON.stringify(action === 'pick-web' ? { kind, description } : action === 'config' ? { id, patch } : { id }), signal, credentials: 'omit', cache: 'no-store' });
  if (action === 'pick-web' && response.ok && response.headers.get('Content-Type') === 'application/octet-stream') {
    return { file: new File([await response.blob()], decodeURIComponent(response.headers.get('X-Lira-Filename'))) };
  }
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw Object.assign(new Error(payload.error || '样式操作失败，请重试。'), { code: payload.code });
  if (['add', 'web', 'pick-web', 'install', 'remove', 'remove-pack', 'config'].includes(action) && payload.data) window.dispatchEvent(new Event('component-styles:changed'));
  return payload.data;
}

export function loadComponentStyleCss() {
  if (document.querySelector('link[data-component-styles]')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet';
  link.href = '/css/admin/component-styles.css'; link.dataset.componentStyles = '';
  document.head.append(link);
}
