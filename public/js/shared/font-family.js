const MULTILINGUAL_FONT_FALLBACK =
  '"Microsoft YaHei", "Microsoft JhengHei", "PingFang SC", "Hiragino Sans GB", "Yu Gothic", "Meiryo", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK SC", "Noto Sans JP", "Noto Sans KR", "Segoe UI", Arial, sans-serif';

export function withMultilingualFallback(fontFamily) {
  const selected = String(fontFamily || '').trim();
  if (!selected) return MULTILINGUAL_FONT_FALLBACK;
  return `${selected}, ${MULTILINGUAL_FONT_FALLBACK}`;
}
