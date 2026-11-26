export const BANNER_WIDTH = 428;
export const BANNER_HEIGHT = 72;
export const BANNER_GAP = 8;

export const EXPORT_SCALE = 2;
export const DEFAULT_EXPORT_GAP = BANNER_GAP * EXPORT_SCALE;

// Export controls and file dimensions use pixels in the final PNG.
export function giftExportRowLayout(count, rowGap = DEFAULT_EXPORT_GAP) {
  return { adjustable: count > 1, gap: rowGap, height: count * BANNER_HEIGHT * EXPORT_SCALE + (count - 1) * rowGap };
}
