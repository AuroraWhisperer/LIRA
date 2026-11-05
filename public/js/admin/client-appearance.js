'use strict';

const initializedPanels = new WeakSet();

export function initClientAppearance({ documentRef = document, desktopBridge = window.songAssistantDesktop } = {}) {
  const panel = documentRef.getElementById('clientAppearance');
  if (!panel || initializedPanels.has(panel)) return;
  initializedPanels.add(panel);

  const choices = [...panel.querySelectorAll('input[name="clientTheme"]')];
  const themeIds = new Set(choices.map((choice) => choice.value));
  const feedback = panel.querySelector('[data-client-theme-feedback]');
  const canApply = typeof desktopBridge?.setClientTheme === 'function';
  const initialTheme = documentRef.documentElement.dataset.clientTheme;
  let currentTheme = themeIds.has(initialTheme) ? initialTheme : choices.find((choice) => choice.defaultChecked).value;
  let pendingTheme = '';

  function render() {
    for (const choice of choices) {
      choice.checked = choice.value === (pendingTheme || currentTheme);
      choice.disabled = Boolean(pendingTheme) || !canApply;
    }
    panel.setAttribute('aria-busy', String(Boolean(pendingTheme)));
  }

  for (const choice of choices) {
    choice.addEventListener('change', async () => {
      if (pendingTheme || !canApply || !choice.checked || !themeIds.has(choice.value) || choice.value === currentTheme) {
        render();
        return;
      }
      pendingTheme = choice.value;
      feedback.textContent = '正在保存…';
      render();
      try {
        const result = await desktopBridge.setClientTheme(choice.value);
        if (result?.ok !== true || !themeIds.has(result.themeId)) {
          throw new Error('Client theme was not saved');
        }
        currentTheme = result.themeId;
        documentRef.documentElement.dataset.clientTheme = currentTheme;
        feedback.textContent = '配色已保存';
      } catch {
        feedback.textContent = '配色未保存，请重新选择';
      } finally {
        pendingTheme = '';
        render();
      }
    });
  }

  if (!canApply) feedback.textContent = '请在桌面客户端设置配色。';
  render();
}
