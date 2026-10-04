// 大航海感谢粒子：只在一次播放内运行，按 1920×1080 设计坐标绘制；停止时释放动画帧并清空画布。
// 经典风格使用 spark/star/bubble/confetti；辉光风格（plan.soft）使用 mote/halo/blade/ 光尘与汇聚。
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

function createGlowSprite(color, soft = false) {
  const sprite = document.createElement('canvas');
  sprite.width = 64;
  sprite.height = 64;
  const context = sprite.getContext('2d');
  const [r, g, b] = rgb(color);
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  // 柔和版去掉锐利白核：以颜色本身为最亮点，边缘缓慢衰减。
  gradient.addColorStop(0, soft ? `rgba(${r},${g},${b},0.9)` : 'rgba(255,255,255,1)');
  gradient.addColorStop(0.22, `rgba(${r},${g},${b},${soft ? 0.5 : 0.9})`);
  gradient.addColorStop(0.55, `rgba(${r},${g},${b},${soft ? 0.16 : 0.28})`);
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
  // 辉光风格：柔光尘缓慢上浮、柔斑几乎不下坠、光羽横向懒散飘移。
  // 柔斑（halo）尺寸刻意压小：它是氛围点，不能盖住纹章与文字。
  mote: () => ({ size: random(4, 9), drag: 0.85, gravity: -26, life: random(2.6, 4.2) }),
  halo: () => ({ size: random(7, 15), drag: 1.1, gravity: -10, life: random(2.2, 3.4) }),
  blade: () => ({ size: random(9, 18), drag: 0.7, gravity: -14, life: random(2.4, 3.6) }),
  petal: () => ({ size: random(9, 17), drag: 0.9, gravity: 34, life: random(2.8, 4.4), flipRate: random(2, 4) }),
  // 汇聚：从外圈向中心收拢，由 update 中的向心加速度驱动。
  converge: () => ({ size: random(6, 15), drag: 0.5, gravity: 0, life: random(1.5, 2.1), converge: true }),
};

function spawnBurst(kind, origin, colors, spread = 1) {
  const angle = Math.random() * TAU;
  const ring = random(128, 154) * spread;
  const speed = random(260, 680) * spread;
  const spec = BURST[kind]();
  if (spec.converge) {
    // 汇聚粒子落在同一圆环上，速度朝圆心。
    return {
      kind,
      x: origin.x + Math.cos(angle) * ring * 2.8,
      y: origin.y + Math.sin(angle) * ring * 2.8,
      vx: -Math.cos(angle) * speed * 0.7,
      vy: -Math.sin(angle) * speed * 0.7,
      color: pick(colors),
      age: 0,
      rotation: angle,
      spin: random(-2, 2),
      phase: Math.random() * TAU,
      ...spec,
    };
  }
  return {
    kind,
    x: origin.x + Math.cos(angle) * ring,
    y: origin.y + Math.sin(angle) * ring,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - 80 * spread,
    age: 0,
    color: pick(colors),
    rotation: Math.random() * TAU,
    spin: random(-7, 7),
    phase: Math.random() * TAU,
    ...spec,
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
  // 辉光风格的柔光尘：从画面下半部缓慢上浮，横向极轻微的摆动。
  if (kind === 'mote') {
    return {
      ...base,
      x: origin.x + random(-520, 520),
      y: origin.y + random(120, 420),
      vx: random(-16, 16),
      vy: random(-56, -22),
      size: random(4, 12),
      life: random(3.4, 5.6),
    };
  }
  // 环绕轨道光点：沿椭圆轨道漂浮，由 update 中的 orbit 分支驱动。
  if (kind === 'orbit') {
    const angle = Math.random() * TAU;
    return {
      ...base,
      orbit: true,
      x: origin.x + Math.cos(angle) * 360,
      y: origin.y + Math.sin(angle) * 250,
      angle,
      radiusX: random(320, 400),
      radiusY: random(210, 280),
      angularSpeed: random(0.16, 0.3) * (Math.random() < 0.5 ? -1 : 1),
      size: random(5, 11),
      life: random(3.2, 4.8),
    };
  }
  if (kind === 'petal') {
    return {
      ...base,
      x: origin.x + random(-420, 420),
      y: origin.y - random(120, 380),
      vx: random(-22, 22),
      vy: random(26, 58),
      size: random(8, 16),
      life: random(3.6, 5.4),
      rotation: Math.random() * TAU,
      spin: random(-0.9, 0.9),
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
  // 柔和粒子用整条正弦包络，没有生硬的出现与消失。
  if (particle.soft) return Math.sin(Math.PI * progress) * 0.92;
  if (particle.kind === 'converge') return envelope * (0.7 + 0.3 * Math.sin(particle.age * 12 + particle.phase));
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

  function sprite(color, soft) {
    const key = `${soft ? 's' : 'h'}:${color}`;
    if (!sprites.has(key)) sprites.set(key, createGlowSprite(color, soft));
    return sprites.get(key);
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
    // 辉光风格：全部走柔和 sprite，且只做低透明度叠加，不画任何白色实心核。
    if (particle.soft) {
      context.globalCompositeOperation = 'lighter';
      const scale = particle.kind === 'halo' ? 3.6 : particle.kind === 'petal' ? 3.4 : 4;
      const glow = size * scale;
      context.drawImage(sprite(particle.color, true), x - glow / 2, y - glow / 2, glow, glow);
      if (particle.kind === 'blade') {
        // 光羽：一段横向细长柔光，随生命周期缓慢伸展。
        const length = size * 3.4;
        context.save();
        context.translate(x, y);
        context.rotate(particle.rotation * 0.25);
        const streak = context.createLinearGradient(-length / 2, 0, length / 2, 0);
        streak.addColorStop(0, 'rgba(255,255,255,0)');
        streak.addColorStop(0.5, 'rgba(255,255,255,0.5)');
        streak.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = streak;
        context.fillRect(-length / 2, -Math.max(1, size * 0.14) / 2, length, Math.max(1, size * 0.14));
        context.restore();
      }
      if (particle.kind === 'petal') {
        // 金箔/花瓣：小片状，随光翻转。
        context.save();
        context.translate(x, y);
        context.rotate(particle.rotation);
        const height = size * 1.3 * Math.abs(Math.cos(particle.age * particle.flipRate + particle.phase));
        context.fillStyle = 'rgba(255,255,255,0.42)';
        context.fillRect(-size / 2, -height / 2, size, Math.max(1, height));
        context.restore();
      }
      return;
    }
    context.globalCompositeOperation = 'lighter';
    const glow = particle.kind === 'star' || particle.kind === 'twinkle' ? size * 3.2 : size * 6;
    context.drawImage(sprite(particle.color, false), x - glow / 2, y - glow / 2, glow, glow);
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
      const origin = burst.origin || plan.origin;
      for (let index = 0; index < burst.count; index += 1) {
        particles.push(spawnBurst(burst.kinds[index % burst.kinds.length], origin, plan.colors, burst.spread ?? 1));
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
      if (particle.orbit) {
        particle.angle += particle.angularSpeed * dt;
        particle.x = plan.origin.x + Math.cos(particle.angle) * particle.radiusX;
        particle.y = plan.origin.y + Math.sin(particle.angle) * particle.radiusY;
        draw(particle, alphaOf(particle));
        return true;
      }
      const damping = Math.exp(-particle.drag * dt);
      if (particle.converge) {
        // 向心加速度：逐渐加速收拢，临近中心时自然融进光晕。
        const dx = plan.origin.x - particle.x;
        const dy = plan.origin.y - particle.y;
        const distance = Math.max(24, Math.hypot(dx, dy));
        particle.vx += (dx / distance) * 460 * dt;
        particle.vy += (dy / distance) * 460 * dt;
      }
      particle.vx *= damping;
      particle.vy = particle.vy * damping + particle.gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      if (particle.kind === 'bubble') particle.x += Math.sin(particle.age * 3 + particle.phase) * 22 * dt;
      if (particle.soft) particle.x += Math.sin(particle.age * 0.9 + particle.phase) * 9 * dt;
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
