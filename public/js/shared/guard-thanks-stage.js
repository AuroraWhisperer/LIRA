// 大航海感谢的共用基座：时间常量、缓动曲线、DOM 工具与昵称缩放。
// 经典（徽章）与辉光（柔和）两套渲染器共用，自身不产出任何视觉元素。
export const ENTER_MS = 1500;
export const EXIT_MS = 700;
export const AVATAR_WAIT_MS = 700;
export const COMPRESSED_HOLD_RATIO = 0.45;
// 辉光风格更柔和，连播时压缩得更轻，避免总督档被压垮。
export const AURORA_COMPRESSED_HOLD_RATIO = 0.7;
export const AURORA_EXIT_MS = 1000;
export const MEDALLION_CENTER = Object.freeze({ x: 640, y: 500 });
export const PARTICLE_OFFSET_X = 320;

export const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';
export const EASE_POP = 'cubic-bezier(.2,.8,.3,1)';
export const EASE_IN = 'cubic-bezier(.55,0,.75,.2)';
export const EASE_SWAY = 'cubic-bezier(.45,0,.55,1)';
// 有机的光不该匀速：辉光风格统一使用这条慢出曲线。
export const EASE_ORGANIC = 'cubic-bezier(.32,.72,0,1)';

export function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function cssColor(node, name) {
  return getComputedStyle(node).getPropertyValue(name).trim();
}

export function fitName(name) {
  let size = 40;
  while (size > 28 && name.scrollWidth > name.clientWidth + 1) {
    size -= 2;
    name.style.fontSize = `${size}px`;
  }
}
