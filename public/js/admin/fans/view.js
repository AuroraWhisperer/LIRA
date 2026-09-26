import { escapeHtml, escapeAttr } from '../../shared/utils.js';

export const html = escapeHtml;
export const attr = escapeAttr;
export const levels = { 1: '总督', 2: '提督', 3: '舰长' };
export function dateLabel(value) {
  return value
    ? new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value).toLocaleDateString('zh-CN', {
        timeZone: 'Asia/Shanghai',
      })
    : '待补充';
}
export function memberLabel(membership, guardRoster) {
  if (guardRoster) return guardRoster.level ? `在舰 · ${levels[guardRoster.level]}` : '最近同步时未在舰';
  if (membership.status === 'active') return `在舰 · ${levels[membership.level]}`;
  if (membership.status === 'pending') return '大航海待核实';
  if (membership.status === 'expired') return '已到期';
  if (membership.observedLevel) return `曾是${levels[membership.observedLevel]} · 当前状态待确认`;
  return membership.hasHistory ? '曾经上舰 · 当前状态待确认' : '暂无大航海记录';
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
    <span class="fan-person-line"><span class="fan-person-name"><strong class="fan-name" data-guard-level="${attr(p.currentGuardLevel || '')}" title="${attr(p.platformName || p.alias)}">${html(p.platformName || p.alias || '未命名档案')}</strong>${p.favorite ? '<span class="fan-favorite-star" role="img" aria-label="特别关注" title="特别关注">★</span>' : ''}</span>${guardIcon(p.currentGuardLevel)}</span>
    ${p.alias && p.platformName && p.alias !== p.platformName ? `<span class="fan-muted">常用称呼：${html(p.alias)}</span>` : ''}
    ${p.summary || p.tags?.length ? `<span class="fan-person-summary">${html(p.summary || p.tags.slice(0, 2).join('、'))}</span>` : ''}
    ${p.nextReminder ? `<span class="fan-person-date">${html(p.nextReminder.title)} · ${html(dateLabel(p.nextReminder.date))}</span>` : ''}
  </button>`,
    )
    .join('');
}

function songRecord(record) {
  const data = record.data;
  const title = `《${data.songName}》${data.artist ? ` · ${data.artist}` : ''}`;
  return `<article class="fan-record"><div class="fan-record-top"><div class="fan-record-copy"><p class="fan-record-body">${html(title)}</p><span class="fan-muted fan-record-meta">${html(dateLabel(record.occurredAt))}${data.excluded ? ' · 已移出点歌记录' : data.excludeFromStats ? ' · 不计入偏好统计' : ''}</span></div>${button('edit-record', '编辑', `data-record-id="${attr(record.id)}"`)}</div>
    ${data.note ? `<p class="fan-muted">${html(data.note)}</p>` : ''}</article>`;
}

function recordRow(record) {
  if (record.kind === 'song') return songRecord(record);
  const data = record.data;
  const title =
    record.kind === 'preference'
      ? `${data.sentiment === 'like' ? '喜欢' : '不喜欢'} ${data.label}`
      : data.body || data.name || data.label;
  return `<article class="fan-record"><div class="fan-record-top"><div class="fan-record-copy"><p class="fan-record-body">${html(title || '')}</p><span class="fan-muted fan-record-meta">${html(dateLabel(record.occurredAt))}${data.archived ? ' · 已收起' : ''}${data.pinned ? ' · 置顶' : ''}${data.completed ? ' · 已完成' : ''}</span></div>${button('edit-record', '编辑', `data-record-id="${attr(record.id)}"`)}</div>
    ${data.note || data.reason ? `<p class="fan-muted">${html(data.note || data.reason)}</p>` : ''}</article>`;
}

function recordHistory(records, label, render = recordRow) {
  return records.length
    ? `<details class="fan-history"><summary>${label}（${records.length}）</summary>${records.map(render).join('')}</details>`
    : '';
}

function journal(profile) {
  const notes = profile.records.filter((r) => r.kind === 'note');
  const active = notes.filter((r) => !r.data.archived)
    .sort((a, b) => Number(Boolean(b.data.pinned)) - Number(Boolean(a.data.pinned)));
  return (
    (active.map(recordRow).join('') || '<div class="fan-empty"><p>还没有手记，点击“记一笔”记录今天聊过的事。</p></div>') +
    recordHistory(notes.filter((r) => r.data.archived), '已收起的手记')
  );
}

function overview(profile) {
  const topics = profile.records.filter((r) => r.kind === 'topic' && !r.data.archived);
  const cautions = profile.records.filter((r) => r.kind === 'caution' && !r.data.archived);
  const followups = profile.records.filter((r) => r.kind === 'followup' && !r.data.archived && !r.data.completed);
  const archived = profile.records.filter(
    (r) => ['topic', 'caution', 'followup', 'anniversary'].includes(r.kind) && (r.data.archived || r.data.completed),
  );
  return `<section class="fan-section"><h4>基本资料</h4>
    <dl class="fan-facts fan-basic-facts"><div><dt>生日</dt><dd>${html(profile.birthday ? `${profile.birthday.monthDay}${profile.birthday.calendar === 'lunar' ? '（农历）' : '（公历）'}` : '待补充')}</dd></div>
    <div><dt>星座</dt><dd>${html(profile.zodiacHint || '未知')}</dd></div><div><dt>MBTI</dt><dd>${html(profile.mbti || '未知')}${profile.mbtiNote ? ` · ${html(profile.mbtiNote)}` : ''}</dd></div>
    <div class="fan-former-names"><dt>曾用名</dt><dd>${profile.formerNames?.length ? profile.formerNames.map(html).join('、') : '暂无'}</dd></div></dl></section>
    <section class="fan-section"><div class="fan-section-title"><h4>可以聊的话题</h4><div class="fan-actions">${button('new-topic', '添加话题')}${button('new-followup', '记一个约定')}</div></div>${topics.length ? topics.map(recordRow).join('') : '<p class="fan-muted">从一次聊天开始记录。</p>'}
    ${profile.nextTopic ? `<p>下次想聊：${html(profile.nextTopic)}</p>` : ''}${followups.length ? `<div class="fan-followups"><h5>待办约定</h5>${followups.map(recordRow).join('')}</div>` : ''}</section>
    <section class="fan-section fan-cautions"><details><summary>相处提醒${cautions.length ? ` · ${cautions.length} 条` : ''}</summary><p class="fan-muted">哪些话题不适合提起，仅自己可见。</p>${cautions.map(recordRow).join('')}${button('new-caution', '添加相处提醒')}</details></section>
    <section class="fan-section"><h4>个人备注</h4><p class="fan-prose${profile.notes ? '' : ' fan-muted'}">${html(profile.notes || '还没有备注。')}</p></section>
    <section class="fan-section"><div class="fan-section-title"><h4>纪念日</h4>${button('new-anniversary', '添加纪念日')}</div>${profile.records
      .filter((r) => r.kind === 'anniversary' && !r.data.archived)
      .map(recordRow)
      .join('')}</section>${recordHistory(archived, '已完成或收起的资料')}`;
}

function music(profile) {
  const categories = Object.entries(profile.musicStats.categories).sort((a, b) => b[1] - a[1]);
  return `<section class="fan-section"><div class="fan-section-title"><h4>喜欢 / 不喜欢</h4>${button('new-preference', '记录喜欢 / 不喜欢')}</div>
    ${profile.preferences.length ? profile.preferences.map((r) => `<article class="fan-record"><div class="fan-record-top"><strong>${r.data.sentiment === 'like' ? '喜欢' : '不喜欢'} ${html(r.data.label)}</strong>${button('edit-record', '编辑', `data-record-id="${attr(r.id)}"`)}</div><p class="fan-muted">${html(r.data.reason || '手动确认')}</p></article>`).join('') : '<p class="fan-muted">记下聊天时提到的喜欢或不喜欢的歌曲、歌手和风格。</p>'}</section>
    <section class="fan-section"><h4>最近点歌</h4><p class="fan-muted">近 90 天点歌 ${profile.musicStats.count} 次。</p>
    <dl class="fan-facts">${categories.map(([name, count]) => `<div><dt>${html(name)}</dt><dd>${count} 次</dd></div>`).join('')}</dl></section>
    <section class="fan-section"><div class="fan-section-title"><h4>点过的歌</h4><div class="fan-actions">${button('new-song', '补记一次点歌')}${button('legacy', '导入以前的点歌')}</div></div>${profile.songs.map(songRecord).join('') || '<p class="fan-muted">还没有点歌记录，点歌后会自动记在这里。</p>'}</section>
    ${recordHistory(profile.records.filter((r) => ['song', 'preference'].includes(r.kind) && (r.data.excluded || r.data.archived)), '已收起的音乐记录')}`;
}

function membershipDescription(data) {
  return (
    data.type === 'interval'
      ? `${levels[data.level]} · ${dateLabel(data.startAt)} 至 ${dateLabel(new Date(Date.parse(data.endAt) - 1).toISOString())}`
      : data.type === 'baseline'
        ? `截至 ${dateLabel(data.asOf)}：累计 ${data.totalDays ?? '未知'} 天，连续 ${data.continuousDays ?? '未知'} 天`
        : data.type === 'first'
          ? `首次上舰：${dateLabel(data.date)}`
          : `${dateLabel(data.observedAt)}：${data.status === 'inactive' ? '当时未在舰' : `当时为${levels[data.level]}`}`
  );
}

function membershipRecord(record, profile) {
  const data = record.data;
  const conflicts = data.conflicts?.map((id) => profile.records.find((r) => r.id === id)).filter(Boolean) || [];
  return `<article class="fan-record"><div class="fan-record-top"><strong>${html(membershipDescription(data))}</strong>${button('edit-record', '编辑', `data-record-id="${attr(record.id)}"`)}</div>
    <p class="fan-muted">${record.original.source === 'platform' ? '自动同步' : '手动填写'}${{ adopted: '', pending: ' · 待确认', rejected: ' · 未采用', superseded: ' · 已更新' }[data.decision] || ''}</p>
    ${data.reason ? `<p>${html(data.reason)}</p>` : ''}${data.decision === 'pending' ? `<div class="fan-conflict"><p>这次记录与之前不同，请核对后选择。确认前暂停大航海提醒，生日提醒照常。</p><dl class="fan-facts"><div><dt>这次记录</dt><dd>${html(membershipDescription(data))}</dd></div><div><dt>之前记录</dt><dd>${conflicts.map((r) => `<p>${html(membershipDescription(r.data))}${r.data.reason ? `<br>${html(r.data.reason)}` : ''}</p>`).join('') || '暂无可对照的记录'}</dd></div></dl><div class="fan-actions">${button('resolve-adopt', '采用这次记录', `data-record-id="${attr(record.id)}"`)}${button('resolve-keep', '保留之前记录', `data-record-id="${attr(record.id)}"`)}</div></div>` : ''}</article>`;
}

function membership(profile) {
  const summary = profile.membership;
  const records = profile.records.filter((r) => r.kind === 'membership');
  return `<section class="fan-section"><div class="fan-section-title"><h4>${html(memberLabel(summary, profile.guardRoster))}</h4>${button('new-membership', '编辑大航海')}</div>
    <dl class="fan-facts"><div><dt>${summary.status === 'pending' ? '上次确认到期' : '到期日期'}</dt><dd>${summary.expiry ? html(summary.expiry.date) : '待补到期时间'}</dd></div>
    <div><dt>累计在舰${summary.status === 'pending' ? '（待核实）' : ''}</dt><dd>${summary.totalDays ?? '未知'}${summary.totalDays !== null ? ` 天 · 截至 ${html(summary.totalAsOf)}` : ''}</dd></div>
    <div><dt>连续在舰${summary.status === 'pending' ? '（待核实）' : ''}</dt><dd>${summary.continuousDays ?? '未知'}${summary.continuousDays !== null ? ` 天 · 截至 ${html(summary.continuousAsOf)}` : ''}</dd></div>
    <div><dt>首次上舰</dt><dd>${html(summary.firstDate || '待确认')}</dd></div></dl>
    ${profile.guardRoster ? `<p class="fan-muted">名单更新于 ${html(dateLabel(profile.guardRoster.observedAt))}</p>` : summary.observedAt ? `<p class="fan-muted">上次上舰记录：${html(dateLabel(summary.observedAt))}，当前是否在舰还需确认。</p>` : ''}</section>
    ${records.filter((r) => r.data.decision === 'pending').map((r) => membershipRecord(r, profile)).join('')}
    ${recordHistory(records.filter((r) => r.data.decision !== 'pending'), '查看上舰记录', (r) => membershipRecord(r, profile))}
    ${records.length ? '' : '<p class="fan-muted">不知道起止日期，也可以只填写已在舰的天数。</p>'}`;
}

export function renderDetail(profile, tab = 'overview') {
  const sections = { overview, interactions: journal, music, membership };
  const content = sections[tab](profile);
  return `<header class="fan-person-header"><div class="fan-header-info"><div class="fan-detail-name"><h3 class="fan-name" data-guard-level="${attr(profile.currentGuardLevel || '')}">${html(profile.platformName || profile.alias || '未命名档案')}</h3>${guardIcon(profile.currentGuardLevel)}</div>
    <p class="fan-detail-meta fan-muted">${profile.identity ? `<span>${profile.identity.type === 'uid' ? 'UID' : 'B 站账号'} ${html(profile.identity.value)}</span>` : '<span>未关联 B 站账号</span>'}${profile.alias && profile.platformName && profile.alias !== profile.platformName ? `<span>常用称呼：${html(profile.alias)}</span>` : ''}${profile.platformObservedAt ? `<span>更新于 ${html(dateLabel(profile.platformObservedAt))}</span>` : ''}</p>
    ${profile.summary ? `<p class="fan-prose">${html(profile.summary)}</p>` : ''}</div>
    <div class="fan-header-actions"><div class="fan-actions">${button('new-note', '记一笔', 'class="primary"')}${button('favorite', profile.favorite ? '已关注' : '特别关注', `aria-pressed="${profile.favorite}"`)}</div>
    <div class="fan-actions">${button('back-list', '返回列表', 'class="fan-back-list"')}${button('edit-profile', '编辑资料')}<details class="fan-more"><summary>更多</summary><div>${button('expand', '展开详情')}${button('archive', profile.archived ? '恢复档案' : '收起档案')}${button('delete', '永久删除')}</div></details></div></div></header>
    <nav class="fan-detail-tabs" role="tablist" aria-label="档案详情">${[
      ['overview', '资料'],
      ['interactions', '手记'],
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
        (r) => r.group === group && (group === 'history' || !['handled', 'ignored'].includes(r.status)),
      );
      if (!records.length) return '';
      const people = new Map();
      for (const record of records) {
        const key = `${record.profileId}:${record.date}`;
        if (!people.has(key)) people.set(key, []);
        people.get(key).push(record);
      }
      return `<section class="fan-reminder-group"><h3>${names[group]}</h3>${[...people.values()]
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
