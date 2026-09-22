// Pure rules shared by the desktop form and the Node session owner (Node 24).
export const POLL_RULE = '发送任一完整选项，每个账号首次有效选择计票；以客户端截止前收到并处理为准。';
export const RATING_RULE = '发送整数 1–10，每个账号只计结束前最后一次有效评分。';
export const INTERACTION_LAYOUT = {
  width: 800,
  height: 600,
  listHeight: 352,
  rowHeight: 88,
  pageStep: 320,
  pageSeconds: 8,
};

export function inspectInteractionText(value, max = 10) {
  const text = String(value ?? '')
    .trim()
    .normalize('NFC');
  const segments = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text)].map((part) => part.segment);
  const invalid = segments.some((part) => {
    if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(part)) return true;
    // RGI sequences admit ZWJ, selectors and tags only as part of a full emoji.
    if (/[\p{Cf}\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/u.test(part)) {
      return !/^\p{RGI_Emoji}$/v.test(part);
    }
    return !/[^\p{M}\s]/u.test(part) && !/^ +$/.test(part);
  });
  const error = invalid
    ? '请移除不可见字符或换行'
    : !text || /^\s+$/u.test(text)
      ? '请填写内容'
      : segments.length > max
        ? `最多 ${max} 个可见字符`
        : '';
  return { text, length: segments.length, error };
}

export function validateInteractionConfig(input = {}) {
  if (!['poll', 'rating'].includes(input.kind)) throw new Error('请选择投票或评分');
  if (new TextEncoder().encode(JSON.stringify(input)).length > 16 * 1024) throw new Error('配置不能超过 16 KiB');
  const title = inspectInteractionText(input.title, 60);
  if (title.text && title.error) throw new Error(`主题：${title.error}`);
  const config = { kind: input.kind, title: title.text || (input.kind === 'poll' ? '弹幕投票' : '观众评分') };
  if (input.kind === 'rating') return config;
  if (!Array.isArray(input.options) || input.options.length < 2) throw new Error('请至少填写两个选项');
  const seen = new Set();
  config.options = input.options.map((value, index) => {
    const result = inspectInteractionText(value);
    if (result.error) throw new Error(`选项 ${index + 1}：${result.error}`);
    if (seen.has(result.text)) throw new Error(`选项 ${index + 1}：内容重复`);
    seen.add(result.text);
    return result.text;
  });
  config.durationSeconds = Number(input.durationSeconds);
  if (!Number.isInteger(config.durationSeconds) || config.durationSeconds < 1 || config.durationSeconds > 3600)
    throw new Error('投票时间应为 1–3600 秒的整数');
  const worst = config.options.map((text) => ({ text, votes: Number.MAX_SAFE_INTEGER, percentage: 100 }));
  if (new TextEncoder().encode(JSON.stringify(worst)).length + 2048 > 64 * 1024)
    throw new Error('选项过多，展示快照不能超过 64 KiB');
  return config;
}

export function pollPageDuration(optionCount) {
  const { rowHeight, listHeight, pageStep, pageSeconds } = INTERACTION_LAYOUT;
  const pages = 1 + Math.ceil(Math.max(0, optionCount * rowHeight - listHeight) / pageStep);
  return { pages, seconds: pages * pageSeconds };
}
