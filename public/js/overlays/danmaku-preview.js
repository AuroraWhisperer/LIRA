export function initDanmakuPreview({ initialStyle, renderSamples }) {
  const controls = document.getElementById('danmakuPreviewControls');
  const buttons = Array.from(controls.querySelectorAll('[data-preview-style]'));
  const description = document.getElementById('danmakuPreviewDescription');
  controls.hidden = false;

  function selectStyle(value) {
    const selected = buttons.find((button) => button.dataset.previewStyle === value)
      || buttons.find((button) => button.dataset.previewStyle === 'signal');
    const style = selected.dataset.previewStyle;
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button === selected));
    }
    description.textContent = `${selected.querySelector('small').textContent} · 6 条静态示例，可向下滚动`;
    window.history.replaceState(
      { ...window.history.state, danmakuPreviewStyle: style },
      '',
      `${window.location.pathname}?preview=1`,
    );
    renderSamples(style);
    document.getElementById('danmakuPreviewViewport').scrollTop = 0;
  }

  for (const button of buttons) {
    button.addEventListener('click', () => selectStyle(button.dataset.previewStyle));
  }
  selectStyle(initialStyle || window.history.state?.danmakuPreviewStyle || 'signal');
}
