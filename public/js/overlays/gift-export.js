import { BANNER_WIDTH, createGiftBanner, createGiftArtworkResolver, readyGiftImages } from '../shared/gift-banner.js';
import { EXPORT_SCALE, giftExportRowLayout } from '../shared/gift-banner-layout.js';
import { setRoomGuardState } from '../shared/bilibili-room-guard.js';

let config;
let artwork;

window.initializeGiftExport = (snapshot) => {
  setRoomGuardState(snapshot.roomGuard);
  config = { ...snapshot.config, sheen: false };
  artwork = createGiftArtworkResolver(snapshot.catalog);
};

window.renderGiftExport = async ({ items, background, rowGap }) => {
  const stage = document.getElementById('stage');
  const { gap, height } = giftExportRowLayout(items.length, rowGap);
  stage.style.rowGap = `${gap / EXPORT_SCALE}px`;
  document.body.style.background = background === 'white' ? '#fff' : 'transparent';
  stage.replaceChildren(...items.map((item) => createGiftBanner(item, config, artwork)));
  await readyGiftImages(stage);
  return {
    width: Math.max(BANNER_WIDTH * EXPORT_SCALE, Math.ceil(stage.getBoundingClientRect().width)),
    height,
  };
};

window.positionGiftExport = async (top) => {
  document.getElementById('stage').style.translate = `0 -${top}px`;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
