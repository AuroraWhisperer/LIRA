// The shared renderer owns message content; this adapter only adds the local star artwork.
export function createStartrailMessageRenderer({ document, classNames }, render) {
  return (item = {}, index = 0) => {
    const node = render(item, index);
    if (item.kind === 'superchat') return node;
    node.dataset.startrailEntrance = document.body?.dataset?.startrailEntrance || 'spark';
    // Keep a later duration edit from restarting a message's completed entrance.
    node.style.setProperty('--startrail-entry-duration',
      document.documentElement?.style.getPropertyValue('--startrail-entry-duration') || '680ms');
    // Gifts keep their safe name/count DOM, while using this style's text-only silhouette.
    node.classList.remove('is-gift');
    const body = node.querySelector(`.${classNames.body}`);
    const entry = document.createElement('div');
    entry.className = 'startrail-entry';
    const head = document.createElement('span');
    head.className = 'startrail-head';
    head.setAttribute('aria-hidden', 'true');
    for (const name of ['halo', 'star']) {
      const part = document.createElement('span');
      part.className = `startrail-${name}`;
      head.append(part);
    }
    const tail = document.createElement('span');
    tail.className = 'startrail-tail';
    tail.setAttribute('aria-hidden', 'true');
    const dust = document.createElement('span');
    dust.className = 'startrail-dust';
    for (let dustIndex = 0; dustIndex < 3; dustIndex += 1) dust.append(document.createElement('i'));
    tail.append(dust);
    entry.append(head, body, tail);
    node.replaceChildren(entry);
    return node;
  };
}
