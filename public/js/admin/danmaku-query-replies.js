// Display examples only; command parsing and statistics remain server-owned.
const QUERY_PERIODS = [
  ['今天', '当天', ['今日']],
  ['昨天', '前一天', ['昨日']],
  ['本周', '本周一开始的一周', ['这周']],
  ['本月', '当月', ['这个月']],
  ['上月', '前一个月', ['上个月']],
  ['今年', '当年'],
  ['去年', '前一年'],
  ['累计', '全部已记录时间', ['历史']],
  ...Array.from({ length: 12 }, (_, index) => [
    `${index + 1}月`, `当年 ${index + 1} 月`, index < 9 ? [`0${index + 1}月`] : [],
    '未写年份时，按发送指令时的北京时间年份查询',
  ]),
  ['2026年', '2026 年', [], '年份可换成其他四位年份，例如“2025年”'],
  ['2026年3月', '2026 年 3 月', ['2026年03月'], '年月可替换，例如“2025年12月”'],
];

const QUERY_REPLIES = [
  ...QUERY_PERIODS.flatMap(([period, label, aliases = [], note = '']) => ['礼物', '盲盒'].map((object) => {
    const variants = aliases.map((alias) => `${alias}${object}`);
    if (period === '累计' && object === '盲盒') variants.push('全部盲盒');
    return {
      trigger: `${period}${object}`,
      reply: `动态查询${label}的${object}记录，回复统计结果。`,
      note: [variants.length ? `也可用${variants.map((alias) => `“${alias}”`).join('、')}` : '', note,
        `时间后可加“的”，例如“${period}的${object}”。`].filter(Boolean).join('；'),
    };
  })),
  { trigger: '本月 礼物名称', reply: '查询指定礼物或盲盒名称的统计结果。', note: '名称须与礼物目录完整一致，适用上述所有时间写法。' },
];

export function initDanmakuQueryReplies({ documentRef = globalThis.document } = {}) {
  const list = documentRef.getElementById('danmakuQueryReplyList');
  if (!list) return;
  const rows = QUERY_REPLIES.map((rule) => {
    const row = documentRef.createElement('div');
    row.className = 'danmaku-custom-reply-row danmaku-query-reply-row';
    const fields = documentRef.createElement('div');
    fields.className = 'danmaku-custom-reply-fields';
    for (const [field, text] of [['trigger', '弹幕指令'], ['reply', '回复说明']]) {
      const label = documentRef.createElement('label');
      label.textContent = text;
      const input = documentRef.createElement('input');
      input.type = 'text';
      input.readOnly = true;
      input.value = rule[field];
      input.setAttribute('aria-label', `${rule.trigger}的${text}`);
      label.append(input);
      fields.append(label);
    }
    const note = documentRef.createElement('small');
    note.className = 'hint danmaku-query-reply-note';
    note.textContent = rule.note;
    fields.append(note);
    row.append(fields);
    return row;
  });
  list.replaceChildren(...rows);
}
