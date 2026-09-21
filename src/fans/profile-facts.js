'use strict';

const { randomUUID } = require('node:crypto');
const {
  identity,
  identityKey,
  timestamp,
  text,
  recordData,
  recentNameHistory,
} = require('./validation');
const { membershipConflicts, cycleForNewRecord } = require('./membership');

function createFanFactConsumer({ store, now, create }) {
  function observe(scope, observation, newlyCreated = false, manual = false) {
    const settings = store.getScope(scope);
    if (
      !manual &&
      (!settings.initialized || (!settings.autoUpdate && !newlyCreated))
    )
      return null;
    const person = identity(observation.identity);
    if (!person) return null;
    const profile = store.byIdentity(scope, identityKey(person));
    if (!profile || profile.archived) return profile;
    const at = timestamp(observation.observedAt);
    const name = text(observation.name, '昵称', 200);
    if (
      !observation.nameComplete ||
      !name ||
      /^(观众|用户)$|[.*…]{2,}|\*|\.\.\./.test(name) ||
      at <= (profile.platformObservedAt || '')
    )
      return profile;
    const history = [...(profile.nameHistory || [])];
    if (profile.platformName && profile.platformName !== name)
      history.push({
        name: profile.platformName,
        observedAt: profile.platformObservedAt,
      });
    const avatar =
      typeof observation.avatar === 'string' &&
      /^https:\/\//.test(observation.avatar)
        ? observation.avatar.slice(0, 2048)
        : profile.avatar;
    return store.save(
      scope,
      {
        ...profile,
        platformName: name,
        platformObservedAt: at,
        avatar,
        firstObservedAt: profile.firstObservedAt || at,
        lastObservedAt: at,
        nameHistory: recentNameHistory(history, name),
      },
      identityKey(person),
      now(),
    );
  }

  function consume(scope, page) {
    if (
      !page ||
      page.version !== 1 ||
      typeof page.epoch !== 'string' ||
      !page.epoch ||
      page.epoch.length > 100 ||
      !Array.isArray(page.events) ||
      page.events.length > 200 ||
      !Number.isSafeInteger(page.nextCursor) ||
      page.nextCursor < 0
    ) {
      throw new Error('档案同步数据无效。');
    }
    const expectedStreamer = JSON.parse(scope)[1];
    if (String(page.streamerId) !== String(expectedStreamer))
      throw new Error('档案同步账号不匹配。');
    return store.transaction(() => {
      const settings = store.getScope(scope);
      if (!settings.initialized) return settings;
      if (settings.epoch && settings.epoch !== page.epoch && page.after !== 0)
        throw new Error('档案同步需要从新游标恢复。');
      const previousCursor =
        settings.epoch === page.epoch && page.reset !== true
          ? settings.cursor || 0
          : 0;
      if (page.nextCursor < previousCursor)
        throw new Error('档案同步游标倒退。');
      if (
        !page.events.length &&
        (page.nextCursor !== page.after || page.hasMore === true)
      ) {
        throw new Error('空的档案同步页不能跳过事实或继续翻页。');
      }
      let cursor = page.after;
      if (
        !Number.isSafeInteger(cursor) ||
        cursor < 0 ||
        cursor !== previousCursor
      )
        throw new Error('档案同步页顺序无效。');
      for (const event of page.events) {
        if (
          !Number.isSafeInteger(event.cursor) ||
          event.cursor <= cursor ||
          event.cursor > page.nextCursor ||
          !['identity', 'membership'].includes(event.kind) ||
          !/^[\w:.-]{1,160}$/.test(event.id)
        )
          throw new Error('档案事件无效。');
        cursor = event.cursor;
        const person = identity(event.identity);
        if (!person) throw new Error('档案事件缺少可靠身份。');
        timestamp(event.observedAt);
        const key = identityKey(person);
        let profile = store.byIdentity(scope, key);
        let newlyCreated = false;
        if (
          !profile &&
          event.kind === 'membership' &&
          settings.autoCreate &&
          !store.suppressed(scope, key)
        ) {
          profile = create(scope, { identity: person }, true);
          newlyCreated = true;
        }
        if (
          !profile ||
          profile.archived ||
          (!settings.autoUpdate && !newlyCreated)
        )
          continue;
        observe(scope, event, newlyCreated);
        if (event.identitySnapshot) {
          if (identityKey(identity(event.identitySnapshot.identity)) !== key)
            throw new Error('档案身份快照不匹配。');
          observe(scope, event.identitySnapshot, newlyCreated);
        }
        if (event.kind !== 'membership') continue;
        const records = store.records.list(scope, profile.id);
        const sourceKey = `remote:${event.id}`;
        if (records.some((record) => record.sourceKey === sourceKey)) continue;
        const data = recordData('membership', event.membership);
        if (
          data.type === 'interval' &&
          event.membership.evidenceVerified !== true
        )
          throw new Error('会员有效期缺少已核实证据。');
        if (!['interval', 'observation'].includes(data.type))
          throw new Error('远端会员事实类型无效。');
        data.cycleId =
          cycleForNewRecord(profile, records, data) || randomUUID();
        const record = {
          kind: 'membership',
          data,
          occurredAt: timestamp(event.observedAt),
          sourceKey,
          original: {
            ...data,
            source: 'platform',
            eventId: event.id,
            identity: person,
            observedAt: event.observedAt,
            evidence: text(event.source, '来源', 200),
          },
        };
        data.conflicts = membershipConflicts(record, records);
        if (data.conflicts.length) data.decision = 'pending';
        store.records.insert(scope, profile.id, record);
        profile = store.get(scope, profile.id);
        if (data.decision === 'adopted' && data.cycleId !== profile.cycleId) {
          store.save(scope, { ...profile, cycleId: data.cycleId }, key, now());
        }
      }
      if (page.events.length && cursor !== page.nextCursor)
        throw new Error('档案同步页不完整。');
      const state = {
        ...settings,
        epoch: page.epoch,
        cursor: page.nextCursor,
        synchronizedAt: now(),
        coverageSince: page.coverageSince || null,
        syncStatus: 'ready',
      };
      store.saveScope(scope, state);
      return state;
    });
  }

  // Called by queue-store inside the request's successful transaction. The
  // snapshot is already durable when the request is acknowledged to its caller.
  function archiveAccepted(scope, request) {
    if (!scope || /^random(?::|$)/.test(request.source)) return;
    const settings = store.getScope(scope);
    if (!settings.initialized || !settings.autoUpdate || !request.identityType)
      return;
    const person = identity({
      platform: 'bilibili',
      type: request.identityType,
      value: request.requesterUid,
    });
    if (!person) return;
    const profile = store.byIdentity(scope, identityKey(person));
    if (!profile || profile.archived) return;
    const data = {
      songName: request.songName,
      artist: request.artist,
      category: request.categoryName,
      excludeFromStats: false,
      excluded: false,
      note: '',
      state: '已加入队列',
    };
    store.records.insert(scope, profile.id, {
      kind: 'song',
      data,
      occurredAt: request.createdAt,
      sourceKey: `request:${request.stableId}`,
      original: {
        ...data,
        source: request.source,
        stableId: request.stableId,
        requestId: request.requestId,
        queueId: request.queueId,
        identity: person,
        occurredAt: request.createdAt,
        requesterName: request.requesterName,
      },
    });
    observe(scope, {
      identity: person,
      observedAt: request.createdAt,
      name: request.requesterName,
      nameComplete: true,
    });
  }

  function archiveQueueState(scope, stableId, status, changedAt) {
    const record = store.records.bySource(scope, `request:${stableId}`);
    if (!record) return;
    const state = {
      done: '队列已处理',
      deleted: '已撤销／移除',
      skipped: '已跳过',
      waiting: '已加入队列',
      current: '已加入队列',
    }[status];
    if (!state || state === record.data.state) return;
    store.records.update(
      scope,
      record.profileId,
      { ...record, data: { ...record.data, state } },
      changedAt,
      'queue',
    );
  }

  return { consume, observe, archiveAccepted, archiveQueueState };
}

module.exports = { createFanFactConsumer };
