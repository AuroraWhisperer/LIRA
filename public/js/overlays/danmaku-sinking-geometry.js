// Alpha-edge samples from nacre.webp (1400 × 528); all three palettes share its alpha.
const TOP = [192, 131, 94, 74, 66, 66, 66, 68, 75, 87, 100, 114, 125, 134, 143,
  148, 152, 153, 154, 154, 153, 152, 149, 145, 141, 137, 132, 127, 122, 118, 116, 114, 110, 103];
const LEFT = [100, 72, 52, 36, 26, 20, 21, 28, 41, 63, 97, 159, 302];
const RIGHT = [1377, 1365, 1352, 1341, 1330, 1319, 1305, 1286, 1261, 1210, 1101, 872, 688];

function sample(values, position, start, step) {
  const index = Math.max(0, Math.min(values.length - 1, (position - start) / step));
  const lower = Math.floor(index);
  return values[lower] + (values[Math.min(lower + 1, values.length - 1)] - values[lower]) * (index - lower);
}

function sliceCoordinate(value, size, start, end, targetSize, targetStart, targetEnd) {
  if (value < start) return value / start * targetStart;
  if (value > size - end) return targetSize - (size - value) / end * targetEnd;
  return targetStart + (value - start) / (size - start - end) * (targetSize - targetStart - targetEnd);
}

export function sinkingBubblePoint(width, height, edge, fraction) {
  // Match sinking.css's 32% 20% 25% 17% slices and 60px 67px border widths.
  if (edge === 'top') {
    const x = width * (0.03 + fraction * 0.94);
    const sourceX = sliceCoordinate(x, width, 67, 67, 1400, 238, 280);
    const sourceY = sample(TOP, sourceX, 40, 40);
    return { x, y: sliceCoordinate(sourceY, 528, 168.96, 132, height, 60, 60) };
  }
  const y = height * (0.18 + fraction * 0.65);
  const sourceY = sliceCoordinate(y, height, 60, 60, 528, 168.96, 132);
  const sourceX = sample(edge === 'left' ? LEFT : RIGHT, sourceY, 110, 30);
  return { x: sliceCoordinate(sourceX, 1400, 238, 280, width, 67, 67), y };
}

function rotate({ x, y, z = 0 }, pitch, yaw, angle) {
  const radians = Math.PI / 180;
  const sinZ = Math.sin(angle * radians), cosZ = Math.cos(angle * radians);
  const rotatedX = x * cosZ - y * sinZ;
  const rotatedY = x * sinZ + y * cosZ;
  const sinY = Math.sin(yaw * radians), cosY = Math.cos(yaw * radians);
  const depth = z * cosY - rotatedX * sinY;
  const sinX = Math.sin(pitch * radians), cosX = Math.cos(pitch * radians);
  return { x: rotatedX * cosY + z * sinY, y: rotatedY * cosX - depth * sinX,
    z: rotatedY * sinX + depth * cosX };
}

export function projectSinkingPoint(point, width, height, pose, transform) {
  // CSS applies Z/Y/X rotations, depth, then perspective around the panel origin.
  const panel = rotate({ x: point.x - width / 2, y: point.y - height * 0.42 }, pose.pitch, pose.yaw, pose.angle);
  const perspective = 800 / (800 - panel.z - pose.depth);
  let x = width / 2 + panel.x * perspective;
  let y = height * 0.42 + panel.y * perspective;
  if (transform) {
    const dx = x - width / 2, dy = y - height / 2;
    const effect = rotate({ x: dx + Math.tan((transform.skewX || 0) * Math.PI / 180) * dy,
      y: dy + Math.tan((transform.skewY || 0) * Math.PI / 180) * dx },
    transform.rotateX || 0, transform.rotateY || 0, transform.rotateZ || 0);
    const distance = transform.perspective ?? 1000;
    const factor = distance / (distance - effect.z);
    x = width / 2 + effect.x * factor;
    y = height / 2 + effect.y * factor;
  }
  return { x, y };
}
