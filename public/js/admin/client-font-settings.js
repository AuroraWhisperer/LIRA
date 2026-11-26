import { ensureSavedFontOption, fontValueForStack, registerFontSelect } from '../shared/font-library.js';
import { findSharedFont } from '../shared/font-catalog.js';
import { CLIENT_FONT_IDS, DEFAULT_CLIENT_FONT_ID, clientFontById } from '../shared/client-font-theme.js';
import { applySavedClientFont, prepareClientFont } from '../shared/client-font-runtime.js';

const ORIGINAL_FONT_NAMES = {
  'Microsoft YaHei': '微软雅黑',
  'Microsoft JhengHei': '微软正黑体',
  'PingFang SC': '苹方-简',
  'sans-serif': '无衬线体',
};

export function initClientFontSettings(documentRef, bridge) {
  const select = documentRef.getElementById('clientFont');
  if (!select) return;
  const originalOption = select.querySelector(`option[value="${DEFAULT_CLIENT_FONT_ID}"]`);
  const stack = documentRef.defaultView.getComputedStyle(documentRef.documentElement).getPropertyValue('--font-body-original');
  const originalFont = fontValueForStack(select, stack, 'sans-serif');
  const family = originalFont.replace(/^"|"$/g, '');
  originalOption.textContent = `${ORIGINAL_FONT_NAMES[family] ?? family}（原界面）`;
  originalOption.dataset.fontFamily = originalFont;
  const feedback = documentRef.getElementById('clientFontFeedback');
  const setFeedback = (text, state = '') => {
    if (!feedback) return;
    feedback.textContent = text;
    if (feedback.dataset) feedback.dataset.state = state;
  };
  let saved = documentRef.documentElement.dataset.clientFont || DEFAULT_CLIENT_FONT_ID;
  const restoreSelection = () => {
    const value = clientFontById(saved)?.value ?? DEFAULT_CLIENT_FONT_ID;
    ensureSavedFontOption(select, value);
    select.value = value;
  };
  const unregister = registerFontSelect(select, { allowedFonts: { shared: CLIENT_FONT_IDS }, namesOnly: true });
  window.addEventListener('pagehide', unregister, { once: true });
  restoreSelection();
  select.disabled = !bridge?.setClientFont;

  select.addEventListener('change', async () => {
    if (select.disabled) return;
    const next = findSharedFont(select.value)?.id ?? select.value;
    select.disabled = true;
    setFeedback('正在准备字体…', 'busy');
    try {
      if (!await prepareClientFont(next)) throw new Error('Font unavailable');
      const result = await bridge.setClientFont(next);
      if (!result?.ok || result.fontId !== next) throw new Error('Font preference not saved');
      saved = next;
      await applySavedClientFont(saved, true);
      setFeedback('字体已保存', 'saved');
    } catch {
      restoreSelection();
      setFeedback('字体未切换，请重试', 'error');
    } finally {
      select.disabled = false;
    }
  });
}
