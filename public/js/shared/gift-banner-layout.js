export const BANNER_WIDTH = 428;
export const BANNER_HEIGHT = 72;
export const BANNER_GAP = 8;

export const EXPORT_SCALE = 2;
export const DEFAULT_EXPORT_GAP = BANNER_GAP * EXPORT_SCALE;

// Export controls and file dimensions use pixels in the final PNG.
export function giftExportRowLayout(count, rowGap = DEFAULT_EXPORT_GAP) {
  const adjustable = count === 2;
  const gap = adjustable ? rowGap : DEFAULT_EXPORT_GAP;
  return { adjustable, gap, height: count * BANNER_HEIGHT * EXPORT_SCALE + (count - 1) * gap };
}
