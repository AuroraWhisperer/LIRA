// 编写人：Aurora
// 使用文档截图：点击、Enter 或空格查看大图；Esc 或点击任意位置关闭。
'use strict';

export function initUsageGuideLightbox(panel) {
  const main = panel.querySelector('.usage-guide-main');
  if (!main) return;
  let lightbox = null;
  let lightboxImage = null;

  function openLightbox(source) {
    if (!lightbox) {
      lightbox = document.createElement('dialog');
      lightbox.className = 'usage-guide-lightbox';
      lightbox.setAttribute('aria-label', '查看大图');
      lightboxImage = document.createElement('img');
      lightboxImage.className = 'usage-guide-lightbox-image';
      const closeButton = document.createElement('button');
      closeButton.type = 'button';
      closeButton.className = 'icon usage-guide-lightbox-close';
      closeButton.setAttribute('aria-label', '关闭大图');
      closeButton.textContent = '×';
      lightbox.append(lightboxImage, closeButton);
      lightbox.addEventListener('click', () => lightbox.close());
      document.body.append(lightbox);
    }
    lightboxImage.src = source.currentSrc || source.src;
    lightboxImage.alt = source.alt;
    lightbox.showModal();
  }

  main.querySelectorAll('.usage-guide-image').forEach((image) => {
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
  });
  main.addEventListener('click', (event) => {
    const image = event.target.closest('.usage-guide-image');
    if (image) openLightbox(image);
  });
  main.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const image = event.target.closest('.usage-guide-image');
    if (!image) return;
    // 取消默认行为：空格不滚动页面，同一次 Enter 也不会点中大图里的关闭按钮。
    event.preventDefault();
    openLightbox(image);
  });
}
