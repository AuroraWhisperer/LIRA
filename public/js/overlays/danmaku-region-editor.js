import { moveRegion } from '../shared/danmaku-layout.js';

export function initRegionEditor(element, { getLayout, getStyle, getScale, change }) {
  let gesture = null;
  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    element.focus();
    gesture = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      region: { ...getLayout().regions[getStyle()] }, handle: event.target.dataset.handle || '',
    };
    element.setPointerCapture(event.pointerId);
  });
  element.addEventListener('pointermove', (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const scale = getScale();
    change(moveRegion(gesture.region, gesture.handle,
      (event.clientX - gesture.x) / scale, (event.clientY - gesture.y) / scale, getLayout().canvas));
  });
  function finish(event) {
    if (!gesture || gesture.id !== event.pointerId) return;
    gesture = null;
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
  }
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', (event) => {
    if (gesture) change(gesture.region);
    finish(event);
  });
  element.addEventListener('lostpointercapture', () => { gesture = null; });
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && gesture) {
      event.stopPropagation();
      change(gesture.region);
      finish({ pointerId: gesture.id });
      return;
    }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    const layout = getLayout();
    change(moveRegion(layout.regions[getStyle()], '', delta[0] * step, delta[1] * step, layout.canvas));
  });
}
