// 大航海感谢粒子：只在一次播放内运行，按 1920×1080 设计坐标绘制；停止时释放动画帧并清空画布。
const TAU = Math.PI * 2;
export const PARTICLE_CANVAS = Object.freeze({ width: 1920, height: 1080 });

const random = (min, max) => min + Math.random() * (max - min);
const pick = (items) => items[Math.floor(Math.random() * items.length)];

function rgb(color) {
  const hex = String(color || '')
    .trim()
    .replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return [255, 255, 255];
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
}

function createGlowSprite(color) {
  const sprite = document.createElement('canvas');
  sprite.width = 64;
  sprite.height = 64;
  const context = sprite.getContext('2d');
  const [r, g, b] = rgb(color);
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.22, `rgba(${r},${g},${b},0.9)`);
  gradient.addColorStop(0.55, `rgba(${r},${g},${b},0.28)`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return sprite;
}

const BURST = {
  spark: () => ({ size: random(3, 6), drag: 2.2, gravity: 70, life: random(1, 1.7) }),
  star: () => ({ size: random(7, 14), drag: 2, gravity: 40, life: random(1.2, 1.9) }),
  bubble: () => ({ size: random(4, 10), drag: 2.6, gravity: -70, life: random(1.4, 2.2) }),
  confetti: () => ({ size: random(6, 9), drag: 1.5, gravity: 260, life: random(1.6, 2.4), flipRate: random(8, 14) }),
};

function spawnBurst(kind, origin, colors) {
  const angle = Math.random() * TAU;
  const ring = random(128, 154);
  const speed = random(260, 680);
  return {
    kind,
    x: origin.x + Math.cos(angle) * ring,
    y: origin.y + Math.sin(angle) * ring,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 80,
    age: 0,
    color: pick(colors),
    rotation: Math.random() * TAU,
    spin: random(-7, 7),
    phase: Math.random() * TAU,
    ...BURST[kind](),
  };
}

function spawnAmbient(kind, origin, colors) {
  const base = { kind, age: 0, vx: 0, vy: 0, drag: 0, gravity: 0, color: pick(colors), phase: Math.random() * TAU };
  if (kind === 'twinkle') {
    const angle = Math.random() * TAU;
    const radius = random(200, 440);
    return {
      ...base,
      x: origin.x + Math.cos(angle) * radius,
      y: origin.y + Math.sin(angle) * radius * 0.8,
      size: random(6, 13),
      life: random(0.9, 1.5),
      rotation: Math.random() * TAU,
      spin: random(-1, 1),
    };
  }
  if (kind === 'ember') {
    return {
      ...base,
      x: origin.x + random(-300, 300),
      y: origin.y + random(40, 260),
      vx: random(-12, 12),
      vy: random(-100, -45),
      size: random(2.5, 5),
      life: random(1.4, 2.4),
    };
  }
  return {
    ...base,
    kind: 'bubble',
    x: origin.x + random(-330, 330),
    y: origin.y + random(110, 280),
    vy: random(-110, -50),
    size: random(3, 8),
    life: random(1.8, 2.8),
  };
}

function smoothstep(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function alphaOf(particle) {
  const progress = particle.age / particle.life;
  if (particle.kind === 'twinkle') return Math.sin(Math.PI * progress);
  const envelope = Math.min(1, particle.age / 0.12) * (1 - smoothstep(0.5, 1, progress));
  if (particle.kind === 'star') return envelope * (0.65 + 0.35 * Math.sin(particle.age * 10 + particle.phase));
  if (particle.kind === 'ember') return envelope * (0.7 + 0.3 * Math.sin(particle.age * 18 + particle.phase));
  return envelope;
}

function starPath(context, size) {
  const inner = size * 0.3;
  context.beginPath();
  for (let index = 0; index < 8; index += 1) {
    const radius = index % 2 === 0 ? size : inner;
    const angle = (index * Math.PI) / 4;
    context.lineTo(Math.sin(angle) * radius, -Math.cos(angle) * radius);
  }
  context.closePath();
}

export function createGuardParticles(canvas) {
  const context = canvas?.getContext?.('2d') || null;
  const sprites = new Map();
  let frame = 0;
  let plan = null;
  let particles = [];
  let startedAt = 0;
  let lastAt = 0;
  let nextBurst = 0;
  let ambientCarry = 0;

  function sprite(color) {
    if (!sprites.has(color)) sprites.set(color, createGlowSprite(color));
    return sprites.get(color);
  }

  function draw(particle, alpha) {
    const { x, y, size } = particle;
    context.globalAlpha = Math.max(0, Math.min(1, alpha));
    if (particle.kind === 'confetti') {
      context.globalCompositeOperation = 'source-over';
      context.save();
      context.translate(x, y);
      context.rotate(particle.rotation);
      context.fillStyle = particle.color;
      const height = size * 1.7 * Math.abs(Math.cos(particle.age * particle.flipRate + particle.phase));
      context.fillRect(-size / 2, -height / 2, size, Math.max(1, height));
      context.restore();
      return;
    }
    if (particle.kind === 'bubble') {
      context.globalCompositeOperation = 'source-over';
      context.strokeStyle = particle.color;
      context.lineWidth = 1.6;
      context.beginPath();
      context.arc(x, y, size, 0, TAU);
      context.stroke();
      context.fillStyle = 'rgba(255,255,255,0.85)';
      context.beginPath();
      context.arc(x - size * 0.35, y - size * 0.35, Math.max(1, size * 0.22), 0, TAU);
      context.fill();
      return;
    }
    context.globalCompositeOperation = 'lighter';
    const glow = particle.kind === 'star' || particle.kind === 'twinkle' ? size * 3.2 : size * 6;
    context.drawImage(sprite(particle.color), x - glow / 2, y - glow / 2, glow, glow);
    if (particle.kind === 'star' || particle.kind === 'twinkle') {
      const scale = particle.kind === 'twinkle' ? Math.sin(Math.PI * (particle.age / particle.life)) : 1;
      context.save();
      context.translate(x, y);
      context.rotate(particle.rotation);
      context.fillStyle = '#ffffff';
      starPath(context, size * Math.max(0.2, scale));
      context.fill();
      context.restore();
    } else {
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(x, y, size * 0.45, 0, TAU);
      context.fill();
    }
  }

  function tick(now) {
    if (!plan) return;
    const dt = Math.min(0.05, (now - lastAt) / 1000);
    lastAt = now;
    const elapsed = now - startedAt;
    while (nextBurst < plan.bursts.length && plan.bursts[nextBurst].at <= elapsed) {
      const burst = plan.bursts[nextBurst];
      for (let index = 0; index < burst.count; index += 1) {
        particles.push(spawnBurst(burst.kinds[index % burst.kinds.length], plan.origin, plan.colors));
      }
      nextBurst += 1;
    }
    if (plan.ambient && elapsed >= plan.ambient.from && elapsed < plan.ambient.until) {
      ambientCarry += plan.ambient.rate * dt;
      for (; ambientCarry >= 1; ambientCarry -= 1) {
        particles.push(spawnAmbient(plan.ambient.kind, plan.origin, plan.colors));
      }
    }
    context.globalCompositeOperation = 'source-over';
    context.globalAlpha = 1;
    context.clearRect(0, 0, PARTICLE_CANVAS.width, PARTICLE_CANVAS.height);
    particles = particles.filter((particle) => {
      particle.age += dt;
      if (particle.age >= particle.life) return false;
      const damping = Math.exp(-particle.drag * dt);
      particle.vx *= damping;
      particle.vy = particle.vy * damping + particle.gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.kind === 'bubble') particle.x += Math.sin(particle.age * 3 + particle.phase) * 22 * dt;
      if (particle.spin) particle.rotation += particle.spin * dt;
      draw(particle, alphaOf(particle));
      return true;
    });
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    frame = elapsed < plan.endAt ? requestAnimationFrame(tick) : 0;
  }

  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    plan = null;
    particles = [];
    nextBurst = 0;
    ambientCarry = 0;
    context?.clearRect(0, 0, PARTICLE_CANVAS.width, PARTICLE_CANVAS.height);
  }

  function start(nextPlan) {
    stop();
    if (!context) return;
    plan = nextPlan;
    const resolution = Math.min(1.5, Math.max(0.3, nextPlan.resolution || 1));
    canvas.width = Math.round(PARTICLE_CANVAS.width * resolution);
    canvas.height = Math.round(PARTICLE_CANVAS.height * resolution);
    context.setTransform(resolution, 0, 0, resolution, 0, 0);
    startedAt = performance.now();
    lastAt = startedAt;
    frame = requestAnimationFrame(tick);
  }

  return { start, stop };
}
