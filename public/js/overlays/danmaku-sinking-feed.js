import { componentEffectBounds, componentEffectProfiles, effectTransform } from './component-effect-filters.js';
import { DEFAULT_DANMAKU_CLASSES, createDanmakuMessageRenderer } from './danmaku-message-renderer.js';
import { FULLSCREEN_SAFE_INSET_PX, findRandomDanmakuPosition } from './danmaku-random-position.js';

const DEFAULTS = { sinkingDurationSeconds: 10, sinkingTravel: 24, sinkingSway: 18, sinkingBubbleDensity: 50 };
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const p = clamp(value); return p * p * p * (p * (p * 6 - 15) + 10); };
const entranceSeconds = duration => Math.min(1.6, duration * 0.22);
const exitSeconds = duration => Math.min(2.3, duration * 0.25);

function messageRandom(item) {
  let seed = 2166136261;
  for (const character of [item.id, item.uid, item.timestamp, item.message].join('|')) {
    seed = Math.imul(seed ^ character.codePointAt(0), 16777619);
  }
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822519);
    seed = Math.imul(seed ^ (seed >>> 13), 3266489917);
    return ((seed ^ (seed >>> 16)) >>> 0) / 4294967296;
  };
}

// Preserve the approved low/middle range; smoothly reach three times the old 100 setting.
function bubbleRate(density) {
  return 40 * (density / 100) ** 2.25 * (1 + 2 * smooth((density - 50) / 50));
}

// A sinking card reserves its entire path, including entry drift, until it expires.
export function createSinkingDanmakuFeed(root, options = {}) {
  const document = root.ownerDocument;
  const view = document.defaultView;
  const classNames = { ...DEFAULT_DANMAKU_CLASSES, ...options.classNames };
  const createMessage = createDanmakuMessageRenderer({ ...options, document, classNames, fullscreen: true, showAvatar: false });
  const now = options.now || (() => Date.now());
  const maxItems = options.maxItems || 50;
  const reduced = view.matchMedia('(prefers-reduced-motion: reduce)');
  let settings = { ...DEFAULTS, ...options.sinkingOptions };
  let entries = [];
  let sequence = 0;
  let frame = null;
  let nextAdmission = 0;
  let disposed = false;
  const bubbles = document.createElement('div');
  bubbles.className = 'sinking-bubbles';
  bubbles.setAttribute('aria-hidden', 'true');
  root.replaceChildren(bubbles);
  root.dataset.layout = 'sinking';
  const observer = new ResizeObserver(layout);
  observer.observe(root);
  view.addEventListener('lira:effects-updated', layout);
  reduced.addEventListener('change', motionChanged);

  function poseAt(entry, age) {
    const progress = clamp(age / entry.duration);
    const arrival = entry.live ? smooth(age / (reduced.matches ? 0.2 : entranceSeconds(entry.duration))) : 1;
    const exitTime = reduced.matches ? 0.35 : exitSeconds(entry.duration);
    const departure = smooth((age - entry.duration + exitTime) / exitTime);
    const theta = age * Math.PI * 2 / entry.period + entry.phase;
    const current = reduced.matches ? 0 : Math.sin(theta) * entry.amplitude;
    const carry = reduced.matches ? 0 : entry.side * entry.carry * Math.exp(-age / 0.65);
    const recede = reduced.matches ? 0 : entry.side * 6 * departure;
    const depth = reduced.matches ? 0 : 0.62 * progress + 0.16 * (1 - Math.exp(-age / 0.6)) + 0.22 * departure;
    return {
      x: entry.x + current + carry + recede,
      y: entry.y + entry.travel * depth,
      opacity: Math.pow(arrival, 0.8) * (1 - departure),
      blur: reduced.matches ? 0 : 2.8 * (1 - arrival) ** 2 + 2.2 * departure ** 2,
      depth: reduced.matches ? 0 : -45 * (1 - arrival) - 80 * departure,
      pitch: reduced.matches ? 0 : 18 * (1 - arrival) - 12 * departure,
      yaw: reduced.matches ? 0 : entry.side * (7 * (1 - arrival) - 9 * departure),
      angle: reduced.matches ? 0 : Math.sin(theta + 0.5) * entry.tilt + entry.side * (2.8 * (1 - arrival) - 2.1 * departure),
      arrival, departure, progress,
    };
  }

  function clearBubbles(entry) {
    entry.bubbles.forEach(bubble => bubble.node.remove());
    entry.bubbles = [];
  }

  function addBubbles(entry, offset = 0) {
    if (reduced.matches || offset >= entry.duration - exitSeconds(entry.duration)) return;
    const rate = bubbleRate(settings.sinkingBubbleDensity);
    const count = Math.min(390, Math.ceil(rate * 3.25));
    const random = messageRandom({ ...entry.item, id: `${entry.item.id}:${entry.generation++}` });
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < count; index += 1) {
      const node = document.createElement('i');
      node.className = 'sinking-bubble';
      const size = 2.2 + random() ** 0.8 * 6.3;
      node.style.width = `${size}px`;
      node.style.height = `${size}px`;
      fragment.append(node);
      const edge = random();
      entry.bubbles.push({ node, first: offset + (index + 0.2 + random() * 0.6) / rate,
        period: count / rate, life: 2 + random() * 1.2, stopAt: entry.duration - exitSeconds(entry.duration) + 0.15,
        x: edge < 0.28 ? -size * 0.6 : edge < 0.56 ? entry.width - size * 0.4 : random() * entry.width,
        y: edge < 0.56 ? entry.height * (0.18 + random() * 0.65) : 1 + random() * 8,
        velocity: 20 + size * 4.5, drift: (random() - 0.5) * 13,
        phase: random() * Math.PI * 2, opacity: 0.4 + random() * 0.4 });
    }
    bubbles.append(fragment);
  }

  function drawBubbles(entry, age) {
    for (const bubble of entry.bubbles) {
      const cycle = Math.floor((Math.min(age, bubble.stopAt) - bubble.first) / bubble.period);
      const birth = bubble.first + Math.max(0, cycle) * bubble.period;
      const life = Math.min(bubble.life, entry.duration - birth - 0.02);
      const bubbleAge = age - birth;
      if (cycle < 0 || bubbleAge < 0 || bubbleAge >= life || life <= 0) {
        if (bubble.visible) bubble.node.style.opacity = '0';
        bubble.visible = false;
        continue;
      }
      // Birth position stays fixed within a cycle; layout changes invalidate it.
      if (bubble.birth !== birth || !bubble.origin) {
        bubble.birth = birth;
        bubble.origin = poseAt(entry, birth);
        bubble.sinPhase ??= Math.sin(bubble.phase);
      }
      const origin = bubble.origin;
      const rise = bubble.velocity * (bubbleAge - 0.35 * (1 - Math.exp(-bubbleAge / 0.35)));
      const wobble = (Math.sin(bubble.phase + bubbleAge * 2.4) - bubble.sinPhase) * 3;
      const opacity = bubble.opacity * smooth(bubbleAge / 0.25) * (1 - smooth((bubbleAge - life + 0.9) / 0.9));
      bubble.visible = true;
      bubble.node.style.opacity = opacity.toFixed(3);
      bubble.node.style.transform = `translate(${origin.x + (bubble.x + wobble + bubble.drift * bubbleAge) * entry.scale}px, ${origin.y + (bubble.y - rise) * entry.scale}px) scale(${entry.scale * (0.78 + 0.22 * smooth(bubbleAge / 0.3))})`;
    }
  }

  function removeEntry(entry, notify = true) {
    clearBubbles(entry);
    observer.unobserve(entry.node);
    entry.node.remove();
    entries = entries.filter(current => current !== entry);
    if (notify) options.onRemove?.(entry.item);
  }

  function place(entry, time) {
    const inset = FULLSCREEN_SAFE_INSET_PX;
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (width <= inset * 2 || height <= inset * 2) return false;
    const bounds = componentEffectBounds(entry.node, entry.node.offsetWidth, entry.node.offsetHeight);
    const scale = Math.min(1, (width - inset * 2) / (bounds.width + 64), (height - inset * 2) / (bounds.height + 20));
    const cardWidth = bounds.width * scale;
    const cardHeight = bounds.height * scale;
    const amplitude = reduced.matches ? 0 : Math.min(entry.sway * width / 1920, 18) * scale;
    const carry = reduced.matches ? 0 : Math.min(18, cardWidth * 0.06);
    const travel = reduced.matches ? 0 : Math.min(height * entry.distance / 100, Math.max(0, height - cardHeight - inset * 2 - 20));
    const marginX = amplitude + carry + 6 * scale;
    const box = { width: cardWidth + marginX * 2, height: cardHeight + travel + 20 * scale };
    const occupied = entries.filter(other => other !== entry && other.startedAt !== undefined)
      .map(other => ({ ...other.position, ...other.box }));
    const position = findRandomDanmakuPosition({ entry, ...box }, width, height, occupied);
    if (!position) return false;
    entry.position = position;
    entry.box = box;
    entry.x = position.left + marginX - bounds.x * scale;
    entry.y = position.top + 10 * scale - bounds.y * scale;
    entry.width = entry.node.offsetWidth;
    entry.height = entry.node.offsetHeight;
    entry.scale = scale;
    entry.travel = travel;
    entry.amplitude = amplitude;
    entry.carry = carry;
    for (const bubble of entry.bubbles) bubble.origin = null;
    if (entry.startedAt === undefined) {
      entry.startedAt = entry.live ? time : entry.snapshotAt;
      entry.node.style.visibility = 'visible';
      addBubbles(entry);
    }
    return true;
  }

  function draw() {
    const time = now();
    for (const entry of [...entries]) {
      if (entry.startedAt === undefined) {
        if (time - entry.queuedAt >= 2000 || !entry.live && time - entry.snapshotAt >= entry.duration * 1000) {
          removeEntry(entry);
          continue;
        }
        if (time < nextAdmission) continue;
        const placed = place(entry, time);
        nextAdmission = time + (placed ? 180 : 100);
        if (!placed) continue;
      }
      const age = Math.max(0, (time - entry.startedAt) / 1000);
      if (age >= entry.duration) { removeEntry(entry); continue; }
      const pose = poseAt(entry, age);
      const effect = effectTransform(componentEffectProfiles.get(entry.node)?.transform);
      entry.node.style.transform = `translate(${pose.x}px, ${pose.y}px) scale(${entry.scale}) ${effect}`;
      entry.panel.style.transform = `perspective(800px) translateZ(${pose.depth}px) rotateX(${pose.pitch}deg) rotateY(${pose.yaw}deg) rotateZ(${pose.angle}deg)`;
      entry.node.style.opacity = pose.opacity.toFixed(4);
      entry.panel.style.filter = pose.blur < 0.015 ? 'none' : `blur(${pose.blur.toFixed(3)}px)`;
      entry.node.dataset.progress = pose.progress.toFixed(3);
      if (entry.arrival !== pose.arrival || entry.departure !== pose.departure) {
        entry.arrival = pose.arrival;
        entry.departure = pose.departure;
        entry.surface.style.setProperty('--water-light-x', `${-25 + pose.arrival * 50}%`);
        entry.surface.style.setProperty('--water-light-opacity', String(Math.sin(pose.arrival * Math.PI) * 0.35));
        entry.surface.style.setProperty('--water-depth', `${(1 - pose.arrival) * 10 + pose.departure * 24}%`);
      }
      drawBubbles(entry, age);
    }
  }

  function tick() {
    frame = null;
    if (disposed) return;
    draw();
    wake();
  }

  function wake() {
    if (!disposed && frame === null && entries.length) frame = view.requestAnimationFrame(tick);
  }

  function layout() {
    if (disposed) return;
    const time = now();
    for (const entry of entries) if (entry.startedAt !== undefined) place(entry, time);
    draw();
    wake();
  }

  function motionChanged() {
    for (const entry of entries) {
      clearBubbles(entry);
      if (entry.startedAt !== undefined) addBubbles(entry, Math.max(0, (now() - entry.startedAt) / 1000));
    }
    layout();
  }

  function add(item, live) {
    const time = now();
    const duration = settings.sinkingDurationSeconds;
    const snapshotAt = Number(item.timestamp) || time;
    if (!live && time - snapshotAt >= duration * 1000) return;
    const random = messageRandom(item);
    const node = createMessage(item, sequence++);
    node.style.visibility = 'hidden';
    const entry = { node, item, live, queuedAt: time, snapshotAt, duration,
      distance: settings.sinkingTravel, sway: settings.sinkingSway,
      tilt: Math.min(0.38, settings.sinkingSway / 18 * 0.38), phase: random() * Math.PI * 2,
      period: 6.5 + random() * 2.5, side: random() > 0.5 ? 1 : -1, bubbles: [], generation: 0,
      panel: node.querySelector('.sinking-panel'), surface: node.querySelector('.sinking-surface') };
    entries.push(entry);
    root.append(node);
    observer.observe(node);
    while (entries.length > maxItems) removeEntry(entries[0]);
  }

  function appendBatch(items, live = true) {
    for (const item of items) add(item, live);
    draw();
    wake();
  }

  function clear() {
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    for (const entry of [...entries]) removeEntry(entry, false);
    nextAdmission = 0;
  }

  return {
    append: item => appendBatch([item]),
    appendBatch,
    render(items) { clear(); appendBatch((Array.isArray(items) ? items : []).slice(-maxItems), false); },
    remove(ids) {
      const removed = new Set(ids);
      for (const entry of [...entries]) if (removed.has(entry.item.id) || removed.has(entry.item.messageId)) removeEntry(entry);
      draw();
    },
    setSinkingOptions(value) {
      const densityChanged = value.sinkingBubbleDensity !== settings.sinkingBubbleDensity;
      settings = { ...DEFAULTS, ...value };
      if (densityChanged) motionChanged();
    },
    destroy() {
      disposed = true;
      observer.disconnect();
      view.removeEventListener('lira:effects-updated', layout);
      reduced.removeEventListener('change', motionChanged);
      clear();
      bubbles.remove();
      delete root.dataset.layout;
    },
  };
}
