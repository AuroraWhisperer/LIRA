// Display examples only; command parsing and statistics remain server-owned.
const COMMON_PERIODS = [
  { label: '今天', aliases: ['今日'] },
  { label: '昨天', aliases: ['昨日'] },
  { label: '本周', aliases: ['这周'], note: '从周一开始' },
  { label: '本月', aliases: ['这个月'] },
  { label: '上月', aliases: ['上个月'] },
  { label: '今年' },
  { label: '去年' },
  { label: '累计', aliases: ['历史'], note: '全部已记录时间' },
];

const TIME_PERIODS = [
  { label: '指定月份', prefix: 'x月', search: '两位月份 未写年份 今年' },
  { label: '指定年份', prefix: '2026年', search: '四位年份' },
  { label: '指定年月', prefix: '2026年x月', search: '两位月份 四位年份' },
];

function periodRule(period) {
  const prefix = period.prefix || period.label;
  const aliases = period.aliases || [];
  const blindAliases = aliases.map((alias) => `${alias}盲盒`);
  if (period.label === '累计') blindAliases.push('全部盲盒');
  return {
    ...period,
    gift: `${prefix}礼物`,
    blind: `${prefix}盲盒`,
    giftAliases: aliases.map((alias) => `${alias}礼物`),
    blindAliases,
  };
}

const QUERY_GROUPS = [
  { title: '常用查询', rules: COMMON_PERIODS.map(periodRule) },
  {
    title: '指定时间',
    helpLabel: '指定时间写法说明',
    help: '“x”代表月份，请换成 1—12 的数字。例如“3月礼物”表示查询今年 3 月，“03月礼物”也可以；不写年份时，按今年查询。“2026”是年份示例，可以换成其他四位年份，例如“2025年礼物”或“2025年3月盲盒”。',
    rules: TIME_PERIODS.map(periodRule),
  },
  {
    title: '按名称查询',
    helpLabel: '按名称查询说明',
    help: '把“礼物名称”替换成礼物或盲盒的完整名称，不能只填简称。“本月”也可以换成上面的其他时间，例如“今天”“今年”或“2026年3月”。',
    rules: [{ label: '指令示例', gift: '本月 礼物名称', giftAliases: [], blindAliases: [], search: '完整名称 礼物名称 盲盒名称' }],
  },
];

function createCommandCell(documentRef, command, aliases, kind) {
  const cell = documentRef.createElement('div');
  cell.className = 'danmaku-query-reply-command';
  const text = documentRef.createElement('span');
  text.className = 'danmaku-query-command-text';
  text.textContent = command;
  text.setAttribute('aria-label', `${kind}：${command}`);
  cell.append(text);
  if (aliases.length) {
    const alias = documentRef.createElement('small');
    alias.className = 'hint danmaku-query-reply-alias';
    alias.textContent = `也可：${aliases.join('、')}`;
    cell.append(alias);
  }
  return cell;
}

function createRow(documentRef, rule) {
  const row = documentRef.createElement('div');
  row.className = 'danmaku-custom-reply-row danmaku-query-reply-row';
  row.dataset.search = [rule.search, ...rule.giftAliases, ...rule.blindAliases].filter(Boolean).join(' ');
  const period = documentRef.createElement('div');
  period.className = 'danmaku-query-reply-period';
  const label = documentRef.createElement('span');
  label.textContent = rule.label;
  period.append(label);
  if (rule.note) {
    const note = documentRef.createElement('small');
    note.className = 'hint';
    note.textContent = rule.note;
    period.append(note);
  }
  const gift = createCommandCell(documentRef, rule.gift, rule.giftAliases, rule.blind ? '礼物指令' : '名称查询指令');
  row.append(period, gift);
  if (rule.blind) {
    row.append(createCommandCell(documentRef, rule.blind, rule.blindAliases, '盲盒指令'));
  } else {
    gift.classList.add('danmaku-query-reply-name-command');
  }
  return row;
}

export function initDanmakuQueryReplies({ documentRef = globalThis.document } = {}) {
  const list = documentRef.getElementById('danmakuQueryReplyList');
  if (!list) return;
  const groups = QUERY_GROUPS.map((group) => {
    const section = documentRef.createElement('section');
    section.className = 'danmaku-query-reply-group';
    const heading = documentRef.createElement('h5');
    heading.className = 'danmaku-query-reply-heading';
    const title = documentRef.createElement('span');
    title.textContent = group.title;
    heading.append(title);
    if (group.help) {
      const help = documentRef.createElement('lira-help');
      help.setAttribute('label', group.helpLabel);
      help.textContent = group.help;
      heading.append(help);
    }
    section.append(heading);
    if (group.title !== '按名称查询') {
      const columns = documentRef.createElement('div');
      columns.className = 'danmaku-query-reply-columns danmaku-query-reply-column-head';
      columns.setAttribute('aria-hidden', 'true');
      for (const text of ['查询时间', '礼物指令', '盲盒指令']) {
        const label = documentRef.createElement('span');
        label.textContent = text;
        columns.append(label);
      }
      section.append(columns);
    }
    section.append(...group.rules.map((rule) => createRow(documentRef, rule)));
    return section;
  });
  list.replaceChildren(...groups);
}
