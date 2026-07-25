'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT_DIR = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const SIZE = 256;
const CRC32_TABLE = createCrc32Table();

fs.mkdirSync(BUILD_DIR, { recursive: true });

const rgba = Buffer.alloc(SIZE * SIZE * 4);

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const index = (y * SIZE + x) * 4;
    const radius = roundedRectAlpha(x, y, 28);
    if (radius === 0) {
      rgba[index + 3] = 0;
      continue;
    }

    const t = (x + y) / (SIZE * 2);
    const base = mix([198, 35, 30], [245, 166, 35], t * 0.5);
    const light = Math.max(0, 1 - distance(x, y, 78, 62) / 240);
    rgba[index] = clamp(base[0] + light * 42);
    rgba[index + 1] = clamp(base[1] + light * 30);
    rgba[index + 2] = clamp(base[2] + light * 18);
    rgba[index + 3] = Math.round(radius * 255);
  }
}

drawCircle(128, 128, 82, [255, 230, 166, 255]);
drawCircle(128, 128, 69, [197, 35, 31, 255]);
drawCircle(108, 172, 23, [255, 252, 244, 255]);
drawCircle(156, 158, 23, [255, 252, 244, 255]);
drawRect(126, 73, 20, 94, [255, 252, 244, 255]);
drawRect(174, 62, 18, 80, [255, 252, 244, 255]);
drawRect(126, 73, 66, 18, [255, 252, 244, 255]);
drawCircle(192, 73, 9, [255, 252, 244, 255]);
drawRect(78, 203, 101, 10, [255, 230, 166, 255]);

const png = createPng(SIZE, SIZE, rgba);
fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), png);
fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), createIco(png, SIZE, SIZE));

function roundedRectAlpha(x, y, radius) {
  const max = SIZE - 1;
  const cx = x < radius ? radius : x > max - radius ? max - radius : x;
  const cy = y < radius ? radius : y > max - radius ? max - radius : y;
  const dist = distance(x, y, cx, cy);
  if (dist <= radius - 1) return 1;
  if (dist >= radius + 1) return 0;
  return (radius + 1 - dist) / 2;
}

function drawRect(left, top, width, height, color) {
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) {
      paint(x, y, color);
    }
  }
}

function drawCircle(cx, cy, radius, color) {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(SIZE - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(SIZE - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (distance(x, y, cx, cy) <= radius) paint(x, y, color);
    }
  }
}

function paint(x, y, color) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const index = (y * SIZE + x) * 4;
  const alpha = color[3] / 255;
  const inverse = 1 - alpha;
  rgba[index] = clamp(color[0] * alpha + rgba[index] * inverse);
  rgba[index + 1] = clamp(color[1] * alpha + rgba[index + 1] * inverse);
  rgba[index + 2] = clamp(color[2] * alpha + rgba[index + 2] * inverse);
  rgba[index + 3] = Math.max(rgba[index + 3], color[3]);
}

function createPng(width, height, pixels) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    scanlines[rowStart] = 0;
    pixels.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', createIhdr(width, height)),
    pngChunk('IDAT', zlib.deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function createIhdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8;
  buffer[9] = 6;
  return buffer;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createIco(png, width, height) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = width >= 256 ? 0 : width;
  header[7] = height >= 256 ? 0 : height;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mix(a, b, t) {
  return a.map((value, index) => value + (b[index] - value) * t);
}

function distance(x1, y1, x2, y2) {
  return Math.hypot(x1 - x2, y1 - y2);
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function createCrc32Table() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    return value >>> 0;
  });
}
