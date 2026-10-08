// Optional scene overrides. Missing fields continue to follow the selected built-in style.
export const OPENING_APPEARANCE_FIELDS = Object.freeze({
  title: { label: '主标题', type: 'text', default: '唱一首，在一首，给你的歌', maxLength: 20 },
  subtitle: { label: '副标题', type: 'text', default: '开播准备中', maxLength: 40 },
  name: { label: '主播名', type: 'text', default: '', maxLength: 32 },
  footer: { label: '底部文案', type: 'text', default: '欢迎来到直播间', maxLength: 48 },
  quality: { label: '画质', type: 'select', default: 'normal', options: { normal: '普通 · 推荐', high: '高', low: '低' } },
  trackMotion: { label: '轨道动效', type: 'select', default: 'heart', options: { heart: '心形巡航', barber: '灯带循环', progress: '流光进度' } },
  showNotes: { label: '漂浮音符', type: 'checkbox', default: true },
  showEq: { label: '氛围律动', type: 'checkbox', default: true },
});

export const MOONLIT_OPENING_DEFAULTS = Object.freeze({
  title: '月渡花汀', subtitle: '直播即将开始', name: '', footer: '风起花汀，静候君来',
  quality: 'normal', showNotes: true, showEq: true,
});

export function openingAppearanceFields(style) {
  return Object.fromEntries(Object.entries(OPENING_APPEARANCE_FIELDS).filter(([key]) =>
    !(style === 'pixel-cassette' && ['title', 'subtitle', 'name', 'footer', 'trackMotion'].includes(key))
    && !(style === 'moonlit-fan' && key === 'trackMotion')).map(([key, field]) => [key, {
    ...field,
    ...(style === 'moonlit-fan' ? { default: MOONLIT_OPENING_DEFAULTS[key],
      label: key === 'showNotes' ? '飘落花瓣' : key === 'showEq' ? '翩飞蝴蝶' : field.label } : {}),
  }]));
}

export function resolveOpeningAppearance(data, appearance = {}) {
  const { styles, ...base } = data || {};
  const style = appearance.resourceStyle?.preset === 'moonlit-opening' ? 'moonlit-fan'
    : appearance.style === 'original' || !appearance.style ? data?.style : appearance.style;
  const source = styles?.[style] || base;
  const own = Object.fromEntries(Object.keys(OPENING_APPEARANCE_FIELDS)
    .filter(key => Object.hasOwn(appearance, key)).map(key => [key, appearance[key]]));
  return { ...base, ...source, ...(appearance.resourceStyle ? { ...MOONLIT_OPENING_DEFAULTS,
    audio: 'none', audioUrl: '', characterUrl: '', pixelCharacterUrl: '' } : {}), ...own, style,
    enabled: data?.enabled, ...(data?.audio === 'none' ? { audio: 'none' } : {}) };
}
