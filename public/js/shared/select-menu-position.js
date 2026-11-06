export function positionSelectMenu(state) {
  const { trigger, menu } = state;
  const edge = 12;
  const gap = 6;
  const rect = trigger.getBoundingClientRect();
  state.anchorRect = rect;
  menu.style.setProperty('--select-trigger-width', `${rect.width}px`);
  menu.style.maxHeight = '';
  menu.style.maxWidth = '';
  menu.style.maxWidth = `${Math.min(menu.offsetWidth, window.innerWidth - edge * 2)}px`;
  const below = window.innerHeight - rect.bottom - gap - edge;
  const above = rect.top - gap - edge;
  const opensAbove = menu.offsetHeight > below && above > below;
  menu.style.maxHeight = `${Math.max(0, Math.min(menu.offsetHeight, opensAbove ? above : below))}px`;
  menu.style.left = `${Math.max(edge, Math.min(rect.left, window.innerWidth - menu.offsetWidth - edge))}px`;
  menu.style.top = `${Math.max(edge, opensAbove ? rect.top - gap - menu.offsetHeight : rect.bottom + gap)}px`;
  state.wrapper.classList.toggle('is-above', opensAbove);
}
