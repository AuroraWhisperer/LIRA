'use strict';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function hasPngHeader(png) {
  return Buffer.isBuffer(png) && png.length >= 24 && png.subarray(0, 8).equals(PNG_SIGNATURE);
}

function pngHasSize(png, width, height) {
  return hasPngHeader(png) && png.readUInt32BE(16) === width && png.readUInt32BE(20) === height;
}

function encodeExportPng(image, width, height, nativeImage) {
  const resize = { width, height, quality: 'best' };
  const scales = image.getScaleFactors();
  if (!scales.length) return Buffer.alloc(0);
  const scaleFactor = scales.includes(1) ? 1 : scales[0];
  const size = image.getSize(scaleFactor);
  if (size.width !== width || size.height !== height) return image.resize(resize).toPNG({ scaleFactor: 1 });
  if (scaleFactor === 1) return image.toPNG({ scaleFactor: 1 });

  // getSize reports truncated DIP. Recover the raw row stride before relabelling the bitmap as 1x.
  const bitmap = image.toBitmap({ scaleFactor });
  if (!bitmap.length || bitmap.length % 4) return Buffer.alloc(0);
  const pixels = bitmap.length / 4;
  let dimensions;
  for (let pixelWidth = Math.ceil(width * scaleFactor); pixelWidth < (width + 1) * scaleFactor; pixelWidth++) {
    const pixelHeight = pixels / pixelWidth;
    if (!Number.isInteger(pixelHeight) || Math.floor(pixelHeight / scaleFactor) !== height) continue;
    if (dimensions) {
      dimensions = null;
      break;
    }
    dimensions = { width: pixelWidth, height: pixelHeight };
  }
  // Two possible strides (e.g. 640x641 vs 641x640): let Chromium resample the full representation.
  const normalized = dimensions ? nativeImage.createFromBitmap(bitmap, dimensions)
    : image.resize({ ...resize, width: width + 1 });
  return normalized.resize(resize).toPNG({ scaleFactor: 1 });
}

module.exports = { hasPngHeader, pngHasSize, encodeExportPng };
