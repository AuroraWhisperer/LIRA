'use strict';

export function renderPresetCards(containerId, presets, labels, swatches) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = Object.entries(presets)
    .map(([key]) => {
      const sw = swatches[key] || ['#181823', '#ccc', '#ccc', '#fff'];
      const label = labels[key] || key;
      return `
      <div class="preset-card" data-theme="${key}">
        <div class="swatch-preview">
          <span style="background:${sw[0]}"></span>
          <span style="background:${sw[1]}"></span>
          <span style="background:${sw[2]}"></span>
          <span style="background:${sw[3]}"></span>
        </div>
        <strong>${label}</strong>
      </div>
    `;
    })
    .join('');
}
