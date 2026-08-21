// 全量粉丝牌轮询器 — 用本房粉丝牌成员接口补全在线榜之外的身份。
'use strict';

const packetParser = require('../packet-parser');
const bilibiliHelpers = require('../helpers');
const { normalizePositiveInteger } = require('../../shared/utils');

const BILIBILI_FANS_MEDAL_POLL_MS = 5 * 60 * 1000;
const BILIBILI_FANS_MEDAL_PAGE_SIZE = 30;
const BILIBILI_FANS_MEDAL_MAX_PAGES = 10000;

class FansMedalPoller {
  constructor(apiClient, sink) {
    this.apiClient = apiClient;
    this.sink = sink;
    this.timer = null;
    this.pollInFlight = false;
    this.localGeneration = 0;
  }

  start(context) {
    this.stop();
    if (!context || !context.roomId || !context.ownerUid) return;
    const localGeneration = ++this.localGeneration;
    this.pollFansMembers(context, localGeneration).catch((error) => {
      console.warn(`[Bilibili] fans medal polling failed: ${error.message}`);
    });
    this.timer = setInterval(() => {
      this.pollFansMembers(context, localGeneration).catch((error) => {
        console.warn(`[Bilibili] fans medal polling failed: ${error.message}`);
      });
    }, BILIBILI_FANS_MEDAL_POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.localGeneration += 1;
  }

  async pollFansMembers(context, localGeneration = this.localGeneration) {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    let cachedCount = 0;
    try {
      let expectedCount = 0;
      for (let page = 1; page <= BILIBILI_FANS_MEDAL_MAX_PAGES; page += 1) {
        if (localGeneration !== this.localGeneration) return;
        const data = await this.apiClient.fetchFansMembersRank(
          context.roomId,
          context.ownerUid,
          page,
          BILIBILI_FANS_MEDAL_PAGE_SIZE
        );
        if (localGeneration !== this.localGeneration) return;
        expectedCount = normalizePositiveInteger(data.num || data.total || data.total_num);
        const items = bilibiliHelpers.readBilibiliFansMembersRankItems(data);
        if (items.length === 0) break;

        for (const item of items) {
          if (localGeneration !== this.localGeneration) return;
          const userMeta = packetParser.extractBilibiliOnlineRankUserMeta(item, context.ownerUid);
          const result = this.sink.ingestHint(toIdentityHint(userMeta), {
            ...context,
            source: 'fans_rank',
            roomIdentityVerified: userMeta.currentRoomVerified === true
          });
          if (result && result.snapshot) cachedCount += 1;
        }

        if (items.length < BILIBILI_FANS_MEDAL_PAGE_SIZE) break;
        if (expectedCount > 0 && page * BILIBILI_FANS_MEDAL_PAGE_SIZE >= expectedCount) break;
      }
    } finally {
      this.pollInFlight = false;
    }

    if (cachedCount > 0) {
      console.log(`[Bilibili] fans medal snapshot cached ${cachedCount} member identity record(s).`);
    }
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
      fansMedal: userMeta.medalName ? {
        name: userMeta.medalName,
        level: userMeta.medalLevel,
        targetUid: userMeta.medalTargetUid
      } : null
    }
  };
}

module.exports = { FansMedalPoller };
