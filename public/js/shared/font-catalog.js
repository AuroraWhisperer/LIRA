// Complete fonts shared by all components after local resource initialization.
// Restricted title subsets stay with their renderers and outside the shared menu.
export const SHARED_FONTS = Object.freeze([
  { id: 'maiyuan', family: 'Lira Maiyuan', label: '荆南麦圆 · 圆润可爱', playerValue: 'maiyuan' },
  { id: 'kuaile', family: 'Lira Kuaile', label: '站酷快乐体 · 俏皮手写', playerValue: 'kuaile' },
  { id: 'smiley', family: 'Lira Smiley', label: '得意黑 · 活泼醒目', playerValue: 'smiley' },
  { id: 'xiaolai', family: 'Lira Xiaolai', label: '小赖字体 · 软萌手写' },
  { id: 'yozai', family: 'Lira Yozai', label: '悠哉字体 · 自然手写' },
  { id: 'assorted', family: 'Lira Assorted', label: '猫啃什锦黑 · 俏皮手绘' },
  { id: 'zhimangxing', family: 'Lira Zhimangxing', label: '志莽行 · 洒脱行书' },
  { id: 'mashanzheng', family: 'Lira Mashanzheng', label: '马善政 · 毛笔楷书' },
  { id: 'wenkai', family: '月渡花汀文楷', label: '霞鹜文楷 · 清雅手写' },
  { id: 'nunito', family: 'Spooky Nunito', label: 'Nunito · 圆润西文', sample: 'Nunito' },
  { id: 'gowun-dodum', family: 'Lira Gowun Dodum', label: 'Gowun Dodum · 韩文圆体', sample: '한글' },
  { id: 'noto-sans', family: 'Lira Noto Sans', label: 'Noto Sans · 多语种黑体', sample: 'Noto Sans' },
  { id: 'noto-serif-tibetan', family: 'Lira Noto Serif Tibetan', label: 'Noto Serif Tibetan · 藏文衬线', sample: 'བོད་ཡིག' },
  { id: 'source-han-serif', family: 'Lira Sea Breeze Serif', label: '思源宋体 · 典雅宋体' },
  { id: 'poppins', family: 'Stargazer Poppins', label: 'Poppins · 几何西文', sample: 'Poppins' },
  { id: 'quicksand', family: 'Lira Quicksand', label: 'Quicksand · 圆润西文', sample: 'Quicksand' },
  { id: 'montserrat', family: 'Gradient Montserrat', label: 'Montserrat · 现代西文', sample: 'Montserrat' },
  { id: 'cinzel', family: 'Celestial Cinzel', label: 'Cinzel · 古典西文', sample: 'CINZEL' },
  { id: 'mplus-rounded', family: 'Lira Rounded Mplus', label: 'M PLUS Rounded 1c · 日文圆体', sample: '丸文字' },
].map(font => Object.freeze({ ...font, value: `"${font.family}"` })));

export function findSharedFont(value) {
  return SHARED_FONTS.find(font => font.value === value || font.family === value
    || font.playerValue && font.playerValue === value);
}
