import { SHARED_CONTROLLER_TYPES, hasInstalledAppearance } from '../shared/scene-shared-appearance.js';

export function getCanvasPublicationEntries(entries) {
  const canvas = entries.find(({ id }) => id === 'canvas');
  const document = canvas.controller.getState().draft.document;
  const types = new Set(document.items.filter(item => item.appearance.mode === 'shared'
    || SHARED_CONTROLLER_TYPES.includes(item.type) && !hasInstalledAppearance(item.appearance.config)).map(item => item.type));
  for (const type of types) {
    if (!entries.some(({ id }) => id === type)) throw new Error(`缺少共享组件 ${type}，请重新打开预览。`);
  }
  return [...entries.filter(({ id }) => types.has(id)), canvas];
}
