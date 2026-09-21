// ESM adapter for the synchronous classic-script utility owner.
import './overlay-utils.js';

export const {
  escapeHtml,
  hexToRgb,
  hexToRgba,
  withMultilingualFallback,
  scrollTravelSeconds,
  overlayLowPowerEnabled,
} = window.OverlayUtils;
