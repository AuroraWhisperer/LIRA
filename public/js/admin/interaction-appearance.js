import { api } from '../shared/utils.js';
import { INTERACTION_APPEARANCE_DEFAULTS, readInteractionAppearance, applyInteractionAppearance } from '../shared/interaction-appearance.js';
import { renderPollRows } from '../shared/interaction-view.js';
import { initParameterRanges, refreshParameterRange } from '../shared/parameter-range.js';

export function initInteractionAppearance() {
  const get = (id) => document.getElementById(id);
  const form = get('interactionAppearanceForm');
  const fields = get('interactionAppearanceFields');
  const status = get('interactionAppearanceStatus');
  const apply = get('interactionAppearanceApply');
  const retry = get('interactionAppearanceRetry');
  const controls = Object.fromEntries(Object.keys(INTERACTION_APPEARANCE_DEFAULTS)
    .filter((key) => key !== 'interactionBackgroundColor' && key !== 'interactionBackgroundOpacity')
    .map((key) => [key, get(key)]));
  initParameterRanges(form);
  let loaded = false;
  let saving = false;
  let dirty = false;
  let disposed = false;
  let kind = 'poll';

  function draft() {
    return Object.fromEntries(Object.entries(controls).map(([key, input]) => [
      key, input.type === 'checkbox' ? String(input.checked) : input.value,
    ]));
  }
  function fill(settings) {
    const appearance = readInteractionAppearance(settings);
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
      ['interactionFontSize', 'px'], ['interactionCornerRadius', 'px'],
    ]) {
      const value = `${appearance[key]}${unit}`;
      get(`${key}Value`).textContent = value;
      controls[key].setAttribute('aria-valuetext', value);
      refreshParameterRange(controls[key]);
    }
    const options = [...get('pollOptions').querySelectorAll('input')].map((input, index) => ({
      text: input.value.trim() || `选项 ${index + 1}`, votes: index === 0 ? 68 : index === 1 ? 32 : 0,
      percentage: index === 0 ? 68 : index === 1 ? 32 : 0,
    }));
    renderPollRows(get('interactionPreviewRows'), { sessionId: `preview-${options.length}`, phase: 'collecting', options });
  }
  function edit() {
    if (!loaded || saving) return;
    dirty = true;
    apply.disabled = false;
    status.textContent = '未应用';
    preview();
  }
  async function load() {
    fields.disabled = true;
    retry.hidden = true;
    status.textContent = '正在读取…';
    try {
      const response = await fetch('/api/state', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || '读取失败');
      if (disposed) return;
      fill(payload.data.settings);
      loaded = true;
      dirty = false;
      apply.disabled = true;
      status.textContent = '';
    } catch (error) {
      if (disposed) return;
      status.textContent = `读取失败：${error.message}`;
      retry.hidden = false;
    } finally {
      if (!disposed) fields.disabled = !loaded;
    }
  }
  form.addEventListener('input', edit);
  get('interactionAppearanceReset').addEventListener('click', () => {
    fill(INTERACTION_APPEARANCE_DEFAULTS);
    edit();
  });
  retry.addEventListener('click', load);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!loaded || saving || !dirty) return;
    saving = true;
    fields.disabled = true;
    status.textContent = '正在应用…';
    try {
      const response = await api('/api/settings', draft(), { notifyError: false });
      if (disposed) return;
      fill(response.data.settings);
      dirty = false;
      status.textContent = '已应用';
    } catch (error) {
      if (!disposed) status.textContent = `应用失败，修改已保留：${error.message}`;
    } finally {
      saving = false;
      if (!disposed) { fields.disabled = false; apply.disabled = !dirty; }
    }
  });
  get('pollForm').addEventListener('input', preview);
  get('ratingForm').addEventListener('input', preview);
  const observer = new MutationObserver(preview);
  observer.observe(get('pollOptions'), { childList: true });
  fill(INTERACTION_APPEARANCE_DEFAULTS);
  void load();
  window.addEventListener('app:shutdown', () => { disposed = true; observer.disconnect(); }, { once: true });
  return {
    setKind(nextKind) {
      if (nextKind === kind) return;
      kind = nextKind;
      preview();
    },
  };
}
