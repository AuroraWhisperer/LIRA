// Compatibility entry point; the shared library owns all font choices.
import { populateSystemFontOptions, populateSharedFontOptions, ensureSavedFontOption } from '../shared/font-library.js';
import { DESKTOP_LYRIC_DEFAULTS } from './desktop-lyric-defaults.js';

export function populateDesktopLyricFonts(select) {
  if (!select) return;
  populateSystemFontOptions(select);
  populateSharedFontOptions(select);
  ensureSavedFontOption(select, DESKTOP_LYRIC_DEFAULTS.desktopLyricFontFamily);
  select.value = DESKTOP_LYRIC_DEFAULTS.desktopLyricFontFamily;
}
