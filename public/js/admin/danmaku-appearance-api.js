import { api } from '../shared/utils.js';
import { assertApiResponse, readJsonResponse } from '../shared/json-response.js';

const endpoint = '/api/danmaku/appearance';

export async function readDanmakuAppearance() {
  const response = await fetch(endpoint, { cache: 'no-store' });
  return assertApiResponse(response, await readJsonResponse(response, '弹幕外观读取失败'), '弹幕外观读取失败').data;
}

export async function saveDanmakuAppearance(input) {
  return (await api(endpoint, input, { notifyError: false })).data;
}
