'use strict';

const packetParser = require('../packet-parser');
const bilibiliHelpers = require('../helpers');
const { normalizePositiveInteger } = require('../../shared/utils');

const POLL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 30;
const MAX_PAGES = 10000;
const BATCH_PAGES = 30;
const BATCH_MS = 10000;
const CONTINUE_MS = 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;

class FansMedalPoller {
  constructor(apiClient, sink, options = {}) {
    this.apiClient = apiClient;
    this.sink = sink;
    this.now = options.now || Date.now;
    this.random = options.random || Math.random;
    this.setTimeout = options.setTimeout || setTimeout;
    this.clearTimeout = options.clearTimeout || clearTimeout;
    this.timer = null;
    this.pollInFlight = null;
    this.localGeneration = 0;
    this.context = null;
    this.scan = null;
    this.failures = 0;
  }

  start(context) {
    if (
      this.context &&
      ['roomId', 'ownerUid', 'generation', 'runToken'].every((key) => this.context[key] === context?.[key])
    ) return;
    this.stop();
    if (!context?.roomId || !context.ownerUid) return;
    this.context = { ...context };
    void this.run(this.context, this.localGeneration);
  }

  stop() {
    this.clearTimeout(this.timer);
    this.timer = null;
    this.localGeneration += 1;
    this.context = null;
    this.scan = null;
    this.failures = 0;
  }

  async run(context, generation) {
    let delay;
    try {
      const result = await this.pollFansMembers(context, generation);
      if (!result || generation !== this.localGeneration) return;
      if (result.complete) {
        this.failures = 0;
        delay = Math.max(CONTINUE_MS, POLL_MS - result.durationMs);
      } else {
        delay = CONTINUE_MS;
      }
    } catch (error) {
      if (generation !== this.localGeneration) return;
      this.scan = null;
      this.failures += 1;
      const base = Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.min(this.failures - 1, 3));
      delay = Math.min(MAX_BACKOFF_MS, base + Math.floor(base * 0.1 * this.random()));
      console.warn('[Bilibili] fans medal polling failed: ' + error.message);
    }
    if (generation !== this.localGeneration) return;
    this.timer = this.setTimeout(() => {
      this.timer = null;
      return this.run(context, generation);
    }, delay);
  }

  async pollFansMembers(context, generation = this.localGeneration) {
    // A previous room's HTTP request may still be finishing. Keep a single request owner.
    while (this.pollInFlight) await this.pollInFlight.catch(() => null);
    if (generation !== this.localGeneration) return null;
    const request = this.pollBatch(context, generation);
    this.pollInFlight = request;
    try {
      return await request;
    } finally {
      if (this.pollInFlight === request) this.pollInFlight = null;
    }
  }

  async pollBatch(context, generation) {
    const scan = this.scan || { page: 1, count: 0, startedAt: this.now() };
    this.scan = scan;
    const batchStartedAt = this.now();
    for (let requested = 0; requested < BATCH_PAGES; requested += 1) {
      if (generation !== this.localGeneration) return null;
      if (scan.page > MAX_PAGES) throw new Error('粉丝牌名单超过分页上限。');
      const data = await this.apiClient.fetchFansMembersRank(context.roomId, context.ownerUid, scan.page, PAGE_SIZE);
      if (generation !== this.localGeneration) return null;
      const expectedCount = normalizePositiveInteger(data.num || data.total || data.total_num);
      const items = bilibiliHelpers.readBilibiliFansMembersRankItems(data);
      for (const item of items) {
        const userMeta = packetParser.extractBilibiliOnlineRankUserMeta(item, context.ownerUid);
        const result = this.sink.ingestHint(toIdentityHint(userMeta), {
          ...context,
          source: 'fans_rank',
          roomIdentityVerified: userMeta.currentRoomVerified === true,
        });
        if (result?.snapshot) scan.count += 1;
      }
      const complete = items.length < PAGE_SIZE || (expectedCount > 0 && scan.page * PAGE_SIZE >= expectedCount);
      scan.page += 1;
      if (complete) {
        const durationMs = this.now() - scan.startedAt;
        console.log(
          '[Bilibili] fans medal scan completed: pages=' + (scan.page - 1) +
          ' records=' + scan.count + ' durationMs=' + durationMs,
        );
        this.scan = null;
        return { complete: true, durationMs };
      }
      if (this.now() - batchStartedAt >= BATCH_MS) break;
    }
    return { complete: false };
  }
}

function toIdentityHint(userMeta) {
  return {
    uid: userMeta.uid,
    name: userMeta.userName,
    avatarUrl: userMeta.avatarUrl,
    roomIdentity: {
      guardKnown: userMeta.currentRoomVerified === true,
      guardLevel: userMeta.guardLevel,
      medalKnown: userMeta.currentRoomVerified === true,
      fansMedal: userMeta.medalName
        ? {
            name: userMeta.medalName,
            level: userMeta.medalLevel,
            targetUid: userMeta.medalTargetUid,
          }
        : null,
    },
  };
}

module.exports = { FansMedalPoller };
