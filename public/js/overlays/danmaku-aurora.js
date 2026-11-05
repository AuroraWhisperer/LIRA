// Original pearl-paper artwork; the shared renderer still owns safe text and emotes.
export function createAuroraMessageRenderer({ document }, render) {
  function decoration(className) {
    const node = document.createElement('span');
    node.className = className;
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  return (item = {}, index = 0) => {
    const card = render(item, index);
    if (item.kind === 'superchat') return card;
    card.classList.add('aurora-card');
    card.classList.remove('is-gift');
    card.dataset.kind = item.kind || 'danmaku';
    card.dataset.auroraEntrance = document.body?.dataset?.auroraEntrance || 'layered';
    card.style.setProperty('--aurora-entry-duration',
      document.documentElement?.style.getPropertyValue('--aurora-entry-duration') || '520ms');
    card.style.setProperty('--aurora-phase', `${-(index % 7) * 0.8}s`);
    const body = card.querySelector('.draw-danmaku-body');
    if (item.kind === 'gift' && [1, 2, 3].includes(item.giftGuardLevel)) {
      body.querySelector('.draw-danmaku-gift-action').textContent =
        ({ open: '开通', renew: '续费' })[item.guardAction] || '支持';
    }
    const arrival = document.createElement('div');
    arrival.className = 'aurora-arrival';
    arrival.append(decoration('aurora-paper'), decoration('aurora-pin'), body, decoration('aurora-charm'));
    card.append(arrival);
    return card;
  };
}
