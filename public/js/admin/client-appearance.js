'use strict';

const THEME_IDS = ['neutral', 'classic', 'terracotta'];
const initializedPanels = new WeakSet();

export function initClientAppearance({ documentRef = document, desktopBridge = window.songAssistantDesktop } = {}) {
  const panel = documentRef.getElementById('clientAppearance');
  if (!panel || initializedPanels.has(panel)) return;
  initializedPanels.add(panel);

  const choices = [...panel.querySelectorAll('input[name="clientTheme"]')];
  const currentLabels = [...panel.querySelectorAll('[data-client-theme-current]')];
  const applyButton = panel.querySelector('[data-client-theme-apply]');
  const feedback = panel.querySelector('[data-client-theme-feedback]');
  const canApply = typeof desktopBridge?.setClientTheme === 'function';
  const initialTheme = documentRef.documentElement.dataset.clientTheme;
  let currentTheme = THEME_IDS.includes(initialTheme) ? initialTheme : 'terracotta';
  let candidateTheme = currentTheme;
  let saving = false;

  function render() {
    for (const choice of choices) {
      choice.checked = choice.value === candidateTheme;
      choice.disabled = saving || !canApply;
    }
    for (const label of currentLabels) {
      label.hidden = label.dataset.clientThemeCurrent !== currentTheme;
    }
    applyButton.disabled = saving || !canApply || candidateTheme === currentTheme;
    applyButton.textContent = saving ? '正在应用…' : '应用配色';
    panel.setAttribute('aria-busy', String(saving));
  }

  for (const choice of choices) {
    choice.addEventListener('change', () => {
      if (!saving && canApply && choice.checked && THEME_IDS.includes(choice.value)) {
        candidateTheme = choice.value;
        feedback.textContent = '';
      }
      render();
    });
  }

  applyButton.addEventListener('click', async () => {
    if (saving || !canApply || candidateTheme === currentTheme) return;
    saving = true;
    feedback.textContent = '';
    render();
    try {
      const result = await desktopBridge.setClientTheme(candidateTheme);
      if (result?.ok !== true || !THEME_IDS.includes(result.themeId)) {
        throw new Error('Client theme was not saved');
      }
      currentTheme = result.themeId;
      candidateTheme = currentTheme;
      documentRef.documentElement.dataset.clientTheme = currentTheme;
      feedback.textContent = '配色已应用';
    } catch {
      feedback.textContent = '配色未保存，请重试';
    } finally {
      saving = false;
      render();
    }
  });

  if (!canApply) feedback.textContent = '请在桌面客户端设置配色。';
  render();
}
