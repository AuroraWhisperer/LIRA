import { COMPONENT_PREVIEW_DEFINITIONS } from './component-preview-definitions.js';
import { componentSaveMessage } from './component-config-controller.js';
import { createResourceStyleSettings } from './resource-style-settings.js';
import { mountComponentPreview, previewElement } from './component-preview-surface.js';
import { COMPONENT_RESOURCE_PRESETS } from '../shared/component-resource-style.js';
import { mountNauticalGuardToggle } from './gift-guard-thanks.js';

// The installed style owns parameters shared by the feature page and its scenes.
export function mountResourceStyleSettings(host, { style, request, onUse, onPreview }) {
  const root = previewElement('section', 'resource-style-settings');
  root.dataset.resourceStyleSettings = style.id;
  root.setAttribute('aria-label', `${style.name}设置`);
  const title = previewElement('h3', 'ui-section-title', style.name);
  const heading = previewElement('header', 'resource-style-heading');
  heading.append(title);
  const parameters = previewElement('div', 'resource-style-parameters');
  const actions = previewElement('div', 'resource-style-actions');
  const save = previewElement('button', 'primary', '保存设置');
  const previewButton = previewElement('button', 'secondary', '预览');
  const use = previewElement('button', 'secondary', '在画布中使用');
  const discard = previewElement('button', 'secondary', '放弃修改');
  for (const button of [save, previewButton, use, discard]) button.type = 'button';
  actions.append(save, ...(onPreview ? [] : [previewButton, use]), discard);
  const status = previewElement('p', 'hint'); status.setAttribute('role', 'status');
  const hint = previewElement('p', 'hint', '保存后同步到画布中的所有同样式组件；位置和尺寸由各画布单独设置。');
  const surface = previewElement('div', 'resource-style-preview'); surface.hidden = true;
  root.append(heading, hint, parameters, actions, status, surface); host.append(root);
  const requests = new AbortController();
  const { controller } = createResourceStyleSettings(style, { request, signal: requests.signal });
  const preset = COMPONENT_RESOURCE_PRESETS[style.config.resourceStyle.preset];
  const component = COMPONENT_PREVIEW_DEFINITIONS[style.type].createPreview({ controller, embedded: true, panelPrefix: `resource-${style.id}`,
    previewHint: onPreview ? '上方预览展示正在编辑的这条许愿；显示条数和间距用于画布及直播画面。' : undefined });
  const panel = component.createPanel(parameters, controller);
  const toggle = preset === COMPONENT_RESOURCE_PRESETS['nautical-guard-thanks'] ? mountNauticalGuardToggle(heading) : null;
  if (toggle) hint.textContent += ' 旗帜中文固定在素材中，不随语言切换。';
  let previewedConfig;
  function updatePagePreview(draft) {
    if (!onPreview || root.hidden) return;
    const serialized = JSON.stringify(draft);
    if (serialized === previewedConfig) return;
    previewedConfig = serialized;
    onPreview({ ...style, config: draft });
  }
  const stop = controller.subscribe(state => {
    for (const input of parameters.querySelectorAll('[data-component-parameter="style"], [data-component-parameter="displayStyle"]')) {
      for (const option of input.options) option.disabled = !preset.styles?.includes(option.value);
      if (!preset.styles || preset.styles.length === 1) input.closest('label').hidden = true;
    }
    save.disabled = !state.dirty || state.saving;
    discard.disabled = !state.dirty || state.saving;
    status.textContent = state.applied && !state.dirty && !state.error ? '已保存并同步到画布。' : componentSaveMessage(state);
    updatePagePreview(state.draft);
  });
  save.addEventListener('click', () => { void controller.save(); });
  discard.addEventListener('click', () => controller.discard());
  use.addEventListener('click', async () => {
    use.disabled = true;
    try {
      if (controller.getState().dirty && !await controller.save()) throw new Error(controller.getState().error || '样式保存失败，请重试。');
      await onUse({ ...style, config: controller.getState().saved });
    }
    catch (error) { status.textContent = error.message; }
    finally { use.disabled = false; }
  });
  let preview;
  const timer = setInterval(() => {
    if (!document.hidden && root.checkVisibility({ checkVisibilityCSS: true })) void controller.reload();
  }, 1000);
  function closePreview() {
    preview?.dispose(); preview = null;
    surface.hidden = true; previewButton.textContent = '预览'; previewButton.setAttribute('aria-expanded', 'false');
  }
  previewButton.setAttribute('aria-expanded', 'false');
  previewButton.addEventListener('click', () => {
    if (preview) { closePreview(); return; }
    surface.hidden = false; previewButton.textContent = '收起预览'; previewButton.setAttribute('aria-expanded', 'true');
    let { width, height } = style.config.resourceStyle;
    preview = mountComponentPreview(surface, { ...component, controller, title: style.name, size: () => [width, height],
      onResize(value) { width = value.width; height = value.height; preview?.fit(); } });
  });
  return {
    update(value) { style = value; title.textContent = style.name; controller.receive(style.config); },
    show(visible) {
      root.hidden = !visible;
      if (visible) updatePagePreview(controller.getState().draft);
      else { closePreview(); previewedConfig = undefined; }
    },
    dispose() { clearInterval(timer); requests.abort(); closePreview(); stop(); panel.dispose(); toggle?.dispose(); root.remove(); },
  };
}
