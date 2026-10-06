const WIDTH = 1920;
const HEIGHT = 1080;
const LOOP_SECONDS = 15;
const CRANE_START = 1.6;
const CRANE_END = 6.5;
const TAU = Math.PI * 2;
const FAN_PIVOT = { x: 768, y: 905 };
const FAN_START = -2.79;
const FAN_END = -0.35;
const FAN_SLICES = 22;
const INK = '#253553';

function smooth(start, end, value) {
  const x = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return x * x * (3 - 2 * x);
}

function moonFanFrame(seconds, reducedMotion = false) {
  const elapsed = Math.max(0, seconds);
  const time = reducedMotion ? 7 : elapsed % LOOP_SECONDS;
  const phase = reducedMotion ? 0 : time / LOOP_SECONDS * TAU;
  return {
    time,
    phase,
    // The garden stays lit between acts; only the first opening fades it in.
    scenery: reducedMotion ? 1 : smooth(0, 1.5, elapsed),
    flowers: smooth(0.1, 1.6, time) * (1 - smooth(11.6, 13.8, time)),
    fan: smooth(0.45, 2.2, time) * (1 - smooth(10.2, 13.2, time)),
    fanOpacity: smooth(0.25, 0.9, time) * (1 - smooth(13, 13.8, time)),
    departure: smooth(12.3, 13.8, time),
    ribbon: smooth(1.1, 2.6, time) * (1 - smooth(11, 13.2, time)),
    lettering: smooth(2.2, 3.2, time) * (1 - smooth(9.5, 10.8, time)),
    detail: smooth(2.6, 3.7, time) * (1 - smooth(9.2, 10.6, time)),
    bird: reducedMotion ? 0 : smooth(CRANE_START, 2.2, time) * (1 - smooth(5.7, CRANE_END, time)),
  };
}

function fanSlicePose(index, openness) {
  const start = FAN_START + index / FAN_SLICES * (FAN_END - FAN_START);
  const end = FAN_START + (index + 1) / FAN_SLICES * (FAN_END - FAN_START);
  return { start, end, rotation: (-Math.PI / 2 - (start + end) / 2) * (1 - openness) };
}

function surface(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function createMoonMaterials() {
  const mist = surface(1200, 240);
  const ctx = mist.getContext('2d');
  for (let i = 0; i < 9; i += 1) {
    const x = 80 + i * 125;
    const gradient = ctx.createRadialGradient(x, 130, 0, x, 130, 160);
    gradient.addColorStop(0, 'rgba(250,252,255,.30)');
    gradient.addColorStop(1, 'rgba(250,252,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - 160, 0, 320, 240);
  }
  const petals = [];
  for (let i = 0; i < 3; i += 1) {
    const petal = surface(56, 72);
    const p = petal.getContext('2d');
    const color = p.createLinearGradient(8, 0, 42, 68);
    color.addColorStop(0, '#fffefe');
    color.addColorStop(0.45, ['#e6eaf6', '#afc1e3', '#d0d7ed'][i]);
    color.addColorStop(1, '#8299c5');
    p.fillStyle = color;
    p.beginPath();
    p.moveTo(25, 66);
    p.bezierCurveTo(2, 45, 1, 17, 24, 7);
    p.bezierCurveTo(47, -1, 59, 37, 25, 66);
    p.fill();
    p.strokeStyle = 'rgba(250,252,255,.5)';
    p.lineWidth = 0.8;
    p.beginPath();
    p.moveTo(25, 65);
    p.quadraticCurveTo(21, 37, 29, 14);
    p.stroke();
    petals.push(petal);
  }
  return { mist, petals, ribbon: surface(WIDTH / 2, HEIGHT / 2) };
}

function imageAt(ctx, image, x, y, width) {
  ctx.drawImage(image, x, y, width, width * image.height / image.width);
}

function drawFan(ctx, image, frame, reflection = false) {
  if (frame.fanOpacity <= 0) return;
  const p = frame.phase;
  ctx.save();
  ctx.translate(760 + Math.sin(p) * 9,
    (reflection ? 924 : 850) + Math.sin(p * 2) * 9 + frame.departure * (reflection ? 12 : 70));
  ctx.rotate(reflection ? 0 : -0.105 + Math.sin(p) * 0.014);
  ctx.scale(0.86, reflection ? -0.19 : 0.86);
  ctx.globalAlpha *= frame.fanOpacity * (reflection ? 0.16 : 1);
  if (reflection && frame.fan >= 1) {
    // Horizontal slices distort the reflection independently of the painted fan.
    for (let y = 30; y < image.height; y += 24) {
      const height = Math.min(24, image.height - y);
      ctx.drawImage(image, 0, y, image.width, height,
        -FAN_PIVOT.x + Math.sin(y * 0.04 + p * 2) * 18,
        y - FAN_PIVOT.y, image.width, height);
    }
  } else if (frame.fan >= 1) {
    ctx.drawImage(image, -FAN_PIVOT.x, -FAN_PIVOT.y);
  } else {
    // Each painted sector rotates about the actual hinge, preserving its shape.
    for (let i = 0; i < FAN_SLICES; i += 1) {
      const pose = fanSlicePose(i, frame.fan);
      ctx.save();
      ctx.rotate(pose.rotation);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 1200, pose.start - 0.004, pose.end + 0.004);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(image, -FAN_PIVOT.x, -FAN_PIVOT.y);
      ctx.restore();
    }
    ctx.drawImage(image, 721, 863, 97, 87, -47, -42, 97, 87);
  }
  ctx.restore();
}

function ribbonPoint(u, phase, back) {
  const x = -160 + 2240 * u;
  const y = back
    ? 265 + 75 * Math.sin(u * TAU + 0.5) + 25 * Math.sin(u * TAU * 2 + phase)
    : 650 + 230 * Math.sin(u * Math.PI) + 75 * Math.sin(u * TAU + 0.4)
      + 28 * Math.sin(u * TAU * 2 - phase);
  const width = (back ? 38 : 82) * Math.sin(u * Math.PI * 3 + phase * 0.5);
  return { x, y, width };
}

function ribbonTriangle(ctx, silk, a, b, c, second, textureX) {
  const width = 32;
  const height = silk.height;
  ctx.save();
  ctx.beginPath();
  const center = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
  [a, b, c].forEach((point, index) => {
    const dx = point[0] - center[0];
    const dy = point[1] - center[1];
    const factor = 1 + 1.6 / Math.hypot(dx, dy);
    const x = center[0] + dx * factor;
    const y = center[1] + dy * factor;
    if (index) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
  if (second) {
    ctx.transform((b[0] - c[0]) / width, (b[1] - c[1]) / width,
      (b[0] - a[0]) / height, (b[1] - a[1]) / height,
      c[0] + a[0] - b[0], c[1] + a[1] - b[1]);
  } else {
    ctx.transform((b[0] - a[0]) / width, (b[1] - a[1]) / width,
      (c[0] - a[0]) / height, (c[1] - a[1]) / height, a[0], a[1]);
  }
  ctx.drawImage(silk, textureX, 0, width, height, -1, -2, width + 2, height + 4);
  ctx.restore();
}

function drawRibbon(ctx, silk, layer, frame, back) {
  const cloth = layer.getContext('2d');
  cloth.setTransform(0.5, 0, 0, 0.5, 0, 0);
  cloth.clearRect(0, 0, WIDTH, HEIGHT);
  const edges = [[], []];
  const count = 64;
  for (let i = 0; i <= count; i += 1) {
    const a = ribbonPoint(i / count, frame.phase * 2, back);
    const b = ribbonPoint(i / count + 0.0001, frame.phase * 2, back);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    for (let side = 0; side < 2; side += 1) {
      const sign = side ? 1 : -1;
      edges[side].push([a.x - Math.sin(angle) * a.width * sign / 2,
        a.y + Math.cos(angle) * a.width * sign / 2]);
    }
  }
  cloth.fillStyle = '#92a9cc';
  cloth.beginPath();
  [...edges[0], ...edges[1].slice().reverse()].forEach(([x, y], i) => i ? cloth.lineTo(x, y) : cloth.moveTo(x, y));
  cloth.closePath();
  cloth.fill();
  for (let i = 0; i < count; i += 1) {
    ribbonTriangle(cloth, silk, edges[0][i], edges[0][i + 1], edges[1][i], false, i * 13 % 480);
    ribbonTriangle(cloth, silk, edges[0][i + 1], edges[1][i + 1], edges[1][i], true, i * 13 % 480);
  }
  cloth.strokeStyle = 'rgba(225,231,247,.75)';
  cloth.lineWidth = 0.8;
  for (const edge of edges) {
    cloth.beginPath();
    edge.forEach(([x, y], i) => i ? cloth.lineTo(x, y) : cloth.moveTo(x, y));
    cloth.stroke();
  }
  ctx.save();
  ctx.globalAlpha = frame.ribbon * (back ? 0.30 : 0.76);
  ctx.drawImage(layer, 0, 0, WIDTH, HEIGHT);
  ctx.restore();
}

function drawFlowers(ctx, assets, frame) {
  const groups = [
    ['flowersNw', -90, -92, 660, 0.055, 0],
    ['flowersNe', 1600, -90, 540, -0.09, 1.7],
    ['flowersSw', -110, 835, 460, -0.31, 3.2],
    ['flowersSe', 1490, 690, 715, 0.17, 4.4],
  ];
  for (const [key, x, y, width, rotation, offset] of groups) {
    ctx.save();
    const swing = Math.sin(frame.phase * 2 + offset);
    ctx.translate(x + swing * 7, y + (1 - frame.flowers) * (y > 500 ? 160 : -160));
    ctx.rotate(rotation + swing * 0.014);
    ctx.globalAlpha = frame.flowers;
    imageAt(ctx, assets[key], 0, 0, width);
    ctx.restore();
  }
}

function drawPendant(ctx, image, x, y, height, phase, opacity) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(phase) * 0.037);
  ctx.globalAlpha = opacity;
  const width = height * image.width / image.height;
  imageAt(ctx, image, -width / 2, 0, width);
  ctx.restore();
}

function drawGarden(ctx, assets, frame) {
  drawPendant(ctx, assets.jewelLeft, 175, 165, 360, frame.phase, frame.scenery * 0.85);
}

function drawWater(ctx, frame) {
  ctx.save();
  // Expanding rings and broken reflected highlights move over the painted lake.
  for (let i = 0; i < 6; i += 1) {
    const u = (frame.phase / TAU + i / 6) % 1;
    ctx.globalAlpha = Math.sin(u * Math.PI) * 0.15 * frame.scenery;
    ctx.strokeStyle = '#eaf1ff';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(795, 968, 35 + u * 570, 4 + u * 60, 0, 0, TAU);
    ctx.stroke();
  }
  for (let i = 0; i < 36; i += 1) {
    const x = 220 + (i * 197) % 1360;
    const y = 815 + (i * 47) % 265;
    ctx.globalAlpha = (0.08 + 0.21 * (1 + Math.sin(frame.phase * 3 + i)) / 2) * frame.scenery;
    ctx.fillStyle = i % 5 === 0 ? '#e7cf9e' : '#f5f7ff';
    ctx.fillRect(x + Math.sin(frame.phase * 2 + i) * 12, y, 4 + i % 5 * 4, 1);
  }
  ctx.restore();
}

function drawButterfly(ctx, x, y, size, phase) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(phase * 0.25) * 0.5);
  ctx.scale(size, size);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side * (0.2 + Math.abs(Math.cos(phase)) * 0.8), 1);
    const color = ctx.createLinearGradient(0, 0, 37, -30);
    color.addColorStop(0, '#526ca3');
    color.addColorStop(0.55, '#b3c4e9');
    color.addColorStop(1, '#f2f3fc');
    ctx.fillStyle = color;
    ctx.strokeStyle = '#8d9dbf';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(6, -17, 33, -43, 36, -21);
    ctx.bezierCurveTo(40, -6, 15, 4, 9, 5);
    ctx.bezierCurveTo(34, 10, 22, 30, 11, 20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(250,252,255,.7)';
    ctx.beginPath();
    ctx.moveTo(2, 0);
    ctx.lineTo(28, -23);
    ctx.moveTo(4, 3);
    ctx.lineTo(19, 16);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#495b7b';
  ctx.beginPath();
  ctx.ellipse(0, 2, 1.4, 10, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawCrane(ctx, assets, frame) {
  if (frame.bird <= 0) return;
  const travel = Math.max(0, (frame.time - CRANE_START) / (CRANE_END - CRANE_START));
  ctx.save();
  ctx.globalAlpha = frame.bird;
  ctx.translate(650 + travel * 860, 420 - Math.sin(travel * Math.PI * 0.6) * 300);
  ctx.rotate(-0.12 - Math.sin(travel * Math.PI) * 0.08);
  const scale = 0.24 - travel * 0.07;
  ctx.scale(scale, scale);
  const flap = Math.sin((frame.time - CRANE_START) * 3.2);
  ctx.save();
  ctx.scale(-0.74, 0.45 + flap * 0.48);
  ctx.rotate(0.17);
  ctx.drawImage(assets.craneFar, -45, -425);
  ctx.restore();
  imageAt(ctx, assets.craneBody, -665, -98, 1350);
  ctx.save();
  ctx.scale(1, 0.55 + flap * 0.68);
  ctx.rotate(-0.1);
  ctx.drawImage(assets.craneNear, -645, -420);
  ctx.restore();
  ctx.restore();
}

function drawPetals(ctx, materials, frame, quality) {
  const count = quality === 'low' ? 18 : quality === 'high' ? 52 : 36;
  ctx.save();
  for (let i = 0; i < count; i += 1) {
    const rate = 1 + i % 3;
    const u = ((frame.time / LOOP_SECONDS * rate) + i * 0.618034) % 1;
    const x = -100 + 2120 * u;
    const y = 70 + (i * 127) % 930 + Math.sin(u * TAU + i) * 65;
    const size = 10 + i % 5 * 3.7;
    const angle = frame.phase * (2 + i % 4) + i;
    ctx.save();
    ctx.globalAlpha = frame.flowers * (0.24 + i % 4 * 0.14);
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(0.25 + Math.abs(Math.sin(angle)) * 0.75, 1);
    ctx.drawImage(materials.petals[i % 3], -size / 2, -size * 0.65, size, size * 1.3);
    ctx.restore();
  }
  ctx.restore();
}

function trackedText(ctx, text, x, y, spacing, maxWidth = Infinity) {
  const chars = Array.from(text);
  const total = chars.reduce((sum, char) => sum + ctx.measureText(char).width, 0)
    + Math.max(0, chars.length - 1) * spacing;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(Math.min(1, maxWidth / Math.max(1, total)), 1);
  let cursor = -total / 2;
  for (const char of chars) {
    ctx.fillText(char, cursor, 0);
    cursor += ctx.measureText(char).width + spacing;
  }
  ctx.restore();
}

function drawCopy(ctx, assets, frame, config) {
  ctx.save();
  ctx.globalAlpha = frame.lettering;
  const title = config.title ?? '月渡花汀';
  const offset = (1 - frame.lettering) * (frame.time < 9.5 ? 26 : -22);
  if (title === '月渡花汀') {
    imageAt(ctx, assets.title, 966, 422 + offset, 735);
  } else {
    const size = Math.max(40, Math.min(143, 680 / Math.max(4, Array.from(title).length)));
    ctx.font = `${size}px KaiTi, STKaiti, serif`;
    ctx.fillStyle = INK;
    trackedText(ctx, title, 1320, 563 + offset, 5, 710);
  }
  ctx.globalAlpha = frame.detail;
  ctx.fillStyle = '#425779';
  ctx.font = '27px SimSun, "Songti SC", serif';
  trackedText(ctx, config.subtitle ?? '直播即将开始', 1320, 702, 7, 680);
  ctx.strokeStyle = 'rgba(107,130,169,.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(1100, 749);
  ctx.lineTo(1540, 749);
  ctx.stroke();
  const marker = 1320 + Math.sin(frame.phase) * 185;
  ctx.save();
  ctx.translate(marker, 749);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#788fb6';
  ctx.fillRect(-3, -3, 6, 6);
  ctx.restore();
  if (config.name) {
    ctx.font = '20px SimSun, serif';
    trackedText(ctx, config.name, 1320, 368, 4, 680);
  }
  ctx.font = '19px SimSun, serif';
  ctx.fillStyle = '#4d6386';
  ctx.shadowColor = '#f6f8fe';
  ctx.shadowBlur = 5;
  trackedText(ctx, config.footer ?? '风起花汀，静候君来', 960, 1030, 4, 1040);
  ctx.restore();
}

function paintMoonFan(ctx, assets, materials, seconds, config = {}) {
  const frame = moonFanFrame(seconds, config.reducedMotion);
  ctx.save();
  ctx.fillStyle = '#f0f4fa';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.globalAlpha = frame.scenery;
  ctx.drawImage(assets.landscape, -10 + Math.sin(frame.phase) * 6, -5, 1940, 1090);
  drawWater(ctx, frame);
  ctx.globalAlpha = 0.28 * frame.scenery;
  ctx.drawImage(materials.mist, -160 + Math.sin(frame.phase) * 140, 535, 2100, 270);
  ctx.globalAlpha = 1;
  drawRibbon(ctx, assets.silk, materials.ribbon, frame, true);
  drawFan(ctx, assets.fan, frame, true);
  drawFan(ctx, assets.fan, frame);
  ctx.globalAlpha = 0.36 * frame.scenery;
  ctx.drawImage(materials.mist, 300 + Math.sin(frame.phase + 2) * 200, 813, 1500, 200);
  ctx.globalAlpha = 1;
  // The title occupies a quiet pool of mist rather than competing with the landscape.
  const light = ctx.createRadialGradient(1390, 541, 55, 1390, 541, 440);
  light.addColorStop(0, 'rgba(247,250,255,.83)');
  light.addColorStop(1, 'rgba(247,250,255,0)');
  ctx.fillStyle = light;
  ctx.globalAlpha = frame.lettering;
  ctx.fillRect(940, 95, 920, 900);
  ctx.globalAlpha = 1;
  drawRibbon(ctx, assets.silk, materials.ribbon, frame, false);
  drawGarden(ctx, assets, frame);
  drawCrane(ctx, assets, frame);
  drawFlowers(ctx, assets, frame);
  if (config.showNotes !== false && !config.reducedMotion) drawPetals(ctx, materials, frame, config.quality);
  if (config.showEq !== false) {
    for (let i = 0; i < 3; i += 1) {
      const p = frame.phase * (i + 1) + i * 2;
      ctx.globalAlpha = frame.flowers * 0.85;
      drawButterfly(ctx, 380 + i * 568 + Math.sin(p) * 85,
        314 + i * 226 + Math.cos(p) * 60, 0.56 + i * 0.1,
        config.reducedMotion ? 0.5 : frame.phase * 24 + i);
    }
  }
  ctx.globalAlpha = 1;
  drawCopy(ctx, assets, frame, config);
  ctx.restore();
}

export { WIDTH, HEIGHT, LOOP_SECONDS, FAN_SLICES, moonFanFrame, fanSlicePose, createMoonMaterials, paintMoonFan };
