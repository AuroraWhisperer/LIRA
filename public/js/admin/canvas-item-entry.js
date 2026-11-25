import { prepareComponentPreviews } from './component-preview-registry.js';
import { getActiveComponentPreview } from './component-preview-session.js';
import { openComponentPreview } from './component-preview-dialog.js';
import { COMPONENT_PREVIEW_DEFINITIONS } from './component-preview-definitions.js';
import { MAX_NON_TEXT_BOX_SCENE_ITEMS, validateSceneDocument } from './scene-template.js';

export async function openOrCreateCanvasItem({ type, findItem, createItem, previewData }) {
  const entries = await prepareComponentPreviews();
  const canvas = entries.find(entry => entry.id === 'canvas');
  if (!canvas?.controller.getState().loaded) throw new Error('画布尚未准备完成，请稍后重试。');
  await getActiveComponentPreview('browser-preview')?.syncCanvas();
  const document = canvas.controller.getState().draft.document;
  const component = entries.find(entry => entry.id === type) || COMPONENT_PREVIEW_DEFINITIONS[type].createPreview();
  let item = findItem?.(document.items);
  if (!item) {
    if (type !== 'text-box' && document.items.filter(item => item.type !== 'text-box').length >= MAX_NON_TEXT_BOX_SCENE_ITEMS) {
      throw new Error('当前场景已满，请在画布中新建场景。');
    }
    item = createItem(document, component);
    document.items.push(item);
    canvas.controller.edit({ document: validateSceneDocument(document) });
  }
  return openComponentPreview({ ...component, previewData, selectedItemId: item.id });
}
