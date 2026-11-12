// A bounded rigid-body world for gift artwork. Wall-clock expiry is independent
// of simulation steps, so removing a support always releases the stack above it.
export const MAX_GIFT_DROP_BODIES = 400;
export const GIFT_DROP_EXIT_MS = 600;
export const GIFT_DROP_SPAWN_DELAY_MS = 2000;
const FIXED_STEP = 1 / 120;

function support(body, nx, ny) {
  const c = body.cosine; const s = body.sine;
  const ux = c * nx + s * ny; const uy = -s * nx + c * ny;
  const x = Math.abs(ux) < 0.001 ? 0 : Math.sign(ux) * body.half;
  const y = Math.abs(uy) < 0.001 ? 0 : Math.sign(uy) * body.half;
  return [body.x + c * x - s * y, body.y + s * x + c * y];
}

function collide(a, b) {
  const extent = a.extent + b.extent;
  if (Math.abs(b.x - a.x) > extent || Math.abs(b.y - a.y) > extent) return;
  const ac = a.cosine; const as = a.sine;
  const bc = b.cosine; const bs = b.sine;
  let depth = Infinity; let nx; let ny;
  for (const [x, y] of [[ac, as], [-as, ac], [bc, bs], [-bs, bc]]) {
    const distance = (b.x - a.x) * x + (b.y - a.y) * y;
    const radiusA = a.half * (Math.abs(ac * x + as * y) + Math.abs(-as * x + ac * y));
    const radiusB = b.half * (Math.abs(bc * x + bs * y) + Math.abs(-bs * x + bc * y));
    const overlap = radiusA + radiusB - Math.abs(distance);
    if (overlap <= 0) return;
    if (overlap < depth) { depth = overlap; nx = distance < 0 ? -x : x; ny = distance < 0 ? -y : y; }
  }
  const pa = support(a, nx, ny); const pb = support(b, -nx, -ny);
  return { nx, ny, depth, x: (pa[0] + pb[0]) / 2, y: (pa[1] + pb[1]) / 2 };
}

function impulse(a, b, nx, ny, x, y) {
  const ax = x - a.x; const ay = y - a.y;
  const bx = b ? x - b.x : 0; const by = b ? y - b.y : 0;
  const vx = (b ? b.vx - b.spin * by : 0) - (a.vx - a.spin * ay);
  const vy = (b ? b.vy + b.spin * bx : 0) - (a.vy + a.spin * ax);
  const speed = vx * nx + vy * ny;
  if (speed >= 0) return;
  const crossA = ax * ny - ay * nx; const crossB = bx * ny - by * nx;
  const divisor = 1 + (b ? 1 : 0) + crossA ** 2 * a.invInertia + (b ? crossB ** 2 * b.invInertia : 0);
  const bounce = b ? Math.min(a.bounce, b.bounce) : a.bounce;
  const force = -(speed < -100 ? 1 + bounce : 1) * speed / divisor;
  const tx = -ny; const ty = nx;
  const tangentA = ax * ty - ay * tx; const tangentB = bx * ty - by * tx;
  const frictionDivisor = 1 + (b ? 1 : 0) + tangentA ** 2 * a.invInertia + (b ? tangentB ** 2 * b.invInertia : 0);
  const friction = Math.max(-force * 0.5, Math.min(force * 0.5, -(vx * tx + vy * ty) / frictionDivisor));
  const ix = force * nx + friction * tx; const iy = force * ny + friction * ty;
  a.vx -= ix; a.vy -= iy; a.spin -= (ax * iy - ay * ix) * a.invInertia;
  if (b) { b.vx += ix; b.vy += iy; b.spin += (bx * iy - by * ix) * b.invInertia; }
}

function walls(body, width, height) {
  for (const [nx, ny, edge] of [[-1, 0, 0], [1, 0, width], [0, 1, height]]) {
    const [x, y] = support(body, nx, ny);
    const depth = nx ? (x - edge) * nx : y - edge;
    if (depth <= 0) continue;
    body.x -= nx * depth; body.y -= ny * depth;
    impulse(body, null, nx, ny, x, y);
  }
}

function pairs(bodies, size) {
  const cells = new Map(); const result = [];
  // At most 400 bodies: index + 1 safely marks each body's visited neighbours.
  const found = new Uint16Array(bodies.length);
  for (let index = 0; index < bodies.length; index++) {
    const body = bodies[index]; const radius = body.half * Math.SQRT2;
    const minX = Math.floor((body.x - radius) / size); const maxX = Math.floor((body.x + radius) / size);
    const minY = Math.floor((body.y - radius) / size); const maxY = Math.floor((body.y + radius) / size);
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
      const key = `${x}:${y}`;
      const cell = cells.get(key) || [];
      for (const other of cell) if (found[other] !== index + 1) { result.push(bodies[other], body); found[other] = index + 1; }
      cell.push(index); cells.set(key, cell);
    }
  }
  return result;
}

export function createGiftDropWorld({ width = 1920, height = 1080, random = Math.random } = {}) {
  let bodies = []; let remainder = 0;
  return {
    get bodies() { return bodies; },
    addGift(event, now) {
      const size = event.motion.size;
      const collisionSize = size * 0.8;
      const motionSpeed = (event.motion.speed ?? 100) / 100;
      const bounce = (event.motion.bounce ?? 18) / 100;
      const multiplier = event.motion.quantityMultiplier ?? 8;
      const expiresAt = event.startedAt + event.motion.durationSeconds * 1000;
      if (expiresAt + GIFT_DROP_SPAWN_DELAY_MS <= now) return [];
      // Large combos keep their true quantity on the last representative image.
      // Existing gifts are never evicted early to make room for a newer gift.
      const count = Math.min(event.num * multiplier, 60 * multiplier, MAX_GIFT_DROP_BODIES - bodies.length);
      const added = [];
      for (let index = 0; index < count; index++) {
        const delay = random() * GIFT_DROP_SPAWN_DELAY_MS;
        if (expiresAt + delay <= now) continue;
        const body = { id: `${event.eventId}:${index}`, eventId: event.eventId,
          quantity: index === count - 1 ? Math.max(1, event.num - Math.ceil(count / multiplier) + 1) : 1,
          size, half: collisionSize / 2, invInertia: 6 / (collisionSize * collisionSize), motionSpeed, bounce,
          spawnAt: event.startedAt + delay, expiresAt: expiresAt + delay,
          x: size + random() * (width - size * 2), y: -size / 2,
          vx: (random() - 0.5) * 160 * motionSpeed, vy: (80 + random() * 80) * motionSpeed,
          angle: (random() - 0.5) * Math.PI, spin: (random() - 0.5) * 3 * motionSpeed };
        bodies.push(body); added.push(body);
      }
      return added;
    },
    step(elapsed, now) {
      bodies = bodies.filter(body => body.expiresAt + GIFT_DROP_EXIT_MS > now);
      const active = bodies.filter(body => body.spawnAt <= now);
      // Expired gifts fall through the floor and release the stack while fading.
      const collidable = active.filter(body => body.expiresAt > now);
      remainder += Math.max(0, Math.min(elapsed, 1 / 15));
      while (remainder >= FIXED_STEP) {
        remainder -= FIXED_STEP;
        for (const body of active) {
          if (body.expiresAt <= now) body.vy = Math.max(0, body.vy);
          body.vy += 1500 * body.motionSpeed ** 2 * FIXED_STEP;
          body.vx *= 0.999; body.spin *= 0.998;
          body.x += body.vx * FIXED_STEP; body.y += body.vy * FIXED_STEP;
          body.angle += body.spin * FIXED_STEP;
          // Collision impulses change spin, but orientation stays fixed during the solver iterations.
          body.cosine = Math.cos(body.angle);
          body.sine = Math.sin(body.angle);
          body.extent = body.half * (Math.abs(body.cosine) + Math.abs(body.sine));
        }
        for (let iteration = 0; iteration < 5; iteration++) {
          const candidates = pairs(collidable, 240);
          for (let index = 0; index < candidates.length; index += 2) {
            const a = candidates[index]; const b = candidates[index + 1];
            const hit = collide(a, b);
            if (!hit) continue;
            const correction = Math.max(0, hit.depth - 0.08) * 0.4;
            a.x -= hit.nx * correction; a.y -= hit.ny * correction;
            b.x += hit.nx * correction; b.y += hit.ny * correction;
            impulse(a, b, hit.nx, hit.ny, hit.x, hit.y);
          }
          for (const body of collidable) walls(body, width, height);
        }
      }
    },
    clear() { bodies = []; remainder = 0; },
  };
}
