export function isShapeTool(tool) {
  return tool === 'line' || tool === 'rectangle' || tool === 'ellipse';
}

export function createShapePoints(tool, start, end) {
  if (!start || !end) return [];
  if (Math.abs(end.x - start.x) + Math.abs(end.y - start.y) < 0.002)
    return [start];
  if (tool === 'line') return [start, end];
  if (tool === 'rectangle') {
    return [
      start,
      { x: end.x, y: start.y },
      end,
      { x: start.x, y: end.y },
      start,
    ];
  }
  if (tool === 'ellipse') {
    const centerX = (start.x + end.x) / 2;
    const centerY = (start.y + end.y) / 2;
    const radiusX = Math.abs(end.x - start.x) / 2;
    const radiusY = Math.abs(end.y - start.y) / 2;
    return Array.from({ length: 41 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 40;
      return {
        x: centerX + Math.cos(angle) * radiusX,
        y: centerY + Math.sin(angle) * radiusY,
      };
    });
  }
  return [start];
}

export function colorDistance(color, pixel) {
  const value = Number.parseInt(String(color).slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return (
    (red - pixel[0]) ** 2 + (green - pixel[1]) ** 2 + (blue - pixel[2]) ** 2
  );
}
