import { SCENE_EXTRA_COMPONENTS, createSceneExtraDefaults } from '../shared/scene-extra-components.js';
import { previewElement } from './component-preview-surface.js';
import { syncComponentFieldValue } from './component-preview-panel.js';
import { sceneExtraPreviewData } from './scene-extra-preview-data.js';
import { SCENE_COMPONENTS } from '../shared/scene-components.js';
import { COMPONENT_RESOURCE_PRESETS, isExternalComponentStyle } from '../shared/component-resource-style.js';
import { BACKGROUND_FIELDS } from '../shared/background-appearance.js';
import { mountBackgroundParameters } from './background-parameter-view.js';

export function createSceneExtraPreview(type, { controller, startPreviewData } = {}) {
  const definition = SCENE_EXTRA_COMPONENTS[type];
  const previewFields = type === 'guard-thanks' ? {
    tier: { label: '预览等级', type: 'select', default: 'captain', options: { captain: '舰长', admiral: '提督', governor: '总督' } },
    userName: { label: '预览观众', type: 'text', default: '观众A', maxLength: 100 },
    months: { label: '预览月数', type: 'number', default: 1, min: 1, max: 999, step: 1 },
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
    size: config => definition.variants.find(variant => variant.value === config?.[definition.variantKey])?.size || definition.size,
    projectConfig: config => type === 'lyrics' ? { ...config, desktopLyricHideOnPause: 'false' } : config,
    startData({ emit, controller: target = controller }) {
      const sample = type === 'games' ? { preview: true, session: null } : sceneExtraPreviewData(type);
      let display;
      let previous;
      const receive = (value) => {
        display = value;
        let source = display?.previewData?.[type] || sample;
        if (type === 'opening') source = { ...source, enabled: true, preview: true,
          ...(!source?.enabled ? { audio: 'none' } : {}) };
        if (type === 'gift-wishes' && source.preview) {
          const period = target.getState().draft.period;
          if (period !== 'all') source = { ...source,
            items: source.items.map(item => ({ ...item, period, label: '示例心愿' })) };
        }
        if (type === 'songlist' && source.preview) {
          const category = target.getState().draft.category;
          if (category) source = { ...source, songs: source.songs.map(song => ({ ...song, category_name: category })) };
        }
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
      const stopConfig = ['gift-wishes', 'songlist'].includes(type) ? target.subscribe(refresh) : null;
      const stop = startPreviewData?.(receive);
      if (!startPreviewData) receive(null);
      return () => { previewListeners.delete(refresh); stopConfig?.(); stop?.(); };
    },
    createPanel(host, target = controller) {
      const fields = new Map();
      const grid = previewElement('div', 'component-preview-fields preview-extra-fields');
      for (const [key, field] of Object.entries({ ...definition.fields, ...previewFields })) {
        if (type === 'background' && Object.hasOwn(BACKGROUND_FIELDS, key)) continue;
        // Keep the legacy config key, but don't offer a color the song board doesn't render.
        if (type === 'songlist' && key === 'songBoardThemePrimary') continue;
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
          } else {
            const draft = target.getState().draft;
            const preset = COMPONENT_RESOURCE_PRESETS[draft.resourceStyle?.preset];
            target.edit({ [key]: typeof field.default === 'string' ? String(value) : value,
              ...(['style', 'displayStyle'].includes(key) && draft.mediaStyle ? { mediaStyle: null } : {}),
              ...(['style', 'displayStyle'].includes(key) && preset && !preset.styles.includes(value) ? { resourceStyle: null } : {}) });
          }
        });
        label.append(input); grid.append(label); fields.set(key, { input, cents });
      }
      host.append(grid);
      const backgroundPanel = type === 'background' ? mountBackgroundParameters(host, target) : null;
      if (type === 'opening') host.append(previewElement('p', 'hint',
        '画布始终预览动画，展示样式可独立选择。文案、图片与音乐跟随客户端“开播动画”；直播显示由总开关控制，关闭时预览静音。'));
      if (type === 'lyrics') host.append(previewElement('p', 'hint',
        '画布展示静态示例歌词；“暂停时隐藏”仅作用于直播输出。'));
      if (definition.category === '直播小游戏') host.append(previewElement('p', 'hint', '在客户端“直播小游戏”中开始和管理游戏，这里调整展示画面。'));
      if (type === 'gift-sprint') host.append(previewElement('p', 'hint', '这里显示示例进度。直播画面跟随“礼物 → 月底冲刺”的目标与进度，未设目标时隐藏。'));
      if (type === 'gift-wishes') host.append(previewElement('p', 'hint', '预览随机展示 3 款已缓存的 B 站礼物，进度为示例。直播礼物与目标数量在“礼物许愿”中设置。'));
      if (['gift-frame', 'guard-thanks'].includes(type)) host.append(previewElement('p', 'hint',
        '画布循环展示示例；直播仅在触发时播放。请在“礼物姬”中启用对应效果。'));
      const render = ({ draft, loaded }) => {
        for (const [key, { input, cents }] of fields) {
          input.parentElement.hidden = type === 'games' && key === 'showDanmaku' && draft.game !== 'draw-guess'
            || type === 'background' && key === 'style' && Boolean(draft.mediaStyle)
            || type === 'interactions' && key === 'interactionRatingRules' && draft.kind !== 'rating'
            || type === 'interactions' && ['interactionBarColor', 'interactionTrackColor'].includes(key) && draft.kind !== 'poll'
            || type === 'gift-wishes' && ['textPendingColor', 'textReceivedColor'].includes(key) && !['text', 'original'].includes(draft.displayStyle);
          const value = Object.hasOwn(previewFields, key) ? previewValues[key] : draft[key] ?? definition.fields[key].default;
          if (input.tagName === 'SELECT' && ['style', 'displayStyle'].includes(key)) {
            const preset = COMPONENT_RESOURCE_PRESETS[draft.resourceStyle?.preset];
            for (const option of input.options) {
              option.hidden = isExternalComponentStyle(option.value) && value !== option.value && !preset?.styles.includes(option.value);
              option.disabled = option.hidden;
            }
          }
          if (input.type === 'checkbox') input.checked = value === true || value === 'true';
          else syncComponentFieldValue(input, cents ? Number(value) / 100 : value);
          input.disabled = !loaded;
        }
      };
      const stop = target.subscribe(render);
      const syncPreview = () => render(target.getState());
      previewPanels.add(syncPreview);
      return { dispose() { stop(); backgroundPanel?.dispose(); previewPanels.delete(syncPreview); } };
    },
  };
}
