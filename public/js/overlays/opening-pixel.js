// A 480 × 270 sprite stage keeps artwork, lettering and movement on one pixel grid.
const PALETTE = Object.freeze({
  background: '#f6dce5', cloud: '#fbeaf0', paper: '#fff7e7', white: '#fffdf7',
  ink: '#633d4d', shadow: '#c9839c', pink: '#ee95b4', bright: '#d35d8a',
  light: '#ffcede', mint: '#a5d8c5', mintDark: '#659e94', pale: '#e9bacd',
});

const GLYPHS = {
  a: ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
  d: ['00001', '00001', '01111', '10001', '10001', '10001', '01111'],
  g: ['00000', '01111', '10001', '10001', '01111', '00001', '01110'],
  i: ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
  l: ['01100', '00100', '00100', '00100', '00100', '00100', '01110'],
  n: ['00000', '00000', '11110', '10001', '10001', '10001', '10001'],
  o: ['00000', '00000', '01110', '10001', '10001', '10001', '01110'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  ' ': [],
};

const HEART = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
const STAR = ['0001000', '0001000', '0011100', '1111111', '0011100', '0001000', '0001000'];
const NOTE = ['001111', '001001', '001001', '001001', '111111', '111011', '010000'];

function rect(ctx, x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), width, height);
}

function bitmap(ctx, rows, x, y, size, color) {
  rows.forEach((row, iy) => {
    for (let ix = 0; ix < row.length; ix += 1) {
      if (row[ix] === '1') rect(ctx, x + ix * size, y + iy * size, size, size, color);
    }
  });
}

function text(ctx, value, x, y, size, color) {
  Array.from(value).forEach((character, index) => bitmap(ctx, GLYPHS[character] || [], x + index * 6 * size, y, size, color));
}

function panel(ctx, x, y, width, height, color, corner = 3) {
  rect(ctx, x + corner, y, width - corner * 2, height, color);
  rect(ctx, x, y + corner, width, height - corner * 2, color);
}

function sticker(ctx, rows, x, y, size, color) {
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
    bitmap(ctx, rows, x + dx, y + dy, size, PALETTE.white);
  }
  bitmap(ctx, rows, x + 1, y + 1, size, PALETTE.ink);
  bitmap(ctx, rows, x, y, size, color);
}

function reel(ctx, x, y, time, small = false) {
  const radius = small ? 5 : 8;
  panel(ctx, x - radius, y - radius, radius * 2 + 1, radius * 2 + 1, PALETTE.ink, 2);
  panel(ctx, x - radius + 2, y - radius + 2, radius * 2 - 3, radius * 2 - 3, PALETTE.paper, 2);
  const angle = Math.floor(time * 8) * Math.PI / 8;
  for (let spoke = 0; spoke < 3; spoke += 1) {
    const a = angle + spoke * Math.PI * 2 / 3;
    rect(ctx, x + Math.cos(a) * (radius - 3) - 1, y + Math.sin(a) * (radius - 3) - 1, 3, 3, PALETTE.ink);
  }
  rect(ctx, x, y, 1, 1, PALETTE.pink);
}

function background(ctx, time, lowQuality) {
  rect(ctx, 0, 0, 480, 270, PALETTE.background);
  // Different periods on each axis create wandering paths with no diagonal reset.
  for (let index = 0; index < (lowQuality ? 12 : 24); index += 1) {
    const phase = index * 2.399;
    const travel = index % 4 === 0 ? 3 : 1;
    const x = (index * 113 % 540) - 30 + (Math.sin(time / 9 + phase) * 19 + Math.cos(time / 17 + phase) * 12) * travel;
    const y = (index * 71 % 310) - 20 + (Math.cos(time / 11 + phase) * 17 + Math.sin(time / 7 + phase) * 9) * travel;
    if (index % 4 === 0) {
      const stretch = Math.sin(time / 3.8 + phase);
      const puff = Math.sin(time / 4.7 + phase * 1.3);
      const width = 65 + Math.round(stretch * 4);
      const height = 25 + Math.round(puff * 2);
      const crownWidth = 32 + Math.round(puff * 2);
      const cloudX = x - (width - 65) / 2;
      panel(ctx, cloudX, y, width, height, PALETTE.cloud, 7);
      panel(ctx, cloudX + 13 + Math.round(stretch * 2),
        y - 9 - Math.round(puff), crownWidth, height + 18 + Math.round(puff * 2), PALETTE.cloud, 8);
    } else if (index % 4 === 1) {
      bitmap(ctx, HEART, x, y, 2, PALETTE.pale);
    } else if (index % 4 === 2) {
      bitmap(ctx, STAR, x, y, 1, PALETTE.white);
    } else {
      for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 3; column += 1) {
          if ((row + column) % 2 === 0) rect(ctx, x + column * 4, y + row * 4, 4, 4, PALETTE.cloud);
        }
      }
    }
  }
  // Fixed corner marks give the drifting background a quiet frame of reference.
  for (const [x, y, direction] of [[15, 15, 1], [465, 15, -1], [15, 255, 1], [465, 255, -1]]) {
    rect(ctx, direction === 1 ? x : x - 10, y, 10, 1, PALETTE.shadow);
    rect(ctx, x, y < 100 ? y : y - 10, 1, 10, PALETTE.shadow);
  }
}

function decorations(ctx, time, showNotes, showEq) {
  const bob = Math.round(Math.sin(time * 1.8) * 3);
  const drift = Math.round(Math.cos(time * 1.3) * 3);
  // A miniature mint tape, the bow's pink counterpart, and a moving tape ribbon.
  panel(ctx, 101, 88 + bob, 43, 30, PALETTE.white, 4);
  panel(ctx, 103, 90 + bob, 39, 26, PALETTE.ink, 3);
  panel(ctx, 105, 92 + bob, 35, 22, PALETTE.mint, 2);
  rect(ctx, 109, 94 + bob, 27, 3, PALETTE.paper);
  rect(ctx, 113, 109 + bob, 20, 5, PALETTE.mintDark);
  reel(ctx, 113, 103 + bob, time, true);
  reel(ctx, 131, 103 + bob, time, true);
  sticker(ctx, HEART, 343 + drift, 92 - bob, 3, PALETTE.pink);
  rect(ctx, 348 + drift, 95 - bob, 3, 3, PALETTE.white);
  sticker(ctx, STAR, 324, 50 + bob, 2, PALETTE.paper);
  sticker(ctx, STAR, 133 + drift, 146 - bob, 2, PALETTE.paper);
  if (showNotes) {
    sticker(ctx, NOTE, 330 - drift, 146 + bob, 2, PALETTE.mintDark);
    sticker(ctx, NOTE, 133, 49 - bob, 1, PALETTE.bright);
  }
  if (showEq) {
    for (const x of [88, 371]) {
      for (let index = 0; index < 5; index += 1) {
        const height = 2 + Math.round((Math.sin(time * 3 + index * 1.4) + 1) * 3);
        rect(ctx, x + index * 4, 210 - height, 2, height, PALETTE.shadow);
      }
    }
  }
}

function cassette(ctx, time, motion) {
  const filled = Math.floor((time % 6 + 6) % 6); // 0 → 20 → … → 100%; full for exactly one second.
  panel(ctx, 118, 188, 248, 40, PALETTE.shadow, 4);
  panel(ctx, 116, 184, 248, 40, PALETTE.ink, 4);
  panel(ctx, 118, 186, 244, 36, PALETTE.pink, 3);
  panel(ctx, 120, 187, 240, 32, PALETTE.paper, 2);
  text(ctx, 'SIDE A', 129, 190, 1, PALETTE.ink);
  for (let index = 0; index < 5; index += 1) {
    rect(ctx, 319 + index * 5, 192, 3, 3, index < filled ? PALETTE.bright : PALETTE.pale);
  }
  panel(ctx, 152, 201, 176, 14, PALETTE.ink, 1);
  rect(ctx, 154, 203, 172, 10, PALETTE.light);
  for (let index = 0; index < 5; index += 1) {
    const x = 155 + index * 34;
    rect(ctx, x, 204, 32, 8, index < filled ? PALETTE.bright : PALETTE.white);
    if (index < filled) rect(ctx, x, 204, 32, 2, PALETTE.pink);
  }
  reel(ctx, 136, 207, motion);
  reel(ctx, 344, 207, motion);
  for (const x of [123, 355]) {
    rect(ctx, x, 189, 2, 2, PALETTE.shadow);
    rect(ctx, x, 216, 2, 2, PALETTE.shadow);
  }
  panel(ctx, 214, 217, 52, 7, PALETTE.ink, 2);
  rect(ctx, 218, 219, 44, 3, PALETTE.pink);
  for (const x of [225, 238, 251]) rect(ctx, x, 219, 2, 3, PALETTE.ink);
}

function drawPixelOpening(ctx, avatar, config, elapsed) {
  const quiet = config.reducedMotion || config.quality === 'low';
  const motion = quiet ? 0 : elapsed;
  ctx.imageSmoothingEnabled = false;
  background(ctx, motion, config.quality === 'low');
  text(ctx, 'STARTING SOON', 202, 17, 1, PALETTE.ink);
  bitmap(ctx, HEART, 187, 18, 1, PALETTE.bright);
  bitmap(ctx, HEART, 286, 18, 1, PALETTE.bright);
  decorations(ctx, motion, config.showNotes, config.showEq);
  const x = 160;
  const y = 27 + Math.round(Math.sin(motion * 2.1) * 3);
  if (avatar?.complete && avatar.naturalWidth && avatar.naturalHeight) {
    const scale = Math.min(160 / avatar.naturalWidth, 160 / avatar.naturalHeight);
    const width = avatar.naturalWidth * scale;
    const height = avatar.naturalHeight * scale;
    ctx.drawImage(avatar, x + (160 - width) / 2, y + (160 - height) / 2, width, height);
  }
  cassette(ctx, elapsed, motion);
  Array.from('loading...').forEach((character, index) => {
    const phase = ((motion - index * 0.14) % 2.4 + 2.4) % 2.4;
    const jump = !quiet && phase < 0.34 ? Math.round(Math.sin(phase / 0.34 * Math.PI) * 4) : 0;
    const letterX = 172 + index * 14;
    bitmap(ctx, GLYPHS[character], letterX + 1, 239 - jump + 2, 2, PALETTE.white);
    bitmap(ctx, GLYPHS[character], letterX, 239 - jump, 2, PALETTE.ink);
  });
}

function createPixelOpening(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let avatar = null;
  let avatarUrl = '';
  let config = null;
  let request = null;
  let lastTime = null;
  let paintedAt = -Infinity;
  let elapsed = 0;
  let disposed = false;

  const frame = (now) => {
    request = null;
    if (disposed || !config?.active || config.paused) return;
    if (lastTime !== null) elapsed += (now - lastTime) / 1000;
    lastTime = now;
    const fps = config.quality === 'low' || config.reducedMotion ? 4 : config.quality === 'high' ? 60 : 30;
    if (now - paintedAt >= 1000 / fps) {
      drawPixelOpening(ctx, avatar, config, elapsed);
      paintedAt = now;
    }
    request = requestAnimationFrame(frame);
  };

  return {
    update(next) {
      if (disposed) return;
      if (!config?.active && next.active) elapsed = 0;
      config = next;
      const nextAvatarUrl = next.pixelCharacterUrl || '';
      if (next.active && nextAvatarUrl !== avatarUrl) {
        avatarUrl = nextAvatarUrl;
        avatar = avatarUrl ? new Image() : null;
        if (avatar) avatar.src = avatarUrl;
      }
      if (!next.active || next.paused) {
        if (request !== null) cancelAnimationFrame(request);
        request = null;
        lastTime = null;
      } else if (request === null) {
        paintedAt = -Infinity;
        request = requestAnimationFrame(frame);
      }
    },
    dispose() {
      disposed = true;
      if (request !== null) cancelAnimationFrame(request);
    },
  };
}

export { createPixelOpening, drawPixelOpening };
