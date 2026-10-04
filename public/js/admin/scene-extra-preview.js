import { SCENE_EXTRA_COMPONENTS, createSceneExtraDefaults } from '../shared/scene-extra-components.js';
import { previewElement } from './component-preview-surface.js';
import { syncComponentFieldValue } from './component-preview-panel.js';
import { sceneExtraPreviewData } from './scene-extra-preview-data.js';
import { SCENE_COMPONENTS } from '../shared/scene-components.js';

export function createSceneExtraPreview(type, { controller, startPreviewData } = {}) {
  const definition = SCENE_EXTRA_COMPONENTS[type];
  const previewFields = type === 'guard-thanks' ? {
    tier: { label: '预览等级', type: 'select', default: 'captain', options: { captain: '舰长', admiral: '提督', governor: '总督' } },
    userName: { label: '预览观众', type: 'text', default: '观众A', maxLength: 100 },
    months: { label: '预览月数', type: 'number', default: 1, min: 1, max: 999, step: 1 },
    style: { label: '动画风格', type: 'select', default: 'aurora', options: { aurora: '辉光（柔和）', classic: '经典（徽章）' } },
  } : {};
  const previewValues = Object.fromEntries(Object.entries(previewFields).map(([key, field]) => [key, field.default]));
  const previewListeners = new Set();
  const previewPanels = new Set();
  let previousPreviewInput;
  if (!controller) {
    const draft = createSceneExtraDefaults(type);
    const getState = () => ({ draft: structuredClone(draft), saved: structuredClone(draft), loaded: true, dirty: false });
    controller = { getState, subscribe(listener) { listener(getState()); return () => {}; } };
  }
  return { id: type, title: definition.title, controller, sceneOnly: true,
    url: new URL(SCENE_COMPONENTS[type].rendererUrl, location.href).href,
    size: () => definition.size,
    startData({ emit }) {
      const sample = sceneExtraPreviewData(type);
      let display;
      let previous;
      const receive = (value) => {
        display = value;
        const source = display?.previewData?.[type] || sample;
        const input = type === 'guard-thanks' ? display?.previewData?.[type]?.events?.[0] : null;
        const inputKey = JSON.stringify(input);
        // 客户端样例改变时才回填，避免轮询覆盖画布中的预览输入。
        if (input && inputKey !== previousPreviewInput) {
          previousPreviewInput = inputKey;
          for (const [key, field] of Object.entries(previewFields)) previewValues[key] = input[key] ?? field.default;
          for (const sync of previewPanels) sync();
        }
        const data = type === 'guard-thanks' && source.preview
          ? { ...source, events: source.events.map(event => ({ ...event, ...previewValues })) } : source;
        const serialized = JSON.stringify(data);
        if (serialized === previous) return;
        previous = serialized;
        emit(data);
      };
      const refresh = () => receive(display);
      previewListeners.add(refresh);
      const stop = startPreviewData?.(receive);
      if (!startPreviewData) receive(null);
      return () => { previewListeners.delete(refresh); stop?.(); };
    },
    createPanel(host, target = controller) {
      const fields = new Map();
      const grid = previewElement('div', 'component-preview-fields preview-extra-fields');
      for (const [key, field] of Object.entries({ ...definition.fields, ...previewFields })) {
        const previewOnly = Object.hasOwn(previewFields, key);
        const label = previewElement('label', '', field.label);
        const input = previewElement(['select', 'textarea'].includes(field.type) ? field.type : 'input');
        const cents = type === 'gift-feed' && (key.startsWith('threshold') || key === 'minGiftAmountCents');
        if (field.type === 'select') {
          for (const [value, title] of Object.entries(field.options)) {
            const option = previewElement('option', '', title); option.value = value; input.append(option);
          }
        } else if (field.type === 'textarea') input.rows = 3;
        else input.type = field.type;
        if (previewOnly) input.dataset.previewParameter = key;
        else input.dataset.componentParameter = key;
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
          if (previewOnly) {
            previewValues[key] = key === 'userName' ? value.trim() || field.default : value;
            for (const listener of previewListeners) listener();
          } else target.edit({ [key]: typeof field.default === 'string' ? String(value) : value });
        });
        label.append(input); grid.append(label); fields.set(key, { input, cents });
      }
      host.append(grid);
      if (type === 'opening') host.append(previewElement('p', 'hint',
        '画面跟随客户端“开播动画”的样式、文案、图片、音乐与总开关；在这里调整位置和大小。'));
      if (definition.category) host.append(previewElement('p', 'hint', '在客户端“直播小游戏”中开始和管理游戏，这里调整展示画面。'));
      if (type === 'gift-wishes') host.append(previewElement('p', 'hint', '礼物与目标数量在“礼物许愿”中设置。'));
      if (['gift-frame', 'guard-thanks'].includes(type)) host.append(previewElement('p', 'hint',
        '画布循环展示示例；直播仅在触发时播放。请在“礼物姬”中启用对应效果。'));
      const render = ({ draft, loaded }) => {
        for (const [key, { input, cents }] of fields) {
          input.parentElement.hidden = type === 'games' && key === 'showDanmaku' && draft.game !== 'draw-guess'
            || type === 'interactions' && key === 'interactionRatingRules' && draft.kind !== 'rating'
            || type === 'interactions' && ['interactionBarColor', 'interactionTrackColor'].includes(key) && draft.kind !== 'poll'
            || type === 'gift-wishes' && ['textPendingColor', 'textReceivedColor'].includes(key) && !['text', 'original'].includes(draft.displayStyle);
          const value = Object.hasOwn(previewFields, key) ? previewValues[key] : draft[key];
          if (input.type === 'checkbox') input.checked = value === true || value === 'true';
          else syncComponentFieldValue(input, cents ? Number(value) / 100 : value);
          input.disabled = !loaded;
        }
      };
      const stop = target.subscribe(render);
      const syncPreview = () => render(target.getState());
      previewPanels.add(syncPreview);
      return { dispose() { stop(); previewPanels.delete(syncPreview); } };
    },
  };
}
