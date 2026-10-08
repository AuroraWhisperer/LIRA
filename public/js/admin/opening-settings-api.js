export async function requestOpeningSettings(kind, { style, patch, file, remove = false, signal } = {}, access) {
  const url = new URL(`/api/component-preview/opening/${kind}`, location.origin);
  url.searchParams.set('id', access.id);
  url.searchParams.set('attachmentId', access.attachmentId);
  if (style) url.searchParams.set('style', style);
  const headers = { Authorization: `Bearer ${access.token}` };
  let body;
  if (file) { body = new FormData(); body.append('file', file, file.name); }
  else if (patch) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(patch); }
  const response = await fetch(url, { method: remove ? 'DELETE' : body ? 'POST' : 'GET',
    headers, body, signal, credentials: 'omit', cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || '开播设置保存失败，请重试。');
  return payload.data;
}
