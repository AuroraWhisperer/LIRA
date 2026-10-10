import { api } from '../shared/utils.js';
import { assertApiResponse, readJsonResponse } from '../shared/json-response.js';
import { eventBus } from '../shared/event-bus.js';

export async function requestScene(action, body, id) {
  if (body !== undefined) {
    const { data } = await api(`/api/scenes/${action}`, body, { notifyError: false });
    if (action === 'publish' || action === 'canvas-publish' || action === 'delete') eventBus.emit('scene:published');
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
  const payload = assertApiResponse(response, await readJsonResponse(response, '场景读取失败'), '场景读取失败，请重试。');
  return payload.data;
}
