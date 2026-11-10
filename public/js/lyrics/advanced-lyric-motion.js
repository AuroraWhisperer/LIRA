const REST = 'translate(0, 0) rotate(0deg) scale(1, 1)';
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';

function transform(x = 0, y = 0, rotation = 0, scaleX = 1, scaleY = scaleX) {
  return `translate(${x}em, ${y}em) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`;
}

export function advancedLyricKeyframes(kind, name, amount = 1, ordinal = 0, color = '') {
  const a = Math.max(0, amount);
  if (kind === 'enter') {
    const from = { opacity: 0, transform: REST };
    switch (name) {
      case 'rise': from.transform = transform(0, 0.65 * a); break;
      case 'drop': from.transform = transform(0, -0.8 * a); break;
      case 'slide-left': from.transform = transform(-1.5 * a); break;
      case 'slide-right': from.transform = transform(1.5 * a); break;
      case 'pop': return [from, { opacity: 1, transform: transform(0, 0, 0, 1 + 0.1 * a), offset: 0.72 }, { opacity: 1, transform: REST }].map((frame, index) => index === 0 ? { ...frame, transform: transform(0, 0, 0, Math.max(0.1, 1 - 0.7 * a)) } : frame);
      case 'zoom': from.transform = transform(0, 0, 0, 1 + 0.65 * a); break;
      case 'rotate': from.transform = transform(-0.15 * a, 0.3 * a, -24 * a, Math.max(0.2, 1 - 0.3 * a)); break;
      case 'flip': return [{ opacity: 0, transform: `perspective(600px) rotateX(${80 * a}deg)` }, { opacity: 1, transform: 'perspective(600px) rotateX(0deg)' }];
      case 'wipe': return [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }];
      case 'scatter': {
        const angle = (ordinal * 2.399963 + 0.8);
        from.transform = transform(Math.cos(angle) * 1.8 * a, Math.sin(angle) * 1.2 * a, Math.sin(angle) * 38 * a, 0.6);
        break;
      }
      case 'stretch': from.transform = transform(0, 0, 0, 1 + 1.2 * a, Math.max(0.2, 1 - 0.6 * a)); break;
      case 'focus': return [{ opacity: 0, transform: transform(0, 0, 0, 1 + 0.22 * a), filter: `blur(${0.16 * a}em)` },
        { opacity: 1, transform: REST, filter: 'blur(0em)' }];
    }
    return [from, { opacity: 1, transform: REST }];
  }
  if (kind === 'exit') {
    const to = { opacity: 0, transform: REST };
    switch (name) {
      case 'rise': to.transform = transform(0, -0.6 * a); break;
      case 'drop': to.transform = transform(0, 0.8 * a); break;
      case 'shrink': to.transform = transform(0, 0, 0, Math.max(0.05, 1 - 0.85 * a)); break;
      case 'zoom': to.transform = transform(0, 0, 0, 1 + 0.7 * a); break;
      case 'scatter': {
        const angle = ordinal * 2.399963 + 0.8;
        to.transform = transform(Math.cos(angle) * 2 * a, Math.sin(angle) * 1.5 * a, Math.cos(angle) * 45 * a, 1.15);
        break;
      }
      case 'wipe': return [{ clipPath: 'inset(0 0% 0 0)' }, { clipPath: 'inset(0 0% 0 100%)' }];
      case 'squeeze': to.transform = transform(0, 0, 0, 1 + 0.5 * a, Math.max(0.02, 1 - 0.95 * a)); break;
      case 'defocus': return [{ opacity: 1, transform: REST, filter: 'blur(0em)' },
        { opacity: 0, transform: transform(0, 0, 0, 1 + 0.12 * a), filter: `blur(${0.18 * a}em)` }];
    }
    return [{ opacity: 1, transform: REST }, to];
  }
  if (kind === 'hold') {
    const rest = { transform: REST };
    switch (name) {
      case 'float': return [rest, { transform: transform(0, -0.12 * a) }, rest];
      case 'breathe': return [rest, { transform: transform(0, 0, 0, 1 + 0.035 * a) }, rest];
      case 'wave': return [rest, { transform: transform(0, -0.1 * a, -1.5 * a) }, { transform: transform(0, 0.08 * a, 1.5 * a) }, rest];
      case 'sway': return [{ transform: transform(0, 0, -1.6 * a) }, { transform: transform(0, 0, 1.6 * a) }, { transform: transform(0, 0, -1.6 * a) }];
      case 'drift': return [rest, { transform: transform(0.18 * a, -0.035 * a) }, rest];
      case 'pulse': return [rest, { transform: transform(0, 0, 0, 1 + 0.055 * a), offset: 0.18 }, rest, rest];
      case 'shimmer': return [{ filter: 'brightness(1)' }, { filter: `brightness(${1 + 0.35 * a})` }, { filter: 'brightness(1)' }];
      default: return null;
    }
  }
  if (kind === 'word') {
    const rest = { transform: REST };
    switch (name) {
      case 'pop': return [rest, { transform: transform(0, -0.04 * a, 0, 1 + 0.2 * a) }, rest];
      case 'rise': return [rest, { transform: transform(0, -0.18 * a) }, rest];
      case 'bounce': return [rest, { transform: transform(0, -0.22 * a), offset: 0.3 }, { transform: transform(0, 0.035 * a), offset: 0.7 }, rest];
      case 'wave': return [rest, { transform: transform(0, -0.1 * a, -7 * a) }, { transform: transform(0, 0.05 * a, 5 * a) }, rest];
      case 'tilt': return [rest, { transform: transform(0, -0.04 * a, (ordinal % 2 ? 1 : -1) * 11 * a) }, rest];
      case 'glow': {
        // Brightness alone is invisible on near-white text; the halo uses the accent.
        const halo = color ? ` drop-shadow(0 0 ${0.18 * a}em ${color})` : '';
        const off = color ? ' drop-shadow(0 0 0em transparent)' : '';
        return [{ filter: `brightness(1)${off}` }, { filter: `brightness(${1 + 0.7 * a})${halo}` }, { filter: `brightness(1)${off}` }];
      }
      default: return null;
    }
  }
  return null;
}

export function advancedLyricWordAnimation(name, { startMs, endMs, lineEndMs, timed = false, amount = 1, ordinal = 0, color = '' }) {
  if (![startMs, endMs, lineEndMs, amount].every(Number.isFinite)
    || endMs <= startMs || lineEndMs <= startMs || amount <= 0 || name === 'sustain' && !timed) return null;
  const span = endMs - startMs;
  if (name === 'focus') {
    // Unsung glyphs wait out of focus; each sharpens as its own interval begins.
    const soft = Math.min(0.11, 0.06 * amount);
    return { startMs, endMs: Math.min(lineEndMs, startMs + Math.max(160, Math.min(600, span))), easing: EASE_OUT, frames: [
      { filter: `blur(${soft}em)`, opacity: 0.55, transform: transform(0, 0, 0, 1 + 0.06 * amount) },
      { filter: 'blur(0em)', opacity: 1, transform: REST }] };
  }
  let frames;
  if (name === 'sustain') {
    const strength = amount * Math.min(1, span / 850);
    const rest = { transform: REST, filter: 'brightness(1)' };
    frames = [rest, { transform: transform(0, -0.09 * strength, 0, 1 + 0.08 * strength),
      filter: `brightness(${1 + 0.24 * strength})` }, rest];
  } else frames = advancedLyricKeyframes('word', name, amount, ordinal, color);
  if (!frames) return null;
  if (name !== 'sustain' && (!timed || span <= 650 || !['pop', 'rise', 'tilt', 'glow'].includes(name))) {
    return { frames, startMs, endMs: Math.min(lineEndMs, startMs + Math.min(650, Math.max(220, span + 120))), easing: 'ease-in-out' };
  }
  // Sustain belongs to the supplied vocal interval. The release only uses time
  // after its end, and never steals time from a note cut by the line boundary.
  const sungDuration = Math.min(endMs, lineEndMs) - startMs;
  const finish = Math.min(lineEndMs, endMs + 180);
  const duration = finish - startMs;
  const attack = Math.min(180, sungDuration * 0.25);
  return { startMs, endMs: finish, easing: 'linear', frames: [
    { ...frames[0], offset: 0, easing: EASE_OUT },
    { ...frames[1], offset: attack / duration, easing: 'linear' },
    { ...frames[1], offset: sungDuration / duration, easing: 'ease-in-out' },
    { ...frames.at(-1), offset: 1 },
  ] };
}

function applyStaticFrame(entry, frame, state) {
  if (entry.state === state) return;
  entry.animation?.cancel();
  entry.animation = null;
  entry.state = state;
  for (const [key, value] of Object.entries(frame)) {
    if (key !== 'offset' && key !== 'easing') entry.element.style[key] = value;
  }
}

// The host owns the clock and calls sync. WAAPI may interpolate between host
// frames, but never owns playback position or schedules JavaScript work here.
export function createAdvancedLyricMotion() {
  const entries = [];
  return {
    add(element, frames, { startMs, endMs, duration, loop = false, easing = EASE_OUT } = {}) {
      if (!frames || !element) return;
      const entry = { element, frames, startMs, endMs, duration: Math.max(1, duration || endMs - startMs), loop, easing, animation: null, state: '' };
      entries.push(entry);
      applyStaticFrame(entry, frames[0], 'before');
    },
    sync({ currentMs, playing = false, discontinuity = false, playbackRate = 1 }) {
      const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
      for (const entry of entries) {
        if (currentMs < entry.startMs) {
          applyStaticFrame(entry, entry.frames[0], 'before');
          continue;
        }
        if (currentMs >= entry.endMs) {
          applyStaticFrame(entry, entry.frames.at(-1), 'after');
          continue;
        }
        if (typeof entry.element.animate !== 'function') {
          applyStaticFrame(entry, entry.frames.at(-1), 'fallback');
          continue;
        }
        const time = Math.max(0, currentMs - entry.startMs);
        if (!entry.animation) {
          entry.animation = entry.element.animate(entry.frames, { duration: entry.duration,
            iterations: entry.loop ? Infinity : 1, fill: 'both', easing: entry.easing });
          entry.animation.pause();
          entry.state = 'active';
        }
        const animation = entry.animation;
        const rateChanged = animation.playbackRate !== rate;
        if (rateChanged) animation.playbackRate = rate;
        if (!playing && animation.playState !== 'paused') animation.pause();
        if (discontinuity || rateChanged || !playing || animation.playState !== 'running' || animation.currentTime === null
          || Math.abs(Number(animation.currentTime) - time) > 120) animation.currentTime = time;
        if (playing && animation.playState !== 'running') animation.play();
      }
    },
    suspend() {
      for (const entry of entries) {
        entry.animation?.cancel();
        entry.animation = null;
        entry.state = '';
      }
    },
    clear() {
      for (const entry of entries) entry.animation?.cancel();
      entries.length = 0;
    },
  };
}
