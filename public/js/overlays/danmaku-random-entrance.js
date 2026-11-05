// The feed starts live entry after placement. This adapter latches the simple
// random styles' choices without changing the shared renderer source contract.
export function createRandomEntranceRenderer({ document, classNames }, render, defaults) {
  return (item = {}, index = 0) => {
    const node = render(item, index);
    const settings = document.body?.dataset || {};
    const mode = settings.entranceAnimation || 'fade';
    node.dataset.entranceAnimation = mode;
    node.style.setProperty('--random-enter-duration',
      `${Number(settings.entranceDurationMs) || (mode === 'rise' ? 500 : defaults.defaultEntranceMs || 200)}ms`);
    if (mode === 'rise') {
      const message = node.querySelector(`.${classNames.body} p`);
      const content = message?.querySelector('.draw-danmaku-gift-copy') || message;
      // Older shared renderers already wrap these three styles' message copy.
      if (content && !content.querySelector('.draw-danmaku-enter-content')) {
        const inner = document.createElement('span');
        inner.className = 'draw-danmaku-enter-content';
        inner.append(...content.childNodes);
        content.append(inner);
      }
    }
    return node;
  };
}
