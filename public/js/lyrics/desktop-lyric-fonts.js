const FONT_OPTIONS = Object.freeze({
  'Lira Maiyuan': '荆南麦圆 · 圆润可爱',
  'Lira Kuaile': '站酷快乐体 · 俏皮手写',
  'Lira Smiley': '得意黑 · 活泼醒目',
  'Lira Xiaolai': '小赖字体 · 软萌手写',
  'Lira Assorted': '猫啃什锦黑 · 俏皮手绘',
  'Microsoft YaHei, Microsoft JhengHei, PingFang SC, Hiragino Sans GB, Yu Gothic, Meiryo, Malgun Gothic, Apple SD Gothic Neo, Noto Sans CJK SC, Noto Sans JP, Noto Sans KR, Segoe UI, Arial, sans-serif': '系统字体',
  'Microsoft YaHei': '微软雅黑',
  'PingFang SC, Microsoft YaHei, sans-serif': '苹方 · 现代简约',
  'SimHei, Microsoft YaHei, sans-serif': '黑体 · 醒目有力',
  'KaiTi, STKaiti, serif': '楷体 · 优雅手写',
  'system-ui, -apple-system, sans-serif': '系统默认无衬线',
  'SimSun, STSong, serif': '宋体 · 传统典雅',
  'Noto Sans SC, Noto Sans JP, Microsoft YaHei, sans-serif': '思源黑体 · 清晰现代',
  'YouYuan, STYuanti, PingFang SC, sans-serif': '幼圆 · 圆润亲切',
  'Georgia, Times New Roman, STSong, serif': 'Georgia · 优雅衬线',
  'Courier New, Consolas, monospace': '等宽字体 · 极客风格',
});

export function populateDesktopLyricFonts(select) {
  if (!select) return;
  select.replaceChildren(...Object.entries(FONT_OPTIONS).map(([value, title]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = title;
    return option;
  }));
}
