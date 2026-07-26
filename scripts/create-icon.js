'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT_DIR = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const SOURCE_ICON_PATH = path.join(BUILD_DIR, 'icon-source.png');
const SIZE = 256;
const CRC32_TABLE = createCrc32Table();

fs.mkdirSync(BUILD_DIR, { recursive: true });

if (fs.existsSync(SOURCE_ICON_PATH)) {
  const source = decodePng(fs.readFileSync(SOURCE_ICON_PATH));
  const square = cropCenterSquare(source);
  removeEdgeBackground(square, 36);
  const resized = resizeNearest(square, SIZE, SIZE);
  const png = createPng(SIZE, SIZE, resized.pixels);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), png);
  fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), createIco(png, SIZE, SIZE));
  console.log(`Created icon from ${path.relative(ROOT_DIR, SOURCE_ICON_PATH)}`);
  process.exit(0);
}

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

function decodePng(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error('icon-source.png must be a PNG file.');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      const compression = data[10];
      const filter = data[11];
      const interlace = data[12];
      if (bitDepth !== 8 || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error('icon-source.png must be a non-interlaced 8-bit PNG.');
      }
      if (colorType !== 2 && colorType !== 6) {
        throw new Error('icon-source.png must use RGB or RGBA color.');
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!width || !height || idat.length === 0) {
    throw new Error('icon-source.png is missing required PNG data.');
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * 4);
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  let rawOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filterType = raw[rawOffset];
    rawOffset += 1;
    raw.copy(current, 0, rawOffset, rawOffset + stride);
    rawOffset += stride;
    unfilterScanline(current, previous, channels, filterType);

    for (let x = 0; x < width; x += 1) {
      const sourceIndex = x * channels;
      const targetIndex = (y * width + x) * 4;
      pixels[targetIndex] = current[sourceIndex];
      pixels[targetIndex + 1] = current[sourceIndex + 1];
      pixels[targetIndex + 2] = current[sourceIndex + 2];
      pixels[targetIndex + 3] = channels === 4 ? current[sourceIndex + 3] : 255;
    }

    current.copy(previous);
  }

  return { width, height, pixels };
}

function unfilterScanline(current, previous, bytesPerPixel, filterType) {
  for (let index = 0; index < current.length; index += 1) {
    const left = index >= bytesPerPixel ? current[index - bytesPerPixel] : 0;
    const up = previous[index] || 0;
    const upLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
    if (filterType === 1) {
      current[index] = (current[index] + left) & 0xff;
    } else if (filterType === 2) {
      current[index] = (current[index] + up) & 0xff;
    } else if (filterType === 3) {
      current[index] = (current[index] + Math.floor((left + up) / 2)) & 0xff;
    } else if (filterType === 4) {
      current[index] = (current[index] + paeth(left, up, upLeft)) & 0xff;
    } else if (filterType !== 0) {
      throw new Error(`Unsupported PNG filter type: ${filterType}`);
    }
  }
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function cropCenterSquare(image) {
  const size = Math.min(image.width, image.height);
  const left = Math.floor((image.width - size) / 2);
  const top = Math.floor((image.height - size) / 2);
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const sourceStart = ((top + y) * image.width + left) * 4;
    const targetStart = y * size * 4;
    image.pixels.copy(pixels, targetStart, sourceStart, sourceStart + size * 4);
  }
  return { width: size, height: size, pixels };
}

function removeEdgeBackground(image, threshold) {
  const visited = new Uint8Array(image.width * image.height);
  const queue = [];

  for (let x = 0; x < image.width; x += 1) {
    queueTransparentCandidate(image, visited, queue, x, 0, threshold);
    queueTransparentCandidate(image, visited, queue, x, image.height - 1, threshold);
  }
  for (let y = 1; y < image.height - 1; y += 1) {
    queueTransparentCandidate(image, visited, queue, 0, y, threshold);
    queueTransparentCandidate(image, visited, queue, image.width - 1, y, threshold);
  }

  for (let index = 0; index < queue.length; index += 1) {
    const point = queue[index];
    const pixelIndex = (point.y * image.width + point.x) * 4;
    image.pixels[pixelIndex + 3] = 0;
    queueTransparentCandidate(image, visited, queue, point.x + 1, point.y, threshold);
    queueTransparentCandidate(image, visited, queue, point.x - 1, point.y, threshold);
    queueTransparentCandidate(image, visited, queue, point.x, point.y + 1, threshold);
    queueTransparentCandidate(image, visited, queue, point.x, point.y - 1, threshold);
  }
}

function queueTransparentCandidate(image, visited, queue, x, y, threshold) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const key = y * image.width + x;
  if (visited[key]) return;
  visited[key] = 1;
  const index = key * 4;
  const alpha = image.pixels[index + 3];
  const isDark =
    image.pixels[index] <= threshold
    && image.pixels[index + 1] <= threshold
    && image.pixels[index + 2] <= threshold;
  if (alpha > 0 && isDark) {
    queue.push({ x, y });
  }
}

function resizeNearest(image, width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y / height) * image.height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x / width) * image.width));
      const sourceIndex = (sourceY * image.width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;
      image.pixels.copy(pixels, targetIndex, sourceIndex, sourceIndex + 4);
    }
  }
  return { width, height, pixels };
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
