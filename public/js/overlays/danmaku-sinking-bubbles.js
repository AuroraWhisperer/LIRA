// All particles share one transparent surface. The nacre panel and text stay in the DOM.
export function createSinkingBubbleLayer(document) {
  const canvas = document.createElement('canvas');
  canvas.className = 'sinking-bubbles';
  canvas.setAttribute('aria-hidden', 'true');
  let context, sprite;
  let painted = false;
  let width = 0, height = 0, ratio = 1;

  function makeSprite() {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 32;
    const ink = tile.getContext('2d');
    const shine = ink.createRadialGradient(9, 8, 0, 9, 8, 11);
    shine.addColorStop(0, '#efffff85');
    shine.addColorStop(1, 'transparent');
    ink.beginPath();
    ink.arc(16, 16, 13.5, 0, 2 * Math.PI);
    ink.fillStyle = shine;
    ink.fill();
    const rim = ink.createLinearGradient(0, 0, 26, 32);
    rim.addColorStop(0, '#e2f8f6be');
    rim.addColorStop(1, '#9ac4c4ad');
    ink.strokeStyle = rim;
    ink.lineWidth = 5;
    ink.stroke();
    return tile;
  }

  return {
    canvas,
    resize(w, h) { width = w; height = h; },
    clear() {
      if (painted) context.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
      painted = false;
    },
    draw(x, y, size, opacity) {
      if (!painted) {
        ratio = document.defaultView.devicePixelRatio || 1;
        const pixelsWide = Math.round(width * ratio), pixelsHigh = Math.round(height * ratio);
        if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
        if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
        context ??= canvas.getContext('2d');
        sprite ??= makeSprite();
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        painted = true;
      }
      context.globalAlpha = opacity;
      context.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    },
  };
}
