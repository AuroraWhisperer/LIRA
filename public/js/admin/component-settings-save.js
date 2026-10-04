import { api } from '../shared/utils.js';
import { stateService } from './state.js';

export async function confirmComponentSettings() {
  const state = await stateService.reloadState();
  if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) {
    throw new Error('配置确认失败：数据格式错误。');
  }
  return state.settings;
}

export async function saveComponentSettings(patch) {
  const response = await api('/api/settings', patch, { notifyError: false });
  const settings = response.data?.settings;
  if (!settings || Object.keys(patch).some((key) => !Object.hasOwn(settings, key))) {
    throw new Error('服务端未确认全部展示参数，请更新服务后重试。');
  }
  return settings;
}
