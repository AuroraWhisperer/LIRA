import { SCENE_EXTRA_COMPONENTS, createSceneExtraDefaults } from '../shared/scene-extra-components.js';
import { previewElement } from './component-preview-surface.js';
import { syncComponentFieldValue } from './component-preview-panel.js';
import { sceneExtraPreviewData } from './scene-extra-preview-data.js';

export function createSceneExtraPreview(type, { controller } = {}) {
  const definition = SCENE_EXTRA_COMPONENTS[type];
  if (!controller) {
    const draft = createSceneExtraDefaults(type);
    const getState = () => ({ draft: structuredClone(draft), saved: structuredClone(draft), loaded: true, dirty: false });
    controller = { getState, subscribe(listener) { listener(getState()); return () => {}; } };
  }
  return { id: type, title: definition.title, controller, sceneOnly: true,
    url: new URL(`${definition.path}?componentPreview=1`, location.href).href,
    size: () => definition.size,
    startData: ({ emit }) => emit(sceneExtraPreviewData(type)),
    createPanel(host, target = controller) {
      const fields = new Map();
      const grid = previewElement('div', 'component-preview-fields preview-extra-fields');
      for (const [key, field] of Object.entries(definition.fields)) {
        const label = previewElement('label', '', field.label);
        const input = previewElement(['select', 'textarea'].includes(field.type) ? field.type : 'input');
        const cents = type === 'gift-feed' && (key.startsWith('threshold') || key === 'minGiftAmountCents');
        if (field.type === 'select') {
          for (const [value, title] of Object.entries(field.options)) {
            const option = previewElement('option', '', title); option.value = value; input.append(option);
          }
        } else if (field.type === 'textarea') input.rows = 3;
        else input.type = field.type;
        input.dataset.componentParameter = key;
        if (field.type === 'number') {
          input.min = String(field.min / (cents ? 100 : 1));
          input.max = String(field.max / (cents ? 100 : 1));
          input.step = String(field.step / (cents ? 100 : 1));
          input.required = true;
        }
        if (field.maxLength) input.maxLength = field.maxLength;
        input.addEventListener(['select', 'checkbox', 'number'].includes(field.type) ? 'change' : 'input', () => {
          if (!input.checkValidity()) return;
          let value = field.type === 'checkbox' ? input.checked : input.value;
          if (field.type === 'number') value = cents ? Math.round(Number(value) * 100) : Number(value);
          target.edit({ [key]: typeof field.default === 'string' ? String(value) : value });
        });
        label.append(input); grid.append(label); fields.set(key, { input, cents });
      }
      host.append(grid);
      if (definition.category) host.append(previewElement('p', 'hint', '在客户端“直播小游戏”中开始和管理游戏，这里调整展示画面。'));
      if (type === 'gift-wishes') host.append(previewElement('p', 'hint', '礼物与目标数量在“礼物许愿”中设置。'));
      return { dispose: target.subscribe(({ draft, loaded }) => {
        for (const [key, { input, cents }] of fields) {
          input.parentElement.hidden = type === 'games' && key === 'showDanmaku' && draft.game !== 'draw-guess'
            || type === 'interactions' && key === 'interactionRatingRules' && draft.kind !== 'rating'
            || type === 'interactions' && ['interactionBarColor', 'interactionTrackColor'].includes(key) && draft.kind !== 'poll'
            || type === 'gift-wishes' && ['textPendingColor', 'textReceivedColor'].includes(key) && !['text', 'original'].includes(draft.displayStyle);
          if (input.type === 'checkbox') input.checked = draft[key] === true || draft[key] === 'true';
          else syncComponentFieldValue(input, cents ? Number(draft[key]) / 100 : draft[key]);
          input.disabled = !loaded;
        }
      }) };
    },
  };
}
