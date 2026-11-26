import { SHARED_FONTS } from './font-catalog.js';

// Each family covers the CJK basic block and printable ASCII on its own.
export const CLIENT_FONT_IDS = Object.freeze(['wenkai', 'xiaolai', 'yozai']);
export const DEFAULT_CLIENT_FONT_ID = 'system';

export function isClientFontId(id) {
  return id === DEFAULT_CLIENT_FONT_ID || CLIENT_FONT_IDS.includes(id);
}

export function clientFontById(id) {
  if (CLIENT_FONT_IDS.includes(id)) return SHARED_FONTS.find(font => font.id === id);
}
