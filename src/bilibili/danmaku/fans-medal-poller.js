// 全量粉丝牌轮询器 — 用本房粉丝牌成员接口补全在线榜之外的身份。
'use strict';

const packetParser = require('../packet-parser');
const bilibiliHelpers = require('../helpers');
const { normalizePositiveInteger } = require('../../shared/utils');

const BILIBILI_FANS_MEDAL_POLL_MS = 5 * 60 * 1000;
const BILIBILI_FANS_MEDAL_PAGE_SIZE = 30;
const BILIBILI_FANS_MEDAL_MAX_PAGES = 10000;

class FansMedalPoller {
  constructor(apiClient, identityCache) {
    this.apiClient = apiClient;
    this.identityCache = identityCache;
    this.timer = null;
    this.pollInFlight = false;
    this.generation = 0;
  }

  start(roomId, ruid) {
    this.stop();
    if (!roomId || !ruid) return;
    const generation = this.generation;
    this.pollFansMembers(roomId, ruid, generation).catch((error) => {
      console.warn(`[Bilibili] fans medal polling failed: ${error.message}`);
    });
    this.timer = setInterval(() => {
      this.pollFansMembers(roomId, ruid, generation).catch((error) => {
        console.warn(`[Bilibili] fans medal polling failed: ${error.message}`);
      });
    }, BILIBILI_FANS_MEDAL_POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.generation += 1;
  }

  async pollFansMembers(roomId, ruid, generation = this.generation) {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    let cachedCount = 0;
    try {
      let expectedCount = 0;
      for (let page = 1; page <= BILIBILI_FANS_MEDAL_MAX_PAGES; page += 1) {
        if (generation !== this.generation) return;
        const data = await this.apiClient.fetchFansMembersRank(
          roomId,
          ruid,
          page,
          BILIBILI_FANS_MEDAL_PAGE_SIZE
        );
        expectedCount = normalizePositiveInteger(data.num || data.total || data.total_num);
        const items = bilibiliHelpers.readBilibiliFansMembersRankItems(data);
        if (items.length === 0) break;

        for (const item of items) {
          if (generation !== this.generation) return;
          const userMeta = packetParser.extractBilibiliOnlineRankUserMeta(item, ruid);
          if (this.identityCache.remember(userMeta, { currentRoom: true, source: 'fans_rank' })) {
            cachedCount += 1;
          }
        }

        if (items.length < BILIBILI_FANS_MEDAL_PAGE_SIZE) break;
        if (expectedCount > 0 && page * BILIBILI_FANS_MEDAL_PAGE_SIZE >= expectedCount) break;
      }
    } finally {
      this.pollInFlight = false;
    }

    this.identityCache.cleanup();
    if (cachedCount > 0) {
      console.log(`[Bilibili] fans medal snapshot cached ${cachedCount} member identity record(s).`);
    }
  }
}

module.exports = { FansMedalPoller };
