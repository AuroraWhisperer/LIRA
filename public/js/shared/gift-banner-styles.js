export const GIFT_BANNER_TAILS = Object.freeze({
  slant: '经典斜切',
  swallowtail: '双色燕尾',
  ribbon: '折叠飘带',
  capsule: '圆角胶囊',
});

export const GIFT_BANNER_TEXTURES = Object.freeze({
  solid: '纯色（原样）',
  satin: '丝缎流光',
  starlight: '星屑幻彩',
  facets: '几何拼片',
  argyle: '菱格织纹',
  polka: '糖纸波点',
  ripple: '水波涟漪',
  lace: '蕾丝花边',
  petals: '花瓣浮纹',
  foil: '碎箔微光',
});

export const DEFAULT_GIFT_BANNER_APPEARANCE = Object.freeze({ tailStyle: 'slant', textureStyle: 'solid', sheen: false });

export function validGiftBannerStyles(tailStyle, textureStyle) {
  return typeof tailStyle === 'string' && Object.hasOwn(GIFT_BANNER_TAILS, tailStyle)
    && typeof textureStyle === 'string' && Object.hasOwn(GIFT_BANNER_TEXTURES, textureStyle);
}

export function validGiftThresholds(values) {
  return Array.isArray(values) && values.length === 3 && [0, 1, 2].every(i =>
    Number.isSafeInteger(values[i]) && values[i] > (i ? values[i - 1] : 0));
}
