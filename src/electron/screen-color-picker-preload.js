'use strict';

const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('screen');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const sample = document.getElementById('sample');
  const zoom = document.getElementById('zoom').getContext('2d');
  let ready = false;
  const reply = value => ipcRenderer.send('screen-color-picker:reply', value);
  ipcRenderer.once('screen-color-picker:image', async (_event, data) => {
    try {
      const image = new Image();
      image.src = data;
      await image.decode();
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      context.drawImage(image, 0, 0);
      ready = true;
      reply({ type: 'ready' });
    } catch { reply({ type: 'cancel' }); }
  });
  document.addEventListener('mousemove', event => {
    if (!ready) return;
    const x = Math.min(canvas.width - 1, Math.floor(event.clientX / innerWidth * canvas.width));
    const y = Math.min(canvas.height - 1, Math.floor(event.clientY / innerHeight * canvas.height));
    const pixel = context.getImageData(x, y, 1, 1).data;
    document.getElementById('hex').textContent = `#${[...pixel].slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    zoom.imageSmoothingEnabled = false;
    zoom.fillStyle = '#202020';
    zoom.fillRect(0, 0, 99, 99);
    zoom.drawImage(canvas, x - 5, y - 5, 11, 11, 0, 0, 99, 99);
    zoom.strokeStyle = '#000'; zoom.lineWidth = 3; zoom.strokeRect(45, 45, 9, 9);
    zoom.strokeStyle = '#fff'; zoom.lineWidth = 1; zoom.strokeRect(45, 45, 9, 9);
    sample.classList.add('visible');
    sample.style.left = `${Math.max(0, Math.min(event.clientX + 20, innerWidth - sample.offsetWidth))}px`;
    sample.style.top = `${Math.max(0, Math.min(event.clientY + 20, innerHeight - sample.offsetHeight))}px`;
  });
  document.addEventListener('mouseleave', () => sample.classList.remove('visible'));
  document.addEventListener('click', event => {
    if (ready && event.button === 0) reply({ type: 'pick', x: event.clientX / innerWidth, y: event.clientY / innerHeight });
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') reply({ type: 'cancel' }); });
  document.addEventListener('contextmenu', event => { event.preventDefault(); reply({ type: 'cancel' }); });
});
