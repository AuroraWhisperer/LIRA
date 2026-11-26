import { createGiftDropWorld, GIFT_DROP_EXIT_MS } from '../shared/gift-drop-physics.js';
import { GIFT_MOTION_EFFECTS, GIFT_SWING_TEXT_MODES, readGiftMotionSettings } from '../shared/gift-motion-settings.js';
import { setGiftArtwork } from '../shared/gift-image.js';

const WIDTH = 1920; const HEIGHT = 1080;
const SVG = 'http://www.w3.org/2000/svg';

function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function createGiftMotionPlayer({ root }) {
  const stage = element('div', 'gift-motion-stage');
  const swingStage = element('div', 'gift-motion-stage gift-swing-stage'); root.append(stage, swingStage);
  const dropWorld = createGiftDropWorld();
  const drops = new Map(); const swings = new Map(); const seen = new Set();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame; let previous; let disposed = false; let swingHeight = HEIGHT;
  const resize = new ResizeObserver(() => {
    const scale = Math.min(root.clientWidth / WIDTH, root.clientHeight / HEIGHT);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    const swingScale = root.clientWidth / WIDTH;
    swingStage.style.transform = `translateX(-50%) scale(${swingScale})`;
    swingHeight = swingScale ? root.clientHeight / swingScale : HEIGHT;
    for (const swing of swings.values()) swing.bounds = swingBounds(swing);
  });
  resize.observe(root);

  function image(payload, className) {
    const image = element('img', className); image.alt = ''; image.draggable = false;
    const source = String(payload.artworkPath || '');
    const path = /^\/(?:overtime-gift-images\/[\w.-]+\.(?:webp|png|jpe?g|gif)|img\/(?:admin\/gifts\/bilibili-guard-[\w-]+\.webp|overlays\/gift-feed\/(?:flower|cheer|call)\.webp))$/.test(source)
      && !source.includes('..') ? source : '';
    setGiftArtwork(image, path, { format: 'static', mimeType: 'image/webp' });
    return image;
  }

  function start() {
    if (frame || disposed || document.hidden || !drops.size && !swings.size) return;
    previous = performance.now(); frame = requestAnimationFrame(tick);
  }

  function pruneDrops() {
    const alive = new Set(dropWorld.bodies.map(body => body.id));
    for (const [id, drop] of drops) if (!alive.has(id)) { drop.node.remove(); drops.delete(id); }
  }

  function pruneExpiredSwings(now) {
    for (const [id, swing] of swings) {
      if (now < swing.expiresAt) continue;
      swing.node.remove();
      swings.delete(id);
    }
  }

  function tick(time) {
    frame = null;
    const now = Date.now(); const elapsed = Math.max(0, Math.min((time - previous) / 1000, 0.05)); previous = time;
    dropWorld.step(elapsed, now);
    pruneDrops();
    for (const body of dropWorld.bodies) {
      if (reduced.matches) { body.angle = 0; body.spin = 0; body.vx = 0; }
      const drop = drops.get(body.id); const { node, artwork } = drop;
      node.hidden = !body.spawned || now >= body.expiresAt && !drop.shown;
      if (node.hidden) continue;
      if (body.entered && !artwork.hidden && artwork.complete && artwork.naturalWidth) drop.shown = true;
      if (!reduced.matches || now < body.expiresAt) {
        node.style.transform = `translate(${body.x - body.size / 2}px, ${body.y - body.size / 2}px) rotate(${body.angle}rad)`;
      }
      node.style.opacity = Math.min(1, (body.expiresAt + GIFT_DROP_EXIT_MS - now) / GIFT_DROP_EXIT_MS);
    }
    pruneExpiredSwings(now);
    for (const swing of swings.values()) {
      let angle = 0; let lift = 0;
      if (!reduced.matches) {
        const step = elapsed * swing.motionSpeed * Math.PI * 2;
        swing.phase = (swing.phase + step / 0.96) % (Math.PI * 2);
        swing.bobPhase = (swing.bobPhase + step / 0.74) % (Math.PI * 2);
        const { tilt, low, high } = swing.bounds;
        // Rocking and extension have separate phases, so each pass rises and falls differently.
        angle = Math.sin(swing.phase) * tilt * swing.amplitude * 180 / Math.PI;
        lift = low + (high - low) * (1 + Math.sin(swing.bobPhase)) / 2 - swing.rodLength;
      }
      swing.node.style.transform = `rotate(${angle}deg)`;
      swing.svg.style.transform = `scaleY(${1 + lift / swing.rodLength})`;
      swing.card.style.transform = `translateY(${-lift}px)`;
      swing.node.style.opacity = Math.min(1, (swing.expiresAt - now) / 600, (now - swing.startedAt) / 200);
    }
    if (drops.size || swings.size) frame = requestAnimationFrame(tick);
  }

  function swingBounds(swing) {
    const half = swing.size / 2;
    const travel = Math.min(swing.rodLength * 0.3, Math.max(0, swingHeight - swing.size - swing.captionHeight) / 4);
    let tilt = swing.angle * Math.PI / 180;
    let low; let high;
    for (let attempt = 0; attempt < 12; attempt++) {
      const imageReach = half * (Math.cos(tilt) + Math.sin(tilt));
      const captionTilt = Math.min(tilt, Math.atan2(95, half + swing.captionHeight));
      const top = swing.captionHeight ? Math.max(imageReach,
        (half + swing.captionHeight) * Math.cos(captionTilt) + 95 * Math.sin(captionTilt)) : imageReach;
      low = Math.max(swing.rodLength * 0.8, (imageReach + 2) / Math.cos(tilt));
      high = Math.min(swingHeight - top - 2, swing.rodLength * 1.8);
      if (high - low >= travel || attempt === 11) break;
      tilt *= 0.8;
    }
    return { tilt, low, high: Math.max(low, high) };
  }

  function swingPosition(margin) {
    const active = [...swings.values()];
    let spaces = [[margin, WIDTH - margin]];
    for (const swing of active) {
      const left = swing.x - swing.margin - margin - 24;
      const right = swing.x + swing.margin + margin + 24;
      spaces = spaces.flatMap(([start, end]) => {
        if (right <= start || left >= end) return [[start, end]];
        return [[start, Math.min(end, left)], [Math.max(start, right), end]]
          .filter(([from, to]) => to > from);
      });
    }
    let offset = Math.random() * spaces.reduce((total, [start, end]) => total + end - start, 0);
    for (const [start, end] of spaces) {
      if (offset <= end - start) return start + offset;
      offset -= end - start;
    }
    // A crowded stage keeps every gift; prefer the least crowded random candidate.
    let position = margin; let bestClearance = -Infinity;
    for (let attempt = 0; attempt < 32; attempt++) {
      const x = margin + Math.random() * (WIDTH - margin * 2);
      const clearance = Math.min(...active.map(swing => Math.abs(x - swing.x) - swing.margin - margin));
      if (clearance > bestClearance) { position = x; bestClearance = clearance; }
    }
    return position;
  }

  function enqueue(payload) {
    const effect = GIFT_MOTION_EFFECTS.find(effect => effect.style === payload.themeId);
    if (!effect || disposed || seen.has(payload.eventId)) return false;
    const now = Date.now();
    const startedAt = Number(payload.startedAt ?? (payload.preview ? now : NaN));
    if (!Number.isFinite(startedAt)) return false;
    const settings = Object.fromEntries(Object.keys(effect.fields).map(name =>
      [`${effect.prefix}${name}`, payload.motion?.[name[0].toLowerCase() + name.slice(1)]]));
    const motion = readGiftMotionSettings(settings, effect);
    if (effect.style === 'gift-drop' && payload.motion?.count == null && payload.motion?.quantityMultiplier != null) {
      delete motion.count;
      motion.quantityMultiplier = payload.motion.quantityMultiplier;
    }
    const expiresAt = startedAt + motion.durationSeconds * 1000;
    if (expiresAt <= now) return false;
    seen.add(payload.eventId);
    if (seen.size > 2048) seen.delete(seen.values().next().value);
    const event = { ...payload, startedAt, motion, num: Math.max(1, Number(payload.num) || 1) };
    if (effect.style === 'gift-drop') {
      const added = dropWorld.addGift(event, now);
      pruneDrops();
      if (!added.length) return false;
      for (const body of added) {
        if (reduced.matches) { body.angle = 0; body.spin = 0; body.vx = 0; }
        const node = element('div', 'gift-drop-item');
        node.hidden = true;
        node.dataset.motionId = body.id; node.dataset.expiresAt = String(body.expiresAt);
        node.style.width = node.style.height = `${body.size}px`;
        const artwork = image(payload, 'gift-motion-image'); node.append(artwork);
        if (body.quantity > 1) node.append(element('span', 'gift-motion-count', `×${body.quantity}`));
        stage.append(node); drops.set(body.id, { node, artwork, shown: false });
      }
    } else {
      pruneExpiredSwings(now);
      if (swings.size >= 80) return false;
      const size = motion.size;
      const textParts = GIFT_SWING_TEXT_MODES[motion.textMode];
      const rodLength = size / 2 + 60;
      const margin = Math.max(size, textParts.length ? 190 : 0) / 2
        + (size + 60 + (textParts.length ? 65 : 0) + rodLength * 0.8) * Math.sin(motion.angle * Math.PI / 180);
      const x = swingPosition(margin);
      const node = element('div', 'gift-swing-item');
      node.dataset.motionId = payload.eventId; node.dataset.expiresAt = String(expiresAt);
      node.style.width = `${size}px`; node.style.height = `${size + 60}px`;
      node.style.left = `${x - size / 2}px`;
      node.style.bottom = '0';
      const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', `0 0 ${size} ${size + 60}`);
      const rod = document.createElementNS(SVG, 'path');
      rod.setAttribute('d', `M ${size / 2} ${size + 60} L ${size / 2} ${size / 2}`);
      svg.append(rod); node.append(svg);
      const card = element('div', 'gift-swing-card');
      let caption;
      if (textParts.length) {
        caption = element('div', 'gift-swing-caption');
        if (textParts.includes('userName')) caption.append(element('span', 'gift-swing-name', payload.userName || '观众'));
        const detail = [textParts.includes('giftName') ? payload.giftName || '礼物' : '',
          textParts.includes('quantity') ? `×${event.num}` : ''].filter(Boolean).join(' ');
        if (detail) caption.append(element('span', 'gift-swing-detail', detail));
        card.append(caption);
      }
      card.append(image(payload, 'gift-motion-image')); node.append(card);
      swingStage.append(node);
      const swing = { node, svg, card, x, margin, rodLength, size,
        captionHeight: caption ? caption.offsetHeight + 11 : 0, expiresAt, startedAt,
        angle: motion.angle, motionSpeed: motion.speed / 100 * (0.85 + Math.random() * 0.3),
        phase: Math.random() * Math.PI * 2, bobPhase: Math.random() * Math.PI * 2,
        amplitude: 0.78 + Math.random() * 0.22 };
      swing.bounds = swingBounds(swing); swings.set(payload.eventId, swing);
    }
    start(); return true;
  }

  function clear() {
    cancelAnimationFrame(frame); frame = null;
    for (const { node } of drops.values()) node.remove();
    for (const swing of swings.values()) swing.node.remove();
    drops.clear(); swings.clear(); dropWorld.clear(); seen.clear();
  }
  function visibility() {
    cancelAnimationFrame(frame); frame = null;
    if (!document.hidden) start();
  }
  document.addEventListener('visibilitychange', visibility);
  return { enqueue, clear, dispose() {
    disposed = true; clear(); resize.disconnect(); stage.remove(); swingStage.remove();
    document.removeEventListener('visibilitychange', visibility);
  } };
}
