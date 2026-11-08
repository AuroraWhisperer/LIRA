// 全屏礼物感谢：导入的图片/视频样式各自持有开关与触发金额；金额判断由礼物领域负责。
export const GIFT_FRAME_STYLE_TRIGGERS_KEY = 'giftFrameStyleTriggers';
export const GIFT_FRAME_STYLE_DEFAULT_THRESHOLD = '20';
export const MAX_GIFT_FRAME_STYLE_TRIGGERS = 1000;

// 只有媒体样式消费礼物事件；网页样式是浏览器源，CSS 样式套用在内置组件上。
export function isGiftFrameTriggerStyle(style) {
  return style?.type === 'gift-frame' && Boolean(style.config?.mediaStyle);
}

// 导入的图片/视频图层只播放列出自己的事件；其他图层不播放导入样式事件。预览样例都可播放。
export function isGiftFrameEventForLayer(config = {}, payload = {}) {
  if (payload.preview) return true;
  return config.mediaStyle ? Boolean(payload.styleIds?.includes(config.mediaStyle.id)) : payload.themeId !== 'imported';
}

// '' 表示尚未迁移：沿用升级前的规则，与林间花信共用开关和金额。
export function parseGiftFrameStyleTriggers(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

export function readGiftFrameStyleTrigger(settings = {}, styleId, triggers = parseGiftFrameStyleTriggers(settings[GIFT_FRAME_STYLE_TRIGGERS_KEY])) {
  const entry = triggers && Object.hasOwn(triggers, styleId) ? triggers[styleId] : null;
  if (entry) return { enabled: entry.enabled === 'true', thresholdRmb: String(entry.thresholdRmb) };
  if (triggers) return { enabled: false, thresholdRmb: GIFT_FRAME_STYLE_DEFAULT_THRESHOLD };
  return { enabled: settings.giftFrameEnabled === 'true',
    thresholdRmb: String(settings.giftFrameThresholdRmb ?? GIFT_FRAME_STYLE_DEFAULT_THRESHOLD) };
}

// 返回整份映射；尚未迁移时先为已知样式写入当前生效值，避免其他样式被关闭。
export function writeGiftFrameStyleTrigger(settings = {}, knownStyleIds, styleId, trigger) {
  const current = parseGiftFrameStyleTriggers(settings[GIFT_FRAME_STYLE_TRIGGERS_KEY]);
  const triggers = current ? { ...current } : Object.fromEntries(knownStyleIds.map(id => {
    const { enabled, thresholdRmb } = readGiftFrameStyleTrigger(settings, id);
    return [id, { enabled: String(enabled), thresholdRmb }];
  }));
  triggers[styleId] = { enabled: String(Boolean(trigger.enabled)), thresholdRmb: String(trigger.thresholdRmb) };
  return JSON.stringify(triggers);
}
