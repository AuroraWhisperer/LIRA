import { DEFAULT_CLIENT_FONT_ID, clientFontById, isClientFontId } from './client-font-theme.js';

let channel;
let generation = 0;

export async function prepareClientFont(fontId) {
  if (fontId === DEFAULT_CLIENT_FONT_ID) return true;
  const font = clientFontById(fontId);
  if (!font) return false;
  // Some families split their glyphs across files. Load every face before switching.
  const faces = [...document.fonts].filter(face => face.family.replace(/^["']|["']$/g, '') === font.family);
  if (!faces.length) return false;
  try {
    await Promise.all(faces.filter(face => face.status !== 'loaded').map(face => face.load()));
    return true;
  } catch {
    return false;
  }
}

export async function applySavedClientFont(fontId, broadcast = false) {
  if (!isClientFontId(fontId)) return;
  const current = ++generation;
  const root = document.documentElement;
  root.dataset.clientFont = fontId;
  if (broadcast) channel?.postMessage(fontId);
  if (fontId === DEFAULT_CLIENT_FONT_ID) {
    root.style.removeProperty('--client-font-family');
  } else if (await prepareClientFont(fontId) && current === generation) {
    root.style.setProperty('--client-font-family', clientFontById(fontId).value);
  }
}

if (typeof document !== 'undefined' && document.documentElement?.dataset?.clientFont) {
  channel = new globalThis.BroadcastChannel('lira-client-font');
  if (!document.getElementById('clientFont')) {
    channel.onmessage = ({ data }) => { void applySavedClientFont(data); };
  }
  const applyCurrent = () => applySavedClientFont(document.documentElement.dataset.clientFont);
  // The existing loader publishes a new stylesheet when an offline/cold font becomes available.
  const stylesheetLoaded = event => {
    if (event.target.tagName === 'LINK' && new URL(event.target.href).pathname === '/css/shared/display-fonts.css') void applyCurrent();
  };
  document.addEventListener('load', stylesheetLoaded, true);
  window.addEventListener('pagehide', () => {
    channel.close();
    document.removeEventListener('load', stylesheetLoaded, true);
  }, { once: true });
  void applyCurrent();
}
