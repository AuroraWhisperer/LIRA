import {
  INTERACTION_APPEARANCE_DEFAULTS,
  readInteractionAppearance,
  applyInteractionAppearance,
} from '../shared/interaction-appearance.js';
import { renderPollRows } from '../shared/interaction-view.js';
import { initParameterRanges, refreshParameterRange } from '../shared/parameter-range.js';
import { createComponentConfigController } from './component-config-controller.js';
import { saveComponentSettings, confirmComponentSettings } from './component-settings-save.js';

export function initInteractionAppearance() {
  const get = (id) => document.getElementById(id);
  const form = get('interactionAppearanceForm');
  const fields = get('interactionAppearanceFields');
  const status = get('interactionAppearanceStatus');
  const apply = get('interactionAppearanceApply');
  const retry = get('interactionAppearanceRetry');
  const controls = Object.fromEntries(
    Object.keys(INTERACTION_APPEARANCE_DEFAULTS)
      .filter((key) => key !== 'interactionBackgroundColor' && key !== 'interactionBackgroundOpacity')
      .map((key) => [key, get(key)]),
  );
  initParameterRanges(form);
  const controller = createComponentConfigController({
    read: async () => readInteractionAppearance(await confirmComponentSettings()),
    persist: async (_draft, patch) => readInteractionAppearance(await saveComponentSettings(patch)),
  });
  let disposed = false;
  let kind = 'poll';

  function draft() {
    return Object.fromEntries(
      Object.entries(controls).map(([key, input]) => [
        key,
        input.type === 'checkbox' ? String(input.checked) : input.value,
      ]),
    );
  }
  function fill(appearance) {
    for (const [key, input] of Object.entries(controls)) {
      if (input.type === 'checkbox') input.checked = appearance[key] === 'true';
      else input.value = appearance[key];
    }
    preview();
  }
  function preview() {
    const appearance = applyInteractionAppearance(get('interactionPreview'), draft());
    const title = appearance.interactionOverlayTitle;
    get('interactionPreview').dataset.kind = kind;
    get('interactionPreviewTitle').textContent = title;
    get('interactionPreviewTitle').hidden = !title;
    get('interactionPreviewTitle').classList.toggle('is-long', Array.from(title).length > 35);
    get('interactionPreviewHint').textContent = appearance.interactionOverlayHint;
    get('interactionPreviewStatus').textContent = kind === 'rating' ? '评分已结束' : '剩余 00:52';
    get('interactionPreviewStatus').hidden = appearance.interactionShowStatus !== 'true';
    get('interactionPreviewTitle').parentElement.hidden = !title && get('interactionPreviewStatus').hidden;
    get('interactionPreviewParticipants').textContent = kind === 'rating' ? '100 人评分' : '100 人参与';
    get('interactionPreviewParticipants').hidden = appearance.interactionShowParticipants !== 'true';
    get('interactionPreviewParticipants').parentElement.hidden = get('interactionPreviewParticipants').hidden;
    get('interactionPreviewRows').hidden = kind !== 'poll';
    get('interactionPreviewRatingRules').hidden = kind !== 'rating';
    get('interactionPreviewRatingRules').textContent = appearance.interactionRatingRules;
    get('interactionPreviewScore').hidden = kind !== 'rating';
    for (const [key, unit] of [
      ['interactionOverallOpacity', '%'],
      ['interactionFontSize', 'px'],
      ['interactionCornerRadius', 'px'],
    ]) {
      const value = `${appearance[key]}${unit}`;
      get(`${key}Value`).textContent = value;
      controls[key].setAttribute('aria-valuetext', value);
      refreshParameterRange(controls[key]);
    }
    const inputs = [...get('pollOptions').querySelectorAll('input')];
    const options = inputs.map((input, index) => ({
      text: input.value.trim() || `选项 ${index + 1}`,
      votes: inputs.length === 1 ? 100 : index === 0 ? 68 : index === 1 ? 32 : 0,
      percentage: inputs.length === 1 ? 100 : index === 0 ? 68 : index === 1 ? 32 : 0,
    }));
    renderPollRows(get('interactionPreviewRows'), {
      sessionId: `preview-${options.length}`,
      phase: 'collecting',
      options,
    });
  }
  function edit() {
    const state = controller.getStatus();
    if (!state.loaded || state.saving) return;
    controller.edit(draft());
    const dirty = controller.getStatus().dirty;
    apply.disabled = !dirty;
    status.textContent = dirty ? '未应用' : '';
    preview();
  }
  async function load() {
    fields.disabled = true;
    retry.hidden = true;
    status.textContent = '正在读取…';
    await controller.reload();
    if (disposed) return;
    const state = controller.getState();
    if (state.error) {
      status.textContent = `读取失败：${state.error}`;
      retry.hidden = false;
    } else if (state.loaded) {
      fill(state.draft);
      apply.disabled = !state.dirty;
      status.textContent = '';
    }
    fields.disabled = !state.loaded;
  }
  form.addEventListener('input', edit);
  get('interactionAppearanceReset').addEventListener('click', () => {
    fill(INTERACTION_APPEARANCE_DEFAULTS);
    edit();
  });
  retry.addEventListener('click', load);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const before = controller.getStatus();
    if (!before.loaded || before.saving || !before.dirty) return;
    controller.edit(draft());
    fields.disabled = true;
    status.textContent = '正在应用…';
    const applied = await controller.save();
    if (disposed) return;
    const state = controller.getState();
    fill(state.draft);
    status.textContent = applied ? '已应用'
      : state.dirty ? `应用失败，修改已保留：${state.error}` : state.error;
    fields.disabled = false;
    apply.disabled = !state.dirty;
  });
  get('pollForm').addEventListener('input', preview);
  get('ratingForm').addEventListener('input', preview);
  const observer = new MutationObserver(preview);
  observer.observe(get('pollOptions'), { childList: true });
  fill(INTERACTION_APPEARANCE_DEFAULTS);
  void load();
  const receive = event => {
    if (disposed) return;
    controller.receive(readInteractionAppearance(event.detail));
    const state = controller.getState();
    apply.disabled = state.saving || !state.dirty;
    fill(state.draft);
  };
  window.addEventListener('app:settings-state', receive);
  window.addEventListener(
    'app:shutdown',
    () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener('app:settings-state', receive);
    },
    { once: true },
  );
  return {
    setKind(nextKind) {
      if (nextKind === kind) return;
      kind = nextKind;
      preview();
    },
  };
}
