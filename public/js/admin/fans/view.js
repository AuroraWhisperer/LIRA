import { escapeHtml, escapeAttr } from '../../shared/utils.js';

export const html = escapeHtml;
export const attr = escapeAttr;
export const levels = { 1: '总督', 2: '提督', 3: '舰长' };
export function dateLabel(value) {
  return value
    ? new Date(
        value.length === 10 ? `${value}T00:00:00+08:00` : value,
      ).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : '待补充';
}
export function memberLabel(membership, guardRoster) {
  if (guardRoster)
    return guardRoster.level
      ? `在舰 · ${levels[guardRoster.level]}`
      : '最近同步时未在舰';
  if (membership.status === 'active')
    return `在舰 · ${levels[membership.level]}`;
  if (membership.status === 'pending') return '大航海待核实';
  if (membership.status === 'expired') return '已确认区间到期';
  if (membership.observedLevel)
    return `曾观察到${levels[membership.observedLevel]} · 当前待核实`;
  return membership.hasHistory ? '曾观察到上舰 · 当前待核实' : '未记录大航海';
}
function guardIcon(level) {
  const icon = { 1: 'governor', 2: 'prefect', 3: 'captain' }[level];
  return icon
    ? `<img class="fan-status" src="/img/admin/gifts/bilibili-guard-${icon}.webp" alt="${levels[level]}" title="${levels[level]}" width="32" height="32" draggable="false">`
    : '';
}
function button(action, label, extra = '') {
  return `<button type="button" data-fan-action="${action}" ${extra}>${label}</button>`;
}
export function renderPeople(profiles, selected, filtered) {
  if (!profiles.length)
    return `<div class="fan-empty"><h3>${filtered ? '没有符合条件的档案' : '暂无粉丝档案'}</h3>
    ${button(filtered ? 'clear-filter' : 'new', filtered ? '清除筛选' : '新建档案')}</div>`;
  return profiles
    .map(
      (
        p,
      ) => `<button type="button" class="fan-person ${selected === p.id ? 'is-selected' : ''}" data-fan-id="${attr(p.id)}" aria-pressed="${selected === p.id}">
    <span class="fan-person-line"><strong class="fan-name" data-guard-level="${attr(p.currentGuardLevel || '')}" title="${attr(p.alias || p.platformName)}">${html(p.alias || p.platformName || '未命名档案')}</strong>${guardIcon(p.currentGuardLevel)}</span>
    ${p.alias && p.platformName ? `<span class="fan-muted">${html(p.platformName)}</span>` : ''}
    ${p.summary || p.tags?.length ? `<span class="fan-person-summary">${html(p.summary || p.tags.slice(0, 2).join('、'))}</span>` : ''}
    ${p.nextReminder ? `<span class="fan-person-date">${html(p.nextReminder.title)} · ${html(dateLabel(p.nextReminder.date))}</span>` : ''}
  </button>`,
    )
    .join('');
}

function recordRow(record) {
  const data = record.data;
  const title =
    record.kind === 'song'
      ? `点歌《${data.songName}》${data.artist ? ` · ${data.artist}` : ''}`
      : data.body || data.name || data.label;
  return `<article class="fan-record"><div class="fan-record-top"><div class="fan-record-copy"><p class="fan-record-body">${html(title || '')}</p><span class="fan-muted fan-record-meta">${html(dateLabel(record.occurredAt))} · ${record.original.source === 'manual' ? '手动记录' : '已记录事实'}${record.revisions.some((r) => r.source !== 'queue') ? ' · 人工修订' : ''}${data.excluded ? ' · 已解除关联' : ''}${data.archived ? ' · 已归档' : ''}${data.pinned ? ' · 置顶' : ''}${data.state ? ` · ${html(data.state)}` : ''}</span></div>${button('edit-record', '编辑', `data-record-id="${attr(record.id)}"`)}</div>
    ${data.note || data.reason ? `<p class="fan-muted">${html(data.note || data.reason)}</p>` : ''}
    ${record.original.source !== 'manual' || record.revisions.length ? `<details class="fan-original"><summary>查看原始记录与修订</summary><pre>${html(JSON.stringify({ original: record.original, revisions: record.revisions }, null, 2))}</pre></details>` : ''}</article>`;
}

function overview(p) {
  const latest =
    p.records.find(
      (r) => r.kind === 'note' && r.data.pinned && !r.data.archived,
    ) || p.records.find((r) => r.kind === 'note' && !r.data.archived);
  const topics = p.records.filter(
    (r) => r.kind === 'topic' && !r.data.archived,
  );
  const cautions = p.records.filter(
    (r) => r.kind === 'caution' && !r.data.archived,
  );
  const followups = p.records.filter(
    (r) => r.kind === 'followup' && !r.data.archived && !r.data.completed,
  );
  return `<section class="fan-section"><div class="fan-section-title"><h4>基本资料</h4>${button('edit-profile', '编辑资料')}</div>
    <dl class="fan-facts fan-basic-facts"><div><dt>生日</dt><dd>${html(p.birthday ? `${p.birthday.monthDay}${p.birthday.calendar === 'lunar' ? '（农历，手动设置本年提醒）' : '（公历）'}` : '待补充')}</dd></div>
    <div><dt>星座</dt><dd>${html(p.zodiacHint || '未知')}${p.zodiac ? '' : p.zodiacHint ? '（公历提示）' : ''}</dd></div><div><dt>MBTI</dt><dd>${html(p.mbti || '未知')}${p.mbtiNote ? ` · ${html(p.mbtiNote)}` : ''}</dd></div></dl></section>
    <section class="fan-section"><div class="fan-section-title"><h4>可以聊的话题</h4><div class="fan-actions">${button('new-topic', '添加话题')}${button('new-followup', '记一个约定')}</div></div>${topics.length ? topics.map(recordRow).join('') : '<p class="fan-muted">从一次聊天开始记录。</p>'}
    ${p.nextTopic ? `<p>下次想聊：${html(p.nextTopic)}</p>` : ''}${followups.length ? `<div class="fan-followups"><h5>待办约定</h5>${followups.map(recordRow).join('')}</div>` : ''}</section>
    <section class="fan-section fan-cautions"><details><summary>相处提醒${cautions.length ? ` · ${cautions.length} 条` : ''}</summary><p class="fan-muted">哪些话题不适合提起，仅自己可见。</p>${cautions.map(recordRow).join('')}${button('new-caution', '添加相处提醒')}</details></section>
    ${latest ? `<section class="fan-section"><h4>最近的一段记忆</h4>${recordRow(latest)}</section>` : ''}
    ${p.musicSummary ? `<button type="button" class="fan-music-summary" data-fan-tab="music">音乐：${html(p.musicSummary)}<span>查看音乐</span></button>` : ''}
    <section class="fan-section"><h4>个人备注</h4><p class="fan-prose${p.notes ? '' : ' fan-muted'}">${html(p.notes || '还没有备注。')}</p></section>
    <section class="fan-section"><div class="fan-section-title"><h4>纪念日</h4>${button('new-anniversary', '添加纪念日')}</div>${p.records
      .filter((r) => r.kind === 'anniversary')
      .map(recordRow)
      .join('')}</section>`;
}

function music(p) {
  const categories = Object.entries(p.musicStats.categories).sort(
    (a, b) => b[1] - a[1],
  );
  return `<section class="fan-section"><div class="fan-section-title"><h4>明确偏好</h4>${button('new-preference', '记录喜欢 / 不喜欢')}</div>
    ${p.preferences.length ? p.preferences.map((r) => `<article class="fan-record"><div class="fan-record-top"><strong>${r.data.sentiment === 'like' ? '喜欢' : '不喜欢'} ${html(r.data.label)}</strong>${button('edit-record', '编辑', `data-record-id="${attr(r.id)}"`)}</div><p class="fan-muted">${html(r.data.reason || '手动确认')}</p></article>`).join('') : '<p class="fan-muted">按交流确认偏好，点歌观察不会替你下结论。</p>'}</section>
    <section class="fan-section"><h4>点歌观察</h4><p class="fan-muted">近 90 天已记录 ${p.musicStats.count} 次，按当时曲库分类计数；排除随机点歌及手动排除项。</p>
    <dl class="fan-facts">${categories.map(([name, count]) => `<div><dt>${html(name)}</dt><dd>${count} 次</dd></div>`).join('')}</dl></section>
    <section class="fan-section"><div class="fan-section-title"><h4>歌曲记录</h4><div class="fan-actions">${button('new-song', '补记一次点歌')}${button('legacy', '补入本机旧点歌')}</div></div>${p.songs.map(recordRow).join('') || '<p class="fan-muted">已建档粉丝成功点歌后自动留档。</p>'}</section>`;
}

function membershipRecord(record, p) {
  const d = record.data;
  const title =
    d.type === 'interval'
      ? `${levels[d.level]} · ${dateLabel(d.startAt)} 至 ${dateLabel(new Date(Date.parse(d.endAt) - 1).toISOString())}`
      : d.type === 'baseline'
        ? `截至 ${dateLabel(d.asOf)}：累计 ${d.totalDays ?? '未知'} 天，连续 ${d.continuousDays ?? '未知'} 天`
        : d.type === 'first'
          ? `首次上舰：${dateLabel(d.date)}`
          : `${dateLabel(d.observedAt)} 观察到 ${levels[d.level]}${d.status === 'inactive' ? '（人工标记不在舰）' : ''}`;
  const conflicts =
    d.conflicts
      ?.map((id) => p.records.find((r) => r.id === id))
      .filter(Boolean) || [];
  return `<article class="fan-record"><div class="fan-record-top"><strong>${html(title)}</strong>${button('edit-record', '编辑', `data-record-id="${attr(record.id)}"`)}</div>
    <p class="fan-muted">${record.original.source === 'platform' ? '平台观察' : '手动确认'} · ${{ adopted: '已采用', pending: '待核实', rejected: '保留原依据', superseded: '已被修订替代' }[d.decision] || ''}${d.precision === 'date' ? ' · 按日期补录' : ''}</p>
    ${d.reason ? `<p>${html(d.reason)}</p>` : ''}${d.decision === 'pending' ? `<div class="fan-conflict"><p>与上次确认依据冲突。相关大航海提醒已暂停，生日提醒不受影响。</p><details><summary>核对双方依据</summary><pre>${html(JSON.stringify({ candidate: d, adopted: conflicts.map((r) => ({ data: r.data, original: r.original })) }, null, 2))}</pre></details><div class="fan-actions">${button('resolve-adopt', '采用这份依据', `data-record-id="${attr(record.id)}"`)}${button('resolve-keep', '保留上次确认', `data-record-id="${attr(record.id)}"`)}</div></div>` : ''}
    <details class="fan-original"><summary>查看原始记录与修订</summary><pre>${html(JSON.stringify({ original: record.original, revisions: record.revisions }, null, 2))}</pre></details></article>`;
}

function membership(p) {
  const m = p.membership;
  return `<section class="fan-section"><div class="fan-section-title"><h4>${html(memberLabel(m, p.guardRoster))}</h4>${button('new-membership', '编辑大航海')}</div>
    <dl class="fan-facts"><div><dt>${m.status === 'pending' ? '上次确认到期' : '有效至'}</dt><dd>${m.expiry ? `${html(m.expiry.date)} · ${m.expiry.source === 'platform' ? '平台确认' : '手动确认'}` : '待补到期时间'}</dd></div>
    <div><dt>累计在舰${m.status === 'pending' ? '（待核实）' : ''}</dt><dd>${m.totalDays ?? '未知'}${m.totalDays !== null ? ` 天 · ${html(m.totalBasis)}，截至 ${html(m.totalAsOf)}` : ''}</dd></div>
    <div><dt>连续在舰${m.status === 'pending' ? '（待核实）' : ''}</dt><dd>${m.continuousDays ?? '未知'}${m.continuousDays !== null ? ` 天 · 截至 ${html(m.continuousAsOf)}` : ''}</dd></div>
    <div><dt>首次上舰</dt><dd>${html(m.firstDate || '待确认')}</dd></div></dl>
    ${p.guardRoster ? `<p class="fan-muted">大航海名单同步于 ${html(dateLabel(p.guardRoster.observedAt))}，身份按这次同步显示。</p>` : m.observedAt ? `<p class="fan-muted">最近上舰观察：${html(dateLabel(m.observedAt))}。观察记录不代表当前仍在舰。</p>` : ''}
    <p class="fan-muted">按 Asia/Shanghai 计算已发生的有效日，当天生效计一天；未来有效期仅用于预测提醒。</p></section>
    ${
      p.records
        .filter((r) => r.kind === 'membership')
        .map((r) => membershipRecord(r, p))
        .join('') ||
      '<p class="fan-muted">不知道起止日期也可以只补录天数及截至日期。</p>'
    }`;
}

export function renderDetail(p, tab = 'overview', timelineFilter = '') {
  const sections = { overview, music, membership };
  const timeline = p.records.filter(
    (r) => !timelineFilter || r.kind === timelineFilter,
  );
  const content = sections[tab]
    ? sections[tab](p)
    : `<div class="fan-timeline-filter"><label>记录类型 <select id="fanTimelineFilter">${[
        ['', '全部'],
        ['note', '手记'],
        ['song', '点歌'],
        ['membership', '大航海'],
        ['anniversary', '纪念日'],
        ['topic', '话题'],
        ['caution', '相处提醒'],
        ['followup', '约定'],
        ['preference', '音乐偏好'],
      ]
        .map(
          ([value, label]) =>
            `<option value="${value}" ${value === timelineFilter ? 'selected' : ''}>${label}</option>`,
        )
        .join(
          '',
        )}</select></label></div>${timeline.map((r) => (r.kind === 'membership' ? membershipRecord(r, p) : recordRow(r))).join('') || '<div class="fan-empty"><p>还没有互动记录，记下今天聊过的事吧。</p></div>'}`;
  return `<header class="fan-person-header"><div class="fan-detail-title"><div><div class="fan-detail-name"><h3 class="fan-name" data-guard-level="${attr(p.currentGuardLevel || '')}">${html(p.alias || p.platformName || '未命名档案')}</h3>${guardIcon(p.currentGuardLevel)}</div><p class="fan-muted">${html(p.platformName || '尚未获取平台昵称')} · ${p.identity ? `${p.identity.type === 'uid' ? 'UID' : 'open_id'} ${html(p.identity.value)}` : '身份待关联'}</p></div>
    ${button('favorite', p.favorite ? '已关注' : '特别关注', `aria-pressed="${p.favorite}"`)}</div>
    ${p.summary ? `<p class="fan-prose">${html(p.summary)}</p>` : ''}<p class="fan-muted fan-small">平台信息更新于 ${html(p.platformObservedAt ? dateLabel(p.platformObservedAt) : '尚未获取')}</p>
    <div class="fan-actions">${button('new-note', '记一笔', 'class="primary"')}${button('expand', '展开 / 收起')}${button('back-list', '返回列表', 'class="fan-back-list"')}<details class="fan-more"><summary>管理</summary><div>${button('edit-profile', '编辑资料')}${button('archive', p.archived ? '恢复档案' : '归档')}${button('delete', '永久删除')}</div></details></div></header>
    <nav class="fan-detail-tabs" role="tablist" aria-label="档案详情">${[
      ['overview', '概览'],
      ['interactions', '互动'],
      ['music', '音乐'],
      ['membership', '大航海'],
    ]
      .map(
        ([key, label]) =>
          `<button type="button" role="tab" aria-selected="${tab === key}" data-fan-tab="${key}">${label}</button>`,
      )
      .join('')}</nav>
    <div class="fan-detail-content">${content}</div>`;
}

export function renderReminders(items) {
  const names = {
    today: '今天',
    missed: '最近 7 天已错过',
    week: '未来 7 天',
    later: '之后',
    history: '处理历史',
  };
  const groups = Object.keys(names)
    .map((group) => {
      const records = items.filter(
        (r) =>
          r.group === group &&
          (group === 'history' || !['handled', 'ignored'].includes(r.status)),
      );
      if (!records.length) return '';
      const people = new Map();
      for (const record of records) {
        const key = `${record.profileId}:${record.date}`;
        if (!people.has(key)) people.set(key, []);
        people.get(key).push(record);
      }
      return `<section class="fan-reminder-group"><h3>${names[group]}</h3>${[
        ...people.values(),
      ]
        .map((day) => {
          const first = day[0];
          return `<article class="fan-reminder-person"><header class="fan-section-title"><h4>${html(first.name)} · ${html(dateLabel(first.date))}</h4>${button('open-reminder', '打开档案', `data-profile-id="${attr(first.profileId)}"`)}</header>${day.map((r) => `<div class="fan-reminder-row"><div><strong>${html(r.title)}</strong><p class="fan-muted">${html(r.basis || '')}${r.predicted ? ' · 预计' : ''}${r.revisedBelowThreshold ? ' · 修订后未达标，处理历史保留' : ''}${r.status === 'snoozed' ? ` · 延至 ${html(r.until)}` : ''}${r.status === 'handled' ? ' · 已处理' : r.status === 'ignored' ? ' · 已忽略' : ''}</p></div><div class="fan-actions">${group === 'history' ? '' : ['handled', 'snoozed', 'ignored'].map((state) => button(`reminder-${state}`, { handled: '已处理', snoozed: '稍后提醒', ignored: '忽略本次' }[state], `data-profile-id="${attr(r.profileId)}" data-reminder-key="${attr(r.key)}"`)).join('')}</div></div>`).join('')}</article>`;
        })
        .join('')}</section>`;
    })
    .join('');
  return (
    groups ||
    '<div class="fan-empty"><h3>暂时没有待办提醒</h3><p>填入生日、纪念日或确认大航海资料后，重要日子会汇总在这里。</p></div>'
  );
}
