import { html, attr } from './view.js';

function field(name, label, value = '', type = 'text', extra = '') {
  return `<label class="fan-field">${label}<input name="${name}" type="${type}" value="${attr(value ?? '')}" ${extra} /></label>`;
}
function area(name, label, value = '', rows = 3) {
  return `<label class="fan-field fan-field-wide">${label}<textarea name="${name}" rows="${rows}">${html(value || '')}</textarea></label>`;
}
function choice(name, label, options, selected) {
  return `<label class="fan-field">${label}<select name="${name}">${options.map(([value, title]) => `<option value="${value}" ${String(value) === String(selected) ? 'selected' : ''}>${title}</option>`).join('')}</select></label>`;
}
function check(name, label, checked = false) {
  return `<label class="fan-check"><input name="${name}" type="checkbox" ${checked ? 'checked' : ''} />${label}</label>`;
}
function localTime(value) {
  return new Date(Date.parse(value || new Date().toISOString()) + 8 * 3600000)
    .toISOString()
    .slice(0, 16);
}
function isoTime(value) {
  return new Date(`${value}:00+08:00`).toISOString();
}
function day() {
  return localTime().slice(0, 10);
}

export function profileForm(profile = {}) {
  const birthday = profile.birthday || {};
  return {
    title: profile.id ? '编辑粉丝资料' : '新建档案',
    hint: '仅保存在本机，不显示在 OBS、欢迎语或 AI 上下文中。',
    fields:
      field(
        'alias',
        '常用称呼',
        profile.alias,
        'text',
        'required maxlength="100" autofocus',
      ) +
      field(
        'identityValue',
        'B 站身份（可留空）',
        profile.identity?.value,
        'text',
        'maxlength="128"',
      ) +
      choice(
        'identityType',
        '身份类型',
        [
          ['uid', 'UID'],
          ['open_id', '开放平台 open_id'],
        ],
        profile.identity?.type || 'uid',
      ) +
      field(
        'summary',
        '一句话识别摘要',
        profile.summary,
        'text',
        'maxlength="300"',
      ) +
      field('tags', '标签（用逗号分隔）', profile.tags?.join('，')) +
      check('favorite', '特别关注', profile.favorite) +
      '<h3 class="fan-field-wide">基本资料</h3>' +
      field(
        'monthDay',
        '生日月日',
        birthday.monthDay,
        'text',
        'placeholder="09-18" maxlength="5"',
      ) +
      field(
        'year',
        '出生年份（选填）',
        birthday.year,
        'number',
        'min="1900" step="1"',
      ) +
      choice(
        'calendar',
        '历法',
        [
          ['solar', '公历'],
          ['lunar', '农历（本年提醒手动设置）'],
        ],
        birthday.calendar || 'solar',
      ) +
      choice(
        'leapDay',
        '2 月 29 日非闰年提醒',
        [
          ['feb28', '2 月 28 日'],
          ['mar01', '3 月 1 日'],
        ],
        birthday.leapDay || 'feb28',
      ) +
      field(
        'thisYearDate',
        '农历本年对应公历日（选填）',
        birthday.thisYearDate,
        'date',
      ) +
      check('leapMonth', '农历闰月', birthday.leapMonth) +
      check('advance', '生日提前 7 天提醒', birthday.advance) +
      field(
        'zodiac',
        '星座（留空按公历提示）',
        profile.zodiac,
        'text',
        'maxlength="30"',
      ) +
      choice(
        'mbti',
        'MBTI（根据本人自述）',
        [
          ['', '未知'],
          ...[
            'INTJ',
            'INTP',
            'ENTJ',
            'ENTP',
            'INFJ',
            'INFP',
            'ENFJ',
            'ENFP',
            'ISTJ',
            'ISFJ',
            'ESTJ',
            'ESFJ',
            'ISTP',
            'ISFP',
            'ESTP',
            'ESFP',
          ].map((v) => [v, v]),
        ],
        profile.mbti,
      ) +
      field(
        'mbtiConfirmedAt',
        'MBTI 确认日期',
        profile.mbtiConfirmedAt,
        'date',
      ) +
      field(
        'mbtiNote',
        'MBTI 说明',
        profile.mbtiNote,
        'text',
        'maxlength="500"',
      ) +
      area('nextTopic', '下次想聊什么', profile.nextTopic, 2) +
      area('notes', '个人备注', profile.notes, 5) +
      check(
        'milestoneReminders',
        '提醒在舰里程碑',
        profile.milestoneReminders !== false,
      ) +
      check('expiryReminders', '提醒已确认的到期日', profile.expiryReminders),
    read(form) {
      const data = Object.fromEntries(new FormData(form));
      return {
        id: profile.id,
        revision: profile.revision,
        alias: data.alias,
        summary: data.summary,
        identity: data.identityValue
          ? {
              platform: 'bilibili',
              type: data.identityType,
              value: data.identityValue,
            }
          : null,
        tags: data.tags
          .split(/[,，]/)
          .map((v) => v.trim())
          .filter(Boolean),
        favorite: !!data.favorite,
        birthday: data.monthDay
          ? {
              monthDay: data.monthDay,
              year: data.year || null,
              calendar: data.calendar,
              leapDay: data.leapDay,
              leapMonth: !!data.leapMonth,
              advance: !!data.advance,
              thisYearDate: data.thisYearDate,
            }
          : null,
        mbti: data.mbti,
        mbtiNote: data.mbtiNote,
        mbtiConfirmedAt: data.mbtiConfirmedAt,
        zodiac: data.zodiac,
        nextTopic: data.nextTopic,
        notes: data.notes,
        milestoneReminders: !!data.milestoneReminders,
        expiryReminders: !!data.expiryReminders,
      };
    },
  };
}

function membershipFields(data) {
  const type = data.type || 'interval';
  return (
    choice(
      'type',
      '补录或修订内容',
      [
        ['interval', '有效区间'],
        ['baseline', '只补累计 / 连续天数'],
        ['observation', '状态观察（不代表持续有效）'],
        ['first', '首次上舰日期'],
      ],
      type,
    ) +
    '<p class="fan-muted fan-field-wide">修改会重算天数、筛选和未处理提醒，已处理事项不会重复。已知证据冲突时保留上次确认值，先保存为待核实。</p>' +
    `<div class="fan-membership-fields fan-field-wide" data-membership-type="interval" ${type === 'interval' ? '' : 'hidden'}>` +
    field(
      'start',
      '开始日期',
      data.start || (data.startAt ? localTime(data.startAt).slice(0, 10) : ''),
      'date',
    ) +
    field(
      'end',
      '有效至（包含当天）',
      data.end ||
        (data.endAt
          ? localTime(new Date(Date.parse(data.endAt) - 1).toISOString()).slice(
              0,
              10,
            )
          : ''),
      'date',
    ) +
    '</div>' +
    `<div class="fan-membership-fields fan-field-wide" data-membership-type="baseline" ${type === 'baseline' ? '' : 'hidden'}>` +
    field(
      'totalDays',
      '累计天数（留空为未知）',
      data.totalDays,
      'number',
      'min="0" step="1"',
    ) +
    field(
      'continuousDays',
      '本轮连续天数（留空为未知）',
      data.continuousDays,
      'number',
      'min="0" step="1"',
    ) +
    field('asOf', '天数截至日期（含当日）', data.asOf || day(), 'date') +
    '</div>' +
    `<div class="fan-membership-fields fan-field-wide" data-membership-type="observation" ${type === 'observation' ? '' : 'hidden'}>` +
    field(
      'observedAt',
      '观察时间（北京时间）',
      localTime(data.observedAt),
      'datetime-local',
    ) +
    choice(
      'status',
      '观察状态',
      [
        ['observed', '观察到在舰'],
        ['inactive', '确认当时不在舰'],
      ],
      data.status || 'observed',
    ) +
    '</div>' +
    `<div class="fan-membership-fields fan-field-wide" data-membership-type="first" ${type === 'first' ? '' : 'hidden'}>` +
    field('date', '首次上舰日期', data.date, 'date') +
    '</div>' +
    choice(
      'level',
      '大航海等级（区间 / 观察）',
      [
        [3, '舰长'],
        [2, '提督'],
        [1, '总督'],
      ],
      data.level || 3,
    ) +
    area('reason', '依据或修订说明', data.reason)
  );
}

export function recordForm(kind, record) {
  const data = record?.data || {};
  const titles = {
    note: '记一笔',
    topic: '可以聊的话题',
    caution: '相处提醒',
    followup: '下次的约定',
    song: '补记一次点歌',
    preference: '明确音乐偏好',
    anniversary: '纪念日',
    membership: '编辑大航海',
  };
  let fields = '';
  if (kind === 'membership') fields = membershipFields(data);
  else if (kind === 'song')
    fields =
      field(
        'songName',
        '歌名',
        data.songName,
        'text',
        'required maxlength="300"',
      ) +
      field('artist', '歌手', data.artist) +
      field('category', '当时曲库分类', data.category) +
      area('note', '说明', data.note) +
      check(
        'excludeFromStats',
        '排除在偏好统计外（如替别人点歌）',
        data.excludeFromStats,
      ) +
      (record
        ? check('excluded', '解除这条错误关联（保留原始记录）', data.excluded)
        : '');
  else if (kind === 'preference')
    fields =
      choice(
        'sentiment',
        '偏好',
        [
          ['like', '喜欢'],
          ['dislike', '不喜欢'],
        ],
        data.sentiment || 'like',
      ) +
      field(
        'label',
        '歌曲、歌手、风格或类别',
        data.label,
        'text',
        'required maxlength="300"',
      ) +
      area('reason', '根据哪次交流确认', data.reason);
  else if (kind === 'anniversary')
    fields =
      field(
        'name',
        '纪念日名称',
        data.name,
        'text',
        'required maxlength="100"',
      ) +
      field('date', '日期', data.date, 'date', 'required') +
      check('annual', '每年重复', data.annual) +
      field(
        'advanceDays',
        '提前提醒天数',
        data.advanceDays || 0,
        'number',
        'min="0" max="30" step="1"',
      ) +
      area('note', '说明', data.note);
  else
    fields =
      area(
        'body',
        kind === 'caution' ? '哪些话题不适合提起' : '内容',
        data.body,
        5,
      ) +
      (kind !== 'note'
        ? field('tag', '标签（选填）', data.tag, 'text', 'maxlength="50"')
        : '') +
      (['caution', 'followup'].includes(kind)
        ? field(
            'reviewDate',
            kind === 'caution' ? '复查日期（选填）' : '提醒日期（选填）',
            data.reviewDate,
            'date',
          )
        : '') +
      (kind === 'followup'
        ? check('completed', '已经完成', data.completed)
        : '') +
      check('pinned', '置顶', data.pinned);
  fields += field(
    'occurredAt',
    '发生时间（北京时间）',
    localTime(record?.occurredAt),
    'datetime-local',
    'required',
  );
  if (record && !['song', 'membership'].includes(kind))
    fields += check('archived', '归档这条资料', data.archived);
  return {
    title: record ? `修订${titles[kind]}` : titles[kind],
    fields,
    hint:
      kind === 'preference'
        ? '记录偏好不会增加点歌次数。'
        : '取消不保存；自动记录的原始身份、事件与来源始终保留。',
    read(form) {
      const values = Object.fromEntries(new FormData(form));
      const result = { ...values };
      for (const key of [
        'pinned',
        'archived',
        'completed',
        'annual',
        'excludeFromStats',
        'excluded',
      ])
        result[key] = !!values[key];
      for (const key of [
        'level',
        'advanceDays',
        'totalDays',
        'continuousDays',
      ]) {
        if (key in values)
          result[key] = values[key] === '' ? null : Number(values[key]);
      }
      if (values.observedAt) result.observedAt = isoTime(values.observedAt);
      return {
        id: record?.id,
        revision: record?.revision,
        kind,
        data: result,
        occurredAt: isoTime(values.occurredAt),
      };
    },
    bind(form) {
      form.elements.type?.addEventListener('change', () => {
        for (const panel of form.querySelectorAll('[data-membership-type]'))
          panel.hidden =
            panel.dataset.membershipType !== form.elements.type.value;
      });
    },
  };
}

export function settingsForm(settings) {
  return {
    title: '粉丝档案自动更新',
    hint: '普通观众和普通点歌不会自动批量建档。',
    fields:
      '<p class="fan-field-wide">推荐让已建档粉丝自动更新；收到可靠大航海记录时为新粉丝建档。生日、备注与话题仍只保存在本机。</p>' +
      check(
        'autoUpdate',
        '自动更新已建档粉丝的昵称与点歌、上舰事实',
        settings.autoUpdate !== false,
      ) +
      check(
        'autoCreate',
        '收到可验证的大航海记录时自动建档',
        settings.autoCreate !== false,
      ),
    read: (form) => ({
      autoUpdate: form.elements.autoUpdate.checked,
      autoCreate: form.elements.autoCreate.checked,
    }),
  };
}

export function exportForm() {
  return {
    title: '导出档案列表',
    hint: 'CSV 列表不能恢复完整档案；要迁移或恢复，请保存完整备份。',
    fields: [
      ['alias', '常用称呼'],
      ['platformName', '平台昵称'],
      ['uid', 'UID / open_id'],
      ['summary', '识别摘要'],
      ['birthday', '生日'],
      ['mbti', 'MBTI'],
      ['notes', '个人备注'],
    ]
      .map(([key, label], i) => check(key, label, i < 3))
      .join(''),
    read: (form) => ({ fields: [...new FormData(form).keys()] }),
  };
}

export function legacyForm(profile) {
  return {
    title: '预览本机旧点歌',
    hint: '旧点歌没有主播归属，预览后需明确确认属于当前账号。',
    fields:
      `<p class="fan-field-wide">仅查找 UID ${html(profile.identity?.value || '')} 的记录。无可靠身份、其他账号记录不会补入。</p>` +
      field('from', '开始日期', '2000-01-01', 'date', 'required') +
      field('to', '结束日期', day(), 'date', 'required'),
    read: (form) => ({
      profileId: profile.id,
      from: form.elements.from.value,
      to: form.elements.to.value,
    }),
  };
}
