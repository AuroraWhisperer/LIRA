import { SCENE_TYPES } from '../shared/scene-components.js';
const factories = new Map();
let prepare = () => {};

export function setComponentPreviewPreparation(callback) {
  prepare = callback;
}

export async function prepareComponentPreviews() {
  const canvas = await prepare();
  return [...getComponentPreviews(), ...(canvas ? [canvas] : [])];
}

export function registerComponentPreview(id, factory) {
  if (!SCENE_TYPES.includes(id)) throw new Error(`未知组件类型：${id}`);
  factories.set(id, factory);
}

export function getComponentPreviews() {
  return SCENE_TYPES.filter((id) => factories.has(id)).map((id) => factories.get(id)());
}
