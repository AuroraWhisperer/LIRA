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
  let frame; let previous; let disposed = false;
  const resize = new ResizeObserver(() => {
    const scale = Math.min(root.clientWidth / WIDTH, root.clientHeight / HEIGHT);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    swingStage.style.transform = `translateX(-50%) scale(${root.clientWidth / WIDTH})`;
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

  function tick(time) {
    frame = null;
    const now = Date.now(); const elapsed = Math.max(0, Math.min((time - previous) / 1000, 0.05)); previous = time;
    dropWorld.step(elapsed, now);
    const alive = new Set(dropWorld.bodies.map(body => body.id));
    for (const [id, node] of drops) if (!alive.has(id)) { node.remove(); drops.delete(id); }
    for (const body of dropWorld.bodies) {
      if (reduced.matches) { body.angle = 0; body.spin = 0; body.vx = 0; }
      const node = drops.get(body.id);
      node.hidden = now < body.spawnAt;
      if (node.hidden) continue;
      if (!reduced.matches || now < body.expiresAt) {
        node.style.transform = `translate(${body.x - body.size / 2}px, ${body.y - body.size / 2}px) rotate(${body.angle}rad)`;
      }
      node.style.opacity = Math.min(1, (body.expiresAt + GIFT_DROP_EXIT_MS - now) / GIFT_DROP_EXIT_MS);
    }
    for (const [id, swing] of swings) {
      if (now >= swing.expiresAt) { swing.node.remove(); swings.delete(id); continue; }
      // Keep each card's rhythm and amplitude constant throughout its lifetime.
      const age = (now - swing.startedAt) / 1000;
      const angle = reduced.matches ? 0 : Math.cos(age * 3.8 * swing.motionSpeed + swing.phase) * swing.angle;
      swing.node.style.transform = `rotate(${angle}deg)`;
      swing.node.style.opacity = Math.min(1, (swing.expiresAt - now) / 600, (now - swing.startedAt) / 200);
    }
    if (drops.size || swings.size) frame = requestAnimationFrame(tick);
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
    const expiresAt = startedAt + motion.durationSeconds * 1000;
    if (effect.style !== 'gift-drop' && expiresAt <= now) return false;
    seen.add(payload.eventId);
    if (seen.size > 2048) seen.delete(seen.values().next().value);
    const event = { ...payload, startedAt, motion, num: Math.max(1, Number(payload.num) || 1) };
    if (effect.style === 'gift-drop') {
      const added = dropWorld.addGift(event, now);
      if (!added.length) return false;
      for (const body of added) {
        if (reduced.matches) { body.angle = 0; body.spin = 0; body.vx = 0; }
        const node = element('div', 'gift-drop-item');
        node.hidden = true;
        node.dataset.motionId = body.id; node.dataset.expiresAt = String(body.expiresAt);
        node.style.width = node.style.height = `${body.size}px`;
        node.append(image(payload, 'gift-motion-image'));
        if (body.quantity > 1) node.append(element('span', 'gift-motion-count', `×${body.quantity}`));
        stage.append(node); drops.set(body.id, node);
      }
    } else {
      if (swings.size >= 80) return false;
      const size = motion.size;
      const margin = Math.max(size, 190) / 2 + (size + 125) * Math.sin(motion.angle * Math.PI / 180);
      const node = element('div', 'gift-swing-item');
      node.dataset.motionId = payload.eventId; node.dataset.expiresAt = String(expiresAt);
      node.style.width = `${size}px`; node.style.height = `${size + 60}px`;
      node.style.left = `${margin - size / 2 + Math.random() * (WIDTH - margin * 2)}px`;
      node.style.bottom = '0';
      const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', `0 0 ${size} ${size + 60}`);
      const rod = document.createElementNS(SVG, 'path');
      rod.setAttribute('d', `M ${size / 2} ${size + 60} L ${size / 2} ${size / 2}`);
      svg.append(rod); node.append(svg);
      const card = element('div', 'gift-swing-card');
      const textParts = GIFT_SWING_TEXT_MODES[motion.textMode];
      if (textParts.length) {
        const caption = element('div', 'gift-swing-caption');
        if (textParts.includes('userName')) caption.append(element('span', 'gift-swing-name', payload.userName || '观众'));
        const detail = [textParts.includes('giftName') ? payload.giftName || '礼物' : '',
          textParts.includes('quantity') ? `×${event.num}` : ''].filter(Boolean).join(' ');
        if (detail) caption.append(element('span', 'gift-swing-detail', detail));
        card.append(caption);
      }
      card.append(image(payload, 'gift-motion-image')); node.append(card);
      swingStage.append(node);
      swings.set(payload.eventId, { node, expiresAt, startedAt,
        angle: motion.angle, motionSpeed: motion.speed / 100,
        phase: Math.random() * Math.PI * 2 });
    }
    start(); return true;
  }

  function clear() {
    cancelAnimationFrame(frame); frame = null;
    for (const node of drops.values()) node.remove();
    for (const swing of swings.values()) swing.node.remove();
    drops.clear(); swings.clear(); dropWorld.clear();
  }
  function visibility() {
    cancelAnimationFrame(frame); frame = null;
    if (!document.hidden) start();
  }
  document.addEventListener('visibilitychange', visibility);
  return { enqueue, clear, dispose() {
    disposed = true; clear(); seen.clear(); resize.disconnect(); stage.remove(); swingStage.remove();
    document.removeEventListener('visibilitychange', visibility);
  } };
}
