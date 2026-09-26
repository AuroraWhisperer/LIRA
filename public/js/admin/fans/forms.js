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
  return new Date(Date.parse(value || new Date().toISOString()) + 8 * 3600000).toISOString().slice(0, 16);
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
    title: profile.id ? '编辑粉丝档案' : '新建粉丝档案',
    profileEditor: true,
    saveLabel: profile.id ? '保存修改' : '创建档案',
    fields:
      `<div class="fan-profile-form fan-field-wide">
        <p class="fan-profile-intro">${profile.platformName ? '卡片显示最新平台昵称，常用称呼与其他资料可按需填写。' : profile.id ? '除常用称呼外，其余信息均为选填。' : '填写常用称呼即可创建，其余信息可稍后补充。'}</p>
        <div class="fan-profile-tabs" role="tablist" aria-label="档案信息">
          <button type="button" id="fanProfileBasicTab" role="tab" aria-controls="fanProfileBasic" aria-selected="true">基本信息</button>
          <button type="button" id="fanProfilePersonalTab" role="tab" aria-controls="fanProfilePersonal" aria-selected="false" tabindex="-1">生日与性格</button>
          <button type="button" id="fanProfileNotesTab" role="tab" aria-controls="fanProfileNotes" aria-selected="false" tabindex="-1">备注与提醒</button>
        </div>
        <section id="fanProfileBasic" class="fan-profile-panel" role="tabpanel" aria-labelledby="fanProfileBasicTab">
        <div class="fan-field-wide">` +
      field(
        'alias',
        profile.platformName ? '常用称呼' : '常用称呼（必填）',
        profile.alias,
        'text',
        `${profile.platformName ? '' : 'required '}maxlength="100" autofocus placeholder="你平时怎么称呼这位粉丝"`,
      ) +
      '</div>' +
      area('formerNames', '曾用名（最多 3 个，每行一个，由近到远）', profile.formerNames?.join('\n'), 3) +
      choice(
        'identityType',
        'B 站账号类型',
        [
          ['uid', 'B 站 UID（个人主页可查看）'],
          ['open_id', '开放平台账号'],
        ],
        profile.identity?.type || 'uid',
      ) +
      field(
        'identityValue',
        'B 站账号 ID',
        profile.identity?.value,
        'text',
        'maxlength="128" placeholder="不清楚可以先留空"',
      ) +
      '<div class="fan-field-wide">' +
      field(
        'summary',
        '一句话印象',
        profile.summary,
        'text',
        'maxlength="300" placeholder="例如：喜欢听民谣，经常在周末来"',
      ) +
      '</div>' +
      field('tags', '标签', profile.tags?.join('，'), 'text', 'placeholder="用逗号分隔，例如：老朋友，民谣"') +
      check('favorite', '特别关注', profile.favorite) +
      '</section><section id="fanProfilePersonal" class="fan-profile-panel" role="tabpanel" aria-labelledby="fanProfilePersonalTab" hidden>' +
      choice(
        'calendar',
        '生日历法',
        [
          ['solar', '公历'],
          ['lunar', '农历'],
        ],
        birthday.calendar || 'solar',
      ) +
      field('monthDay', '生日（月-日）', birthday.monthDay, 'text', 'placeholder="例如：09-18" maxlength="5"') +
      field('year', '出生年份', birthday.year, 'number', 'min="1900" step="1" placeholder="不清楚可以留空"') +
      check('advance', '提前 7 天提醒生日', birthday.advance) +
      choice(
        'leapDay',
        '非闰年的生日提醒日期',
        [
          ['feb28', '2 月 28 日'],
          ['mar01', '3 月 1 日'],
        ],
        birthday.leapDay || 'feb28',
      ) +
      field('thisYearDate', '今年的公历生日（用于农历提醒）', birthday.thisYearDate, 'date') +
      check('leapMonth', '农历闰月', birthday.leapMonth) +
      '<div class="fan-profile-divider fan-field-wide"></div>' +
      field('zodiac', '星座', profile.zodiac, 'text', 'maxlength="30" placeholder="留空时按公历生日提示"') +
      choice(
        'mbti',
        'MBTI（本人自述）',
        [
          ['', '暂不填写'],
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
      field('mbtiConfirmedAt', '确认日期', profile.mbtiConfirmedAt, 'date') +
      field(
        'mbtiNote',
        'MBTI 补充说明',
        profile.mbtiNote,
        'text',
        'maxlength="500" placeholder="例如：最近一次测试的结果"',
      ) +
      '</section><section id="fanProfileNotes" class="fan-profile-panel" role="tabpanel" aria-labelledby="fanProfileNotesTab" hidden>' +
      area('nextTopic', '下次想聊什么', profile.nextTopic, 2) +
      area('notes', '个人备注', profile.notes, 4) +
      '<h3 class="fan-profile-section-title fan-field-wide">大航海提醒</h3>' +
      check('milestoneReminders', '在舰里程碑提醒', profile.milestoneReminders !== false) +
      check('expiryReminders', '到期提醒（已确认日期）', profile.expiryReminders) +
      '</section></div>',
    bind(form) {
      const root = form.querySelector('.fan-profile-form');
      const tabs = [...root.querySelectorAll('[role="tab"]')];
      const panels = [...root.querySelectorAll('[role="tabpanel"]')];
      function selectTab(tab) {
        for (const item of tabs) {
          item.setAttribute('aria-selected', String(item === tab));
          item.tabIndex = item === tab ? 0 : -1;
        }
        for (const panel of panels) panel.hidden = panel.id !== tab.getAttribute('aria-controls');
      }
      for (const tab of tabs) {
        tab.addEventListener('click', () => selectTab(tab));
        tab.addEventListener('keydown', (event) => {
          let index = tabs.indexOf(tab);
          if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
          else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
          else if (event.key === 'Home') index = 0;
          else if (event.key === 'End') index = tabs.length - 1;
          else return;
          event.preventDefault();
          selectTab(tabs[index]);
          tabs[index].focus();
        });
      }
      root.addEventListener(
        'invalid',
        (event) => {
          if (event.target !== root.querySelector(':invalid')) return;
          const panel = event.target.closest('[role="tabpanel"]');
          event.target.closest('label').hidden = false;
          selectTab(tabs.find((tab) => tab.getAttribute('aria-controls') === panel.id));
        },
        true,
      );
      function updateFields() {
        const lunar = form.elements.calendar.value === 'lunar';
        const hasMbti = !!form.elements.mbti.value;
        for (const name of ['thisYearDate', 'leapMonth']) form.elements[name].closest('label').hidden = !lunar;
        form.elements.leapDay.closest('label').hidden = lunar || form.elements.monthDay.value !== '02-29';
        for (const name of ['mbtiConfirmedAt', 'mbtiNote']) form.elements[name].closest('label').hidden = !hasMbti;
      }
      form.elements.monthDay.addEventListener('input', updateFields);
      form.elements.calendar.addEventListener('change', updateFields);
      form.elements.mbti.addEventListener('change', updateFields);
      updateFields();
    },
    read(form) {
      const data = Object.fromEntries(new FormData(form));
      return {
        id: profile.id,
        revision: profile.revision,
        alias: data.alias,
        formerNames: data.formerNames
          .split(/\r?\n/)
          .map((name) => name.trim())
          .filter(Boolean),
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
      '要补充什么',
      [
        ['interval', '上舰和到期日期'],
        ['baseline', '只补累计 / 连续天数'],
        ['observation', '只记录当时是否在舰'],
        ['first', '首次上舰日期'],
      ],
      type,
    ) +
    '<p class="fan-muted fan-field-wide">填你知道的信息即可。与之前记录不一致时，会请你核对后再采用。</p>' +
    `<div class="fan-membership-fields fan-field-wide" data-membership-type="interval" ${type === 'interval' ? '' : 'hidden'}>` +
    field('start', '开始日期', data.start || (data.startAt ? localTime(data.startAt).slice(0, 10) : ''), 'date') +
    field(
      'end',
      '有效至（包含当天）',
      data.end || (data.endAt ? localTime(new Date(Date.parse(data.endAt) - 1).toISOString()).slice(0, 10) : ''),
      'date',
    ) +
    '</div>' +
    `<div class="fan-membership-fields fan-field-wide" data-membership-type="baseline" ${type === 'baseline' ? '' : 'hidden'}>` +
    field('totalDays', '累计天数（留空为未知）', data.totalDays, 'number', 'min="0" step="1"') +
    field('continuousDays', '本轮连续天数（留空为未知）', data.continuousDays, 'number', 'min="0" step="1"') +
    field('asOf', '天数截至日期（含当日）', data.asOf || day(), 'date') +
    '</div>' +
    `<div class="fan-membership-fields fan-field-wide" data-membership-type="observation" ${type === 'observation' ? '' : 'hidden'}>` +
    field('observedAt', '查看时间（北京时间）', localTime(data.observedAt), 'datetime-local') +
    choice(
      'status',
      '当时的状态',
      [
        ['observed', '当时在舰'],
        ['inactive', '确认当时不在舰'],
      ],
      data.status || 'observed',
    ) +
    '<p class="fan-muted">只记录当时的状态，不会推算到期日或在舰天数。</p>' +
    '</div>' +
    `<div class="fan-membership-fields fan-field-wide" data-membership-type="first" ${type === 'first' ? '' : 'hidden'}>` +
    field('date', '首次上舰日期', data.date, 'date') +
    '</div>' +
    choice(
      'level',
      '大航海等级',
      [
        [3, '舰长'],
        [2, '提督'],
        [1, '总督'],
      ],
      data.level || 3,
    ) +
    area('reason', '备注（选填）', data.reason)
  );
}

export function recordForm(kind, record) {
  const data = record?.data || {};
  const titles = {
    note: '手记',
    topic: '话题',
    caution: '相处提醒',
    followup: '约定',
    song: '点歌记录',
    preference: '音乐偏好',
    anniversary: '纪念日',
    membership: '大航海记录',
  };
  let fields = '';
  if (kind === 'membership') fields = membershipFields(data);
  else if (kind === 'song')
    fields =
      field('songName', '歌名', data.songName, 'text', 'required maxlength="300"') +
      field('artist', '歌手', data.artist) +
      field('category', '歌曲分类', data.category) +
      area('note', '说明', data.note) +
      check('excludeFromStats', '不计入听歌偏好（例如替别人点歌）', data.excludeFromStats) +
      (record ? check('excluded', '不是这位粉丝点的，从点歌记录中移除', data.excluded) : '');
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
      field('label', '歌曲、歌手、风格或类别', data.label, 'text', 'required maxlength="300"') +
      area('reason', '备注（选填）', data.reason);
  else if (kind === 'anniversary')
    fields =
      field('name', '纪念日名称', data.name, 'text', 'required maxlength="100"') +
      field('date', '日期', data.date, 'date', 'required') +
      check('annual', '每年重复', data.annual) +
      field('advanceDays', '提前提醒天数', data.advanceDays || 0, 'number', 'min="0" max="30" step="1"') +
      area('note', '说明', data.note);
  else
    fields =
      area('body', kind === 'caution' ? '哪些话题不适合提起' : '内容', data.body, 5) +
      (kind !== 'note' ? field('tag', '标签（选填）', data.tag, 'text', 'maxlength="50"') : '') +
      (['caution', 'followup'].includes(kind)
        ? field('reviewDate', kind === 'caution' ? '复查日期（选填）' : '提醒日期（选填）', data.reviewDate, 'date')
        : '') +
      (kind === 'followup' ? check('completed', '已经完成', data.completed) : '') +
      check('pinned', '置顶', data.pinned);
  fields += field('occurredAt', '发生时间（北京时间）', localTime(record?.occurredAt), 'datetime-local', 'required');
  if (record && !['song', 'membership'].includes(kind)) fields += check('archived', '收起这条记录（仍可找回）', data.archived);
  return {
    title: record ? `编辑${titles[kind]}` : kind === 'note' ? '记一笔' : `添加${titles[kind]}`,
    fields,
    hint: kind === 'preference' ? '只记录本人提过的喜好，不会增加点歌次数。' : '',
    read(form) {
      const values = Object.fromEntries(new FormData(form));
      const result = { ...values };
      for (const key of ['pinned', 'archived', 'completed', 'annual', 'excludeFromStats', 'excluded'])
        result[key] = !!values[key];
      for (const key of ['level', 'advanceDays', 'totalDays', 'continuousDays']) {
        if (key in values) result[key] = values[key] === '' ? null : Number(values[key]);
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
          panel.hidden = panel.dataset.membershipType !== form.elements.type.value;
      });
    },
  };
}

export function guardRosterForm(roomId, roomProfile = null) {
  const roomName = String(roomProfile?.name || '').trim() || '当前直播间';
  const avatarSource = String(roomProfile?.avatarSource || '').trim();
  const avatar = avatarSource
    ? `<img class="bilibili-auth-avatar" src="${attr(avatarSource)}" alt="${attr(`${roomName}的头像`)}" />`
    : '';
  return {
    title: '同步大航海名单',
    saveLabel: '同步名单',
    busyLabel: '正在读取名单…',
    hint: '已有备注会保留，已收起的档案和排除名单会跳过。',
    fields: `<div class="fan-field-wide"><dl class="fan-facts"><div><dt>同步房间</dt><dd class="bilibili-room-row"><span class="bilibili-auth-profile">${avatar}<span class="bilibili-auth-identity"><strong class="bilibili-auth-name" title="${attr(roomName)}">${html(roomName)}</strong></span></span></dd></div></dl>
      <p>为当前大航海成员建立档案，并更新昵称、头像和等级。</p>
      <p class="fan-muted">到期日期和在舰天数可之后手动补充。</p></div>`,
    read: () => ({ expectedRoomId: roomId }),
  };
}

export function settingsForm(settings) {
  return {
    title: '粉丝档案自动更新',
    hint: '普通观众需要手动建档。生日、备注与话题仅保存在本机。',
    fields:
      check('autoUpdate', '自动更新已有档案的昵称、点歌和上舰记录', settings.autoUpdate !== false) +
      check('autoCreate', '有新粉丝上舰时自动建档', settings.autoCreate !== false) +
      check('autoSyncGuardRoster', '每天自动更新大航海身份', settings.autoSyncGuardRoster === true) +
      '<p class="fan-field-wide fan-muted">北京时间每天 12:10 核对名单，已下舰的粉丝会移除身份标记。错过后，当天首次打开软件时补更新。</p>',
    read: (form) => ({
      autoUpdate: form.elements.autoUpdate.checked,
      autoCreate: form.elements.autoCreate.checked,
      autoSyncGuardRoster: form.elements.autoSyncGuardRoster.checked,
    }),
  };
}

export function exportForm() {
  return {
    title: '导出档案表格',
    hint: '表格可用 Excel 打开。换电脑或恢复资料，请使用完整备份。',
    fields: [
      ['alias', '常用称呼'],
      ['platformName', '平台昵称'],
      ['uid', 'B 站账号'],
      ['summary', '一句话印象'],
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
    title: '导入以前的点歌',
    hint: '导入前会列出记录，请确认这些点歌来自你的直播间。',
    fields:
      `<p class="fan-field-wide">查找这位粉丝以前在本机留下的点歌记录（UID ${html(profile.identity?.value || '')}）。</p>` +
      field('from', '开始日期', '2000-01-01', 'date', 'required') +
      field('to', '结束日期', day(), 'date', 'required'),
    read: (form) => ({
      profileId: profile.id,
      from: form.elements.from.value,
      to: form.elements.to.value,
    }),
  };
}
