import { SCENE_EXTRA_COMPONENTS, createSceneExtraDefaults } from '../shared/scene-extra-components.js';
import { previewElement } from './component-preview-surface.js';
import { syncComponentFieldValue } from './component-preview-panel.js';
import { sceneExtraPreviewData } from './scene-extra-preview-data.js';
import { SCENE_COMPONENTS } from '../shared/scene-components.js';
import { COMPONENT_RESOURCE_PRESETS, isExternalComponentStyle } from '../shared/component-resource-style.js';
import { BACKGROUND_FIELDS } from '../shared/background-appearance.js';
import { mountBackgroundParameters } from './background-parameter-view.js';
import { openingAppearanceFields } from '../shared/opening-appearance.js';
import { mountOpeningCanvasSettings } from './opening-canvas-settings.js';
import { SONG_BOARD_THEME_FIELDS } from '../shared/song-board-theme-fields.js';

export function createSceneExtraPreview(type, { controller, startPreviewData, openingSettings, embedded = false, previewHint } = {}) {
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
      const initialConfig = target.getState().draft;
      const openingFields = type === 'opening' ? openingAppearanceFields(
        initialConfig.resourceStyle?.preset === 'moonlit-opening' ? 'moonlit-fan' : initialConfig.style) : {};
      for (const [key, field] of Object.entries({ ...definition.fields, ...openingFields, ...previewFields })) {
        if (type === 'background' && Object.hasOwn(BACKGROUND_FIELDS, key)) continue;
        // Keep the legacy config key, but don't offer a color the song board doesn't render.
        if (type === 'songlist' && key === 'songBoardThemePrimary') continue;
        if (type === 'blindbox' && key === 'hideLoss') continue;
        const previewOnly = Object.hasOwn(previewFields, key);
        const label = previewElement(field.allowEmpty ? 'div' : 'label', '', field.label);
        let inherit;
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
          input.required = !field.optional;
        }
        if (field.maxLength) input.maxLength = field.maxLength;
        input.addEventListener('blur', () => render(target.getState()));
        input.addEventListener(['select', 'checkbox', 'number'].includes(field.type) ? 'change' : 'input', () => {
          if (!input.checkValidity()) return;
          let value = field.type === 'checkbox' ? input.checked : input.value;
          if (field.type === 'number' && !(field.optional && value === '')) value = cents ? Math.round(Number(value) * 100) : Number(value);
          if (previewOnly) {
            previewValues[key] = key === 'userName' ? value.trim() || field.default : value;
            for (const listener of previewListeners) listener();
          } else {
            const draft = target.getState().draft;
            const preset = COMPONENT_RESOURCE_PRESETS[draft.resourceStyle?.preset];
            target.edit({ [key]: typeof field.default === 'string' ? String(value) : value,
              ...(type === 'blindbox' && key === 'winnersOnly' ? { hideLoss: value } : {}),
              ...(['style', 'displayStyle'].includes(key) && draft.mediaStyle ? { mediaStyle: null } : {}),
              ...(['style', 'displayStyle'].includes(key) && preset && !preset.styles?.includes(value) ? { resourceStyle: null } : {}) });
          }
        });
        if (field.allowEmpty) {
          inherit = previewElement('input'); inherit.type = 'checkbox';
          inherit.setAttribute('aria-label', `${field.label}跟随文字颜色`);
          const inheritLabel = previewElement('label', 'hint', '跟随文字颜色'); inheritLabel.prepend(inherit);
          inherit.addEventListener('change', () => target.edit({ [key]: inherit.checked ? '' : input.value }));
          label.append(inheritLabel);
        }
        label.append(input); grid.append(label); fields.set(key, { input, cents, inherit, label });
      }
      host.append(grid);
      const backgroundPanel = type === 'background' ? mountBackgroundParameters(host, target) : null;
      const openingPanel = type === 'opening' && openingSettings && !initialConfig.resourceStyle && !initialConfig.mediaStyle
        ? mountOpeningCanvasSettings(host, { target, request: openingSettings, startPreviewData }) : null;
      if (type === 'opening' && !embedded) host.append(previewElement('p', 'hint', '画布始终预览动画；直播显示由开播总开关控制。'));
      if (type === 'lyrics') host.append(previewElement('p', 'hint',
        '画布展示静态示例歌词；“暂停时隐藏”仅作用于直播输出。'));
      if (definition.category === '直播小游戏') host.append(previewElement('p', 'hint', '在客户端“直播小游戏”中开始和管理游戏，这里调整展示画面。'));
      if (type === 'gift-sprint') host.append(previewElement('p', 'hint', '这里显示示例进度。直播画面跟随“组件 → 礼物姬 → 月底冲刺”的目标与进度，未设目标时隐藏。'));
      if (type === 'gift-wishes') host.append(previewElement('p', 'hint', previewHint || '预览按显示条数展示已缓存的 B 站礼物，进度为示例，礼物不足时重复展示。高度随条数和间距自动调整；直播最多显示设定条数，礼物与目标数量在“礼物许愿”中设置。'));
      if (['gift-frame', 'guard-thanks'].includes(type)) host.append(previewElement('p', 'hint',
        '画布循环展示示例；直播仅在触发时播放。请在“礼物姬”中启用对应效果。'));
      const render = ({ draft, loaded }) => {
        const nautical = draft.resourceStyle?.preset === 'nautical-guard-thanks';
        for (const [key, { input, cents, inherit, label }] of fields) {
          label.hidden = type === 'opening' && (key === 'style' ? Boolean(draft.resourceStyle)
            : !draft.resourceStyle || !Object.hasOwn(openingFields, key))
            || type === 'games' && key === 'showDanmaku' && draft.game !== 'draw-guess'
            || type === 'background' && key === 'style' && Boolean(draft.mediaStyle)
            || type === 'background' && ['sceneMode', 'windowScene', 'sceneIntervalSeconds'].includes(key)
              && (draft.style !== 'windowlight' || Boolean(draft.mediaStyle) || key === 'sceneIntervalSeconds' && draft.sceneMode !== 'auto')
            || type === 'interactions' && key === 'interactionRatingRules' && draft.kind !== 'rating'
            || type === 'interactions' && ['interactionBarColor', 'interactionTrackColor'].includes(key) && draft.kind !== 'poll'
            || type === 'gift-wishes' && ['textPendingColor', 'textReceivedColor'].includes(key) && !['text', 'original'].includes(draft.displayStyle)
            || type === 'blindbox' && key.startsWith('blindbox') && key !== 'blindboxOverlayTitle' && (!draft.heartBoxOnly
              || key === 'blindboxCastlesRemaining' && ![true, 'true'].includes(draft.blindboxShowCastlesRemaining))
            || type === 'guard-thanks' && (nautical ? ['style', 'textMode', 'months'].includes(key)
              : ['showAvatar', 'showUserName', 'nameFontSize'].includes(key));
          const value = Object.hasOwn(previewFields, key) ? previewValues[key]
            : draft[key] ?? openingFields[key]?.default ?? definition.fields[key].default;
          if (input.tagName === 'SELECT' && ['style', 'displayStyle'].includes(key)) {
            const preset = COMPONENT_RESOURCE_PRESETS[draft.resourceStyle?.preset];
            for (const option of input.options) {
              option.hidden = isExternalComponentStyle(option.value) && value !== option.value && !preset?.styles?.includes(option.value);
              option.disabled = option.hidden;
            }
          }
          if (input.type === 'checkbox') input.checked = value === true || value === 'true'
            || type === 'blindbox' && key === 'winnersOnly' && [true, 'true'].includes(draft.hideLoss);
          else syncComponentFieldValue(input, cents ? Number(value) / 100 : inherit && !value ? draft.songBoardThemeText : value);
          if (inherit) { inherit.checked = !value; inherit.disabled = !loaded; }
          input.disabled = !loaded || Boolean(inherit && !value);
          if (type === 'songlist' && draft.songBoardSyncTheme === 'true'
            && Object.hasOwn(SONG_BOARD_THEME_FIELDS, key)) label.hidden = true;
        }
      };
      const stop = target.subscribe(render);
      const syncPreview = () => render(target.getState());
      previewPanels.add(syncPreview);
      return { dispose() { stop(); backgroundPanel?.dispose(); openingPanel?.dispose(); previewPanels.delete(syncPreview); } };
    },
  };
}
