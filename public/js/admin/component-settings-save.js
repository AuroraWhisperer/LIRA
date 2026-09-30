import { api } from '../shared/utils.js';

export async function saveComponentSettings(patch) {
  const response = await api('/api/settings', patch, { notifyError: false });
  const settings = response.data?.settings;
  if (!settings || Object.keys(patch).some((key) => !Object.hasOwn(settings, key))) {
    throw new Error('服务端未确认全部展示参数，请更新服务后重试。');
  }
  return settings;
}
