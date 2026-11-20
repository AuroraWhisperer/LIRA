import { mountDanmakuParameters } from '../shared/danmaku-parameter-controls.js';
import { DANMAKU_STYLE_OPTIONS } from '../shared/danmaku-style-options.js';
import { componentField } from './component-preview-panel.js';
import { acquireDanmakuAppearanceValues } from '../overlays/danmaku-appearance-values.js';

export function bindDanmakuParameters(root, controller, onError) {
  const host = componentField(root, 'danmakuParameterFields');
  const values = acquireDanmakuAppearanceValues(host.ownerDocument);
  const controls = mountDanmakuParameters(host, controller, {
    prefix: host.id.replace(/ParameterFields$/, ''), onError,
    resetButton: componentField(root, 'danmakuResetParameters'),
    appearanceValues: values,
  });
  const unsubscribe = controller.subscribe(({ draft, loaded }) => {
    componentField(root, 'danmakuParametersTitle').textContent = `参数调节 · ${DANMAKU_STYLE_OPTIONS[draft.style].label}`;
    const hint = componentField(root, 'danmakuParametersHint');
    const supported = Object.hasOwn(draft, 'styleOptions');
    hint.textContent = !loaded ? '登录并读取配置后可调节参数。'
      : !supported ? '外观参数尚未完整读取，请重新读取后重试。' : '';
    hint.hidden = loaded && supported;
  });
  return { dispose() { unsubscribe(); controls.dispose(); values.dispose(); } };
}
