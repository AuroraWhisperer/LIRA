import { api, readJsonResponse } from '../shared/utils.js';
import { eventBus } from '../shared/event-bus.js';

export async function requestScene(action, body, id) {
  if (body !== undefined) {
    const { data } = await api(`/api/scenes/${action}`, body, { notifyError: false });
    if (action === 'publish') eventBus.emit('scene:published');
    return data;
  }
  const query = id ? `?id=${encodeURIComponent(id)}` : '';
  return readSceneData(`/api/scenes/${action}${query}`);
}

export function readComponentOutputSize(type, signal) {
  return readSceneData(`/api/component/size?type=${encodeURIComponent(type)}`, signal);
}

async function readSceneData(url, signal) {
  const response = await fetch(url, { cache: 'no-store', signal });
  const payload = await readJsonResponse(response, '场景读取失败');
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.error || '场景读取失败，请重试。');
    error.status = response.status;
    throw error;
  }
  return payload.data;
}
