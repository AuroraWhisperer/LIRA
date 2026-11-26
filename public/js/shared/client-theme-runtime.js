import { CLIENT_THEME_BY_ID, isClientThemeId } from './client-theme.js';

let channel;

export function applyClientTheme(themeId, { broadcast = false, documentRef = typeof document !== 'undefined' ? document : null, mode, surface } = {}) {
  const root = documentRef?.documentElement;
  if (!root?.dataset || typeof themeId !== 'string' || !themeId) return;
  const theme = isClientThemeId(themeId) ? CLIENT_THEME_BY_ID[themeId] : null;
  root.dataset.clientTheme = themeId;
  const resolvedMode = theme?.mode ?? mode;
  const resolvedSurface = theme?.surface ?? surface;
  if (resolvedMode) root.dataset.clientThemeMode = resolvedMode;
  if (resolvedSurface) root.dataset.clientThemeSurface = resolvedSurface;
  if (broadcast && theme) channel?.postMessage(theme.id);
}

if (typeof document !== 'undefined' && document.documentElement?.dataset?.clientTheme) {
  applyClientTheme(document.documentElement.dataset.clientTheme, { documentRef: document });
  if (typeof globalThis.BroadcastChannel === 'function') {
    channel = new globalThis.BroadcastChannel('lira-client-theme');
    if (!document.getElementById('clientAppearance')) {
      channel.onmessage = ({ data }) => {
        if (isClientThemeId(data)) applyClientTheme(data, { documentRef: document });
      };
    }
    window.addEventListener('pagehide', () => {
      channel.close();
    }, { once: true });
  }
}
