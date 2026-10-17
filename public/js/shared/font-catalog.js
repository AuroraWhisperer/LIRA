// Complete display fonts, downloaded and cached locally. Restricted title subsets and script fallbacks
// belong to their renderers and are not general-purpose font choices.
export const SHARED_FONTS = Object.freeze([
  { id: 'maiyuan', family: 'Lira Maiyuan', label: '荆南麦圆 · 圆润可爱', playerValue: 'maiyuan' },
  { id: 'kuaile', family: 'Lira Kuaile', label: '站酷快乐体 · 俏皮手写', playerValue: 'kuaile' },
  { id: 'smiley', family: 'Lira Smiley', label: '得意黑 · 活泼醒目', playerValue: 'smiley' },
  { id: 'xiaolai', family: 'Lira Xiaolai', label: '小赖字体 · 软萌手写' },
  { id: 'assorted', family: 'Lira Assorted', label: '猫啃什锦黑 · 俏皮手绘' },
  { id: 'zhimangxing', family: 'Lira Zhimangxing', label: '志莽行 · 洒脱行书' },
  { id: 'mashanzheng', family: 'Lira Mashanzheng', label: '马善政 · 毛笔楷书' },
  { id: 'wenkai', family: '月渡花汀文楷', label: '霞鹜文楷 · 清雅手写' },
].map(font => Object.freeze({ ...font, value: `"${font.family}"` })));

export function findSharedFont(value) {
  return SHARED_FONTS.find(font => font.value === value || font.family === value
    || font.playerValue && font.playerValue === value);
}
