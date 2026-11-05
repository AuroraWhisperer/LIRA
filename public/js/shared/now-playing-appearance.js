export const NOW_PLAYING_FIELDS = Object.freeze({
  style: { label: '唱片样式', type: 'select', default: 'vinyl', options: { vinyl: '黑胶唱片', cover: '圆形封面', turntable: '唱片机' } },
  nowPlayingLayout: { label: '布局', type: 'select', default: 'horizontal', options: { horizontal: '唱片在左', vertical: '唱片在上' } },
  nowPlayingRecordSize: { label: '唱片大小', type: 'number', default: 120, min: 48, max: 360, step: 1 },
  nowPlayingGap: { label: '唱片与文字间距', type: 'number', default: 24, min: 0, max: 100, step: 1 },
  nowPlayingShowRecord: { label: '显示唱片', type: 'checkbox', default: true },
  nowPlayingShowTitle: { label: '显示歌名', type: 'checkbox', default: true },
  nowPlayingShowArtist: { label: '显示歌手', type: 'checkbox', default: true },
  nowPlayingFontFamily: { label: '字体', type: 'text', default: 'Microsoft YaHei', maxLength: 256 },
  nowPlayingTitleFontSize: { label: '歌名字号', type: 'number', default: 32, min: 12, max: 96, step: 1 },
  nowPlayingArtistFontSize: { label: '歌手字号', type: 'number', default: 18, min: 10, max: 64, step: 1 },
  nowPlayingTitleColor: { label: '歌名颜色', type: 'color', default: '#74618c' },
  nowPlayingArtistColor: { label: '歌手颜色', type: 'color', default: '#9a88af' },
  nowPlayingRotation: { label: '播放时旋转唱片', type: 'checkbox', default: true },
  nowPlayingRotationSeconds: { label: '旋转一圈（秒）', type: 'number', default: 20, min: 5, max: 60, step: 1 },
  nowPlayingHideOnPause: { label: '暂停时隐藏', type: 'checkbox', default: false },
  nowPlayingHideWhenEmpty: { label: '没有歌曲时隐藏', type: 'checkbox', default: true },
  nowPlayingOpacity: { label: '整体不透明度', type: 'number', default: 1, min: 0, max: 1, step: 0.05 },
});

export const NOW_PLAYING_DEFAULTS = Object.freeze(Object.fromEntries(
  Object.entries(NOW_PLAYING_FIELDS).map(([key, field]) => [key, field.default]),
));
