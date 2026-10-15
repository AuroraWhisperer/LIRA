export function readDesktopLyricFormSettings(defaults = {}) {
  const values = {};
  for (const key of Object.keys(defaults)) {
    if (key === 'desktopLyricTextAlign') {
      values[key] =
        document.querySelector('input[name="desktopLyricTextAlign"]:checked')?.value || defaults.desktopLyricTextAlign;
      continue;
    }
    if (key === 'desktopLyricKaraokeMode') {
      values[key] =
        document.querySelector('input[name="desktopLyricKaraokeMode"]:checked')?.value ||
        defaults.desktopLyricKaraokeMode;
      continue;
    }
    if (key === 'desktopLyricKaraokeEnabled') {
      values[key] =
        document.querySelector('input[name="desktopLyricKaraokeMode"]:checked')?.value === 'off' ? 'false' : 'true';
      continue;
    }
    const input = document.getElementById(key);
    if (input) values[key] = document.getElementById(`${key}Inherited`)?.checked
      ? '' : input.type === 'checkbox' ? String(input.checked) : input.value;
  }
  return values;
}

export function syncDesktopLyricKaraokeColorControls(settings) {
  const input = document.getElementById('desktopLyricSungColor');
  const inherit = document.getElementById('desktopLyricSungColorInherited');
  if (!input || !inherit) return;
  inherit.checked = !settings.desktopLyricSungColor;
  input.disabled = inherit.checked;
  input.value = settings.desktopLyricSungColor || '#ffcf4a';
}

export function setDesktopLyricBackground(background) {
  const solid = background === 'solid';
  document.getElementById('desktopLyricPreviewStage')?.classList.toggle('is-solid', solid);
  document.querySelectorAll('[data-lyric-preview-background]').forEach((button) => {
    const active = button.dataset.lyricPreviewBackground === (solid ? 'solid' : 'grid');
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
