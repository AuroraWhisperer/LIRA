const COUNTDOWN_WINDOW_MS = 3000;
const COUNTDOWN_MIN_GAP_MS = 6000;
const SPRING_STIFFNESS = 170;
const SPRING_DAMPING = 26;
const SPRING_SETTLE_DISTANCE = 0.5;
const SPRING_SETTLE_SPEED = 2;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function stepSpringScroll(position, velocity, target, elapsedMs) {
  const currentPosition = finiteNumber(position, 0);
  const currentVelocity = finiteNumber(velocity, 0);
  const destination = finiteNumber(target, currentPosition);
  const deltaSeconds = clamp(finiteNumber(elapsedMs, 0) / 1000, 0, 0.05);
  const acceleration =
    (destination - currentPosition) * SPRING_STIFFNESS -
    currentVelocity * SPRING_DAMPING;
  const nextVelocity = currentVelocity + acceleration * deltaSeconds;
  const nextPosition = currentPosition + nextVelocity * deltaSeconds;

  if (
    Math.abs(destination - nextPosition) <= SPRING_SETTLE_DISTANCE &&
    Math.abs(nextVelocity) <= SPRING_SETTLE_SPEED
  ) {
    return { position: destination, velocity: 0 };
  }
  return { position: nextPosition, velocity: nextVelocity };
}

export function findActiveLyricIndex(lines, currentMs) {
  if (!Array.isArray(lines) || !lines.length) return -1;
  const target = Math.max(0, finiteNumber(currentMs, 0));
  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (finiteNumber(lines[middle]?.startMs, 0) <= target) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

export function getLyricCountdown(lines, currentIndex, currentMs) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const nextIndex = currentIndex + 1;
  const nextLine = lines[nextIndex];
  if (!nextLine) return null;
  const nextStartMs = finiteNumber(nextLine.startMs, 0);
  const previousStartMs =
    currentIndex >= 0 ? finiteNumber(lines[currentIndex]?.startMs, 0) : 0;
  const gapMs = nextStartMs - previousStartMs;
  const remainingMs = nextStartMs - Math.max(0, finiteNumber(currentMs, 0));
  if (
    gapMs < COUNTDOWN_MIN_GAP_MS ||
    remainingMs <= 0 ||
    remainingMs > COUNTDOWN_WINDOW_MS
  ) {
    return null;
  }
  return { nextIndex, seconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
}

export function getVisibleLyricRange(activeLine, visibleLines, lineCount) {
  const count = Math.max(0, Math.floor(finiteNumber(lineCount, 0)));
  const lines = Math.max(
    0,
    Math.min(99, Math.round(finiteNumber(visibleLines, 0))),
  );
  if (!count) return { first: 0, last: -1 };
  if (lines === 0) return { first: 0, last: count - 1 };
  if (activeLine < 0) return { first: 0, last: -1 };
  const before = Math.floor((lines - 1) / 2);
  const after = lines - 1 - before;
  return {
    first: Math.max(0, Math.floor(activeLine) - before),
    last: Math.min(count - 1, Math.floor(activeLine) + after),
  };
}

export function calculateFollowTarget(
  rowTop,
  rowHeight,
  viewportHeight,
  scrollHeight,
  alignPosition,
  alignAnchor,
) {
  const anchorRatio =
    alignAnchor === 'start' ? 0 : alignAnchor === 'end' ? 1 : 0.5;
  const maximum = Math.max(
    0,
    finiteNumber(scrollHeight, 0) - finiteNumber(viewportHeight, 0),
  );
  const rowAnchor =
    finiteNumber(rowTop, 0) + finiteNumber(rowHeight, 0) * anchorRatio;
  const viewportAnchor =
    finiteNumber(viewportHeight, 0) *
    clamp(finiteNumber(alignPosition, 0.5), 0, 1);
  return clamp(rowAnchor - viewportAnchor, 0, maximum);
}
