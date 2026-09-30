const COMPONENT_ORDER = ['danmaku', 'clock', 'queue', 'overtime'];
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
  factories.set(id, factory);
}

export function getComponentPreviews() {
  return COMPONENT_ORDER.filter((id) => factories.has(id)).map((id) => factories.get(id)());
}
