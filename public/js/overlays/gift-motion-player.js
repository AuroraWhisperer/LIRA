import { createGiftDropWorld } from '../shared/gift-drop-physics.js';
import { GIFT_MOTION_EFFECTS, readGiftMotionSettings } from '../shared/gift-motion-settings.js';
import { setGiftImage } from '../shared/gift-image-fallback.js';

const WIDTH = 1920; const HEIGHT = 1080;
const SVG = 'http://www.w3.org/2000/svg';

function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function createGiftMotionPlayer({ root }) {
  const stage = element('div', 'gift-motion-stage'); root.append(stage);
  const dropWorld = createGiftDropWorld();
  const drops = new Map(); const swings = new Map(); const seen = new Set();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame; let previous; let disposed = false;
  const resize = new ResizeObserver(() => {
    const scale = Math.min(root.clientWidth / WIDTH, root.clientHeight / HEIGHT);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  });
  resize.observe(root);

  function image(payload, className) {
    const image = element('img', className); image.alt = ''; image.draggable = false;
    const source = String(payload.artworkPath || '');
    setGiftImage(image, /^\/(?:overtime-gift-images\/[\w.-]+\.webp|img\/(?:admin\/gifts\/bilibili-guard-[\w-]+\.webp|overlays\/gift-feed\/(?:flower|cheer|call)\.webp))$/.test(source)
      && !source.includes('..') ? source : '');
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
      node.style.transform = `translate(${body.x - body.half}px, ${body.y - body.half}px) rotate(${body.angle}rad)`;
      node.style.opacity = Math.min(1, (body.expiresAt - now) / 600);
    }
    for (const [id, swing] of swings) {
      if (now >= swing.expiresAt) { swing.node.remove(); swings.delete(id); continue; }
      // Independent spring states; later cards do not restart an existing card.
      const steps = Math.max(1, Math.ceil(elapsed * 120 * swing.motionSpeed)); const dt = elapsed / steps;
      for (let step = 0; step < steps; step++) {
        const age = (now - swing.startedAt) / 1000;
        const target = reduced.matches ? 0 : Math.sin(age * 3.8 * swing.motionSpeed + swing.phase) * swing.angle * 0.24;
        const motionDt = dt * swing.motionSpeed;
        swing.speed += ((target - swing.rotation) * 90 - swing.speed * 5) * motionDt;
        swing.rotation += swing.speed * motionDt;
        swing.liftSpeed += (-swing.lift * 150 - swing.liftSpeed * 12) * dt;
        swing.lift += swing.liftSpeed * dt;
      }
      const angle = reduced.matches ? 0 : swing.rotation;
      const radians = angle * Math.PI / 180;
      const dx = Math.sin(radians) * swing.size * 0.48;
      const dy = Math.abs(angle) * 0.35 + (reduced.matches ? 0 : swing.lift);
      swing.card.style.transform = `translate(${dx}px, ${dy}px) rotate(${angle}deg)`;
      swing.rod.setAttribute('d', `M ${swing.size / 2} ${swing.size + 52} Q ${swing.size / 2 + dx * 0.2} ${swing.size + 24} ${swing.size / 2 + dx} ${swing.size - 8 + dy}`);
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
    if (expiresAt <= now) return false;
    seen.add(payload.eventId);
    if (seen.size > 2048) seen.delete(seen.values().next().value);
    const event = { ...payload, startedAt, motion, num: Math.max(1, Number(payload.num) || 1) };
    if (effect.style === 'gift-drop') {
      for (const body of dropWorld.addGift(event, now)) {
        if (reduced.matches) { body.angle = 0; body.spin = 0; body.vx = 0; }
        const node = element('div', 'gift-drop-item');
        node.dataset.motionId = body.id; node.dataset.expiresAt = String(body.expiresAt);
        node.style.width = node.style.height = `${body.size}px`;
        node.append(image(payload, 'gift-motion-image'));
        if (body.quantity > 1) node.append(element('span', 'gift-motion-count', `×${body.quantity}`));
        stage.append(node); drops.set(body.id, node);
      }
    } else {
      if (swings.size >= 80) return false;
      const size = motion.size; const slotWidth = size + 44;
      const columns = Math.max(1, Math.floor(WIDTH / slotWidth));
      const occupied = new Set([...swings.values()].map(swing => swing.slot));
      let slot = 0; while (occupied.has(slot)) slot++;
      const node = element('div', 'gift-swing-item');
      node.dataset.motionId = payload.eventId; node.dataset.expiresAt = String(expiresAt);
      node.style.width = `${size}px`; node.style.height = `${size + 60}px`;
      node.style.left = `${(WIDTH - columns * slotWidth) / 2 + (slot % columns) * slotWidth + 22}px`;
      node.style.bottom = '8px';
      const svg = document.createElementNS(SVG, 'svg'); svg.setAttribute('viewBox', `0 0 ${size} ${size + 60}`);
      const rod = document.createElementNS(SVG, 'path'); svg.append(rod); node.append(svg);
      const card = element('div', 'gift-swing-card');
      if (motion.textMode !== 'none') {
        const caption = element('div', 'gift-swing-caption');
        if (motion.textMode === 'full') caption.append(element('span', 'gift-swing-name', payload.userName || '观众'));
        caption.append(element('span', 'gift-swing-detail', `${payload.giftName || '礼物'} ×${event.num}`));
        card.append(caption);
      }
      card.append(image(payload, 'gift-motion-image')); node.append(card, element('div', 'gift-swing-base'));
      stage.append(node);
      swings.set(payload.eventId, { node, card, rod, slot, size, expiresAt, startedAt,
        angle: motion.angle, motionSpeed: motion.speed / 100, rotation: motion.angle * (slot % 2 ? -1 : 1), speed: 0,
        lift: reduced.matches ? 0 : 45, liftSpeed: -180, phase: slot * 1.7 });
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
    disposed = true; clear(); seen.clear(); resize.disconnect(); stage.remove();
    document.removeEventListener('visibilitychange', visibility);
  } };
}
