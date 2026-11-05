const SVG_NS = 'http://www.w3.org/2000/svg';
const GUARDS = { 1: '总督', 2: '提督', 3: '舰长' };
const SHAPES = {
  speech: 'M20 3C9 3 4 11 4 24L4 69C4 84 12 90 28 90L24 99L48 91L76 91C89 91 96 83 96 69L96 24C96 10 88 3 74 3C56 1 38 1 20 3Z',
  box: 'M5 6L94 4L96 93L4 95Z',
  burst: 'M6 5L16 8L20 2L29 7L35 3L42 8L50 2L57 7L65 3L72 8L82 3L85 9L95 5L92 16L99 22L93 30L98 39L92 47L99 55L92 64L97 74L91 81L95 94L84 91L78 98L70 92L61 97L53 91L44 98L36 92L27 97L20 91L7 95L10 83L2 77L8 69L3 59L9 51L2 43L8 34L3 24L9 18Z',
};
let clipSequence = 0;

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function paper(document, shape) {
  const ink = element(document, 'div', 'comic-ink');
  ink.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'comic-frame');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  const defs = document.createElementNS(SVG_NS, 'defs');
  const clip = document.createElementNS(SVG_NS, 'clipPath');
  const clipId = `comic-paper-${++clipSequence}`;
  clip.setAttribute('id', clipId);
  clip.setAttribute('clipPathUnits', 'objectBoundingBox');
  const silhouette = document.createElementNS(SVG_NS, 'path');
  silhouette.setAttribute('d', SHAPES[shape]);
  silhouette.setAttribute('transform', 'scale(.01)');
  clip.append(silhouette);
  const mask = document.createElementNS(SVG_NS, 'mask');
  const traceId = `${clipId}-trace`;
  mask.setAttribute('id', traceId);
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('x', '-5');
  mask.setAttribute('y', '-5');
  mask.setAttribute('width', '110');
  mask.setAttribute('height', '110');
  const trace = document.createElementNS(SVG_NS, 'path');
  trace.setAttribute('class', 'comic-trace');
  trace.setAttribute('d', SHAPES[shape]);
  trace.setAttribute('pathLength', '1');
  trace.setAttribute('fill', 'none');
  trace.setAttribute('stroke', 'white');
  trace.setAttribute('stroke-width', '8');
  mask.append(trace);
  defs.append(clip, mask);
  const fill = document.createElementNS(SVG_NS, 'path');
  fill.setAttribute('class', 'comic-paper');
  fill.setAttribute('d', SHAPES[shape]);
  const outline = document.createElementNS(SVG_NS, 'path');
  outline.setAttribute('class', 'comic-outline');
  outline.setAttribute('d', SHAPES[shape]);
  outline.setAttribute('mask', `url(#${traceId})`);
  outline.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(defs, fill, outline);
  const texture = element(document, 'span', 'comic-texture');
  texture.style.setProperty('clip-path', `url(#${clipId})`);
  ink.append(svg, texture);
  return ink;
}

function mixedShape(item) {
  let hash = 2166136261;
  for (const character of [item.id, item.uid, item.timestamp, item.name, item.message].join('|')) {
    hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
  }
  return ['speech', 'box', 'speech', 'burst'][(hash >>> 0) % 4];
}

function amount(value) {
  return Number.isFinite(value) && value >= 0
    ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
}

// Recompose the shared safe message nodes. Placement, expiry and cleanup remain in the feed.
export function createComicMessageRenderer(options, render) {
  const { document, classNames } = options;
  return (item = {}, index = 0) => {
    const settings = document.body?.dataset || {};
    const sc = item.kind === 'superchat';
    const gift = item.kind === 'gift';
    const guard = GUARDS[Number(item.roomGuardLevel)] ? Number(item.roomGuardLevel) : 0;
    const boughtGuard = gift && GUARDS[Number(item.giftGuardLevel)] ? Number(item.giftGuardLevel) : 0;
    const medal = item.roomMedal;
    const hasMedal = Number.isSafeInteger(medal?.level) && medal.level > 0;
    const root = render({ ...item, kind: sc ? 'danmaku' : item.kind,
      guardLevel: guard, medalName: hasMedal ? String(medal.name || '') : '',
      medalLevel: hasMedal ? medal.level : 0, emotes: sc ? [] : item.emotes }, index);
    const body = root.querySelector(`.${classNames.body}`);
    const heading = body.children[0];
    const copy = body.children[1];
    const avatar = root.querySelector(`.${classNames.avatar}`);
    const chosen = Object.hasOwn(SHAPES, settings.comicShape) ? settings.comicShape : mixedShape(item);
    root.dataset.comicShape = sc ? 'burst' : gift ? 'box' : chosen;
    root.dataset.comicKind = sc ? 'sc' : boughtGuard ? 'member' : gift ? 'gift' : 'chat';
    root.dataset.comicEntrance = settings.comicEntrance || 'pop';
    root.classList.add('comic-item');
    root.style.setProperty('--danmaku-delay', '0ms');
    root.style.setProperty('--comic-enter-duration', `${Number(settings.comicEntranceMs) || 420}ms`);
    body.classList.add('comic-content');
    heading.classList.add('comic-heading');
    heading.children[0].classList.add('comic-name');
    copy.classList.add('comic-copy');
    if (avatar) {
      avatar.classList.add('comic-avatar');
      heading.replaceChildren(avatar, ...heading.children);
    }
    if (guard || hasMedal) {
      const role = element(document, 'span', 'comic-role', GUARDS[guard] || `${medal.name || '粉丝'} ${medal.level}`);
      if (hasMedal) role.title = `${medal.name || '粉丝'} ${medal.level}`;
      heading.append(role);
    }
    if (gift) {
      copy.querySelector('.draw-danmaku-gift-art')?.remove();
      copy.querySelector('.draw-danmaku-gift-amount')?.remove();
      if (boughtGuard) {
        copy.querySelector('.draw-danmaku-gift-action').textContent = item.guardAction === 'open' ? '开通 '
          : item.guardAction === 'renew' ? '续费 ' : '支持 ';
        copy.querySelector('.draw-danmaku-gift-name').textContent = GUARDS[boughtGuard];
      }
    }
    if (sc) {
      root.classList.add('is-superchat');
      copy.textContent = String(item.message ?? '');
      root.setAttribute('aria-label', `醒目留言，${amount(item.price)}`);
    }
    if (gift || sc) {
      const footer = element(document, 'div', 'comic-footer');
      footer.append(element(document, 'span', 'comic-event', sc ? '醒目留言' : boughtGuard ? '大航海' : '礼物'),
        element(document, 'b', 'comic-amount', amount(sc ? item.price : item.giftTotalPrice)));
      body.append(footer);
    }
    const surface = element(document, 'div', 'comic-surface');
    surface.append(paper(document, root.dataset.comicShape), body);
    root.replaceChildren(surface);
    return root;
  };
}
