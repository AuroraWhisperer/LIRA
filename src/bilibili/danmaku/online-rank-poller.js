// 编写人：Aurora
// 在线榜轮询器 — 定时拉取高能榜用户信息，缓存身份数据（勋章、舰长等）。
'use strict';

const packetParser = require('../packet-parser');
const bilibiliHelpers = require('../helpers');
const { normalizePositiveInteger } = require('../../shared/utils');

const BILIBILI_ONLINE_RANK_POLL_MS = 60 * 1000;
const BILIBILI_ONLINE_RANK_PAGE_SIZE = 50;
const BILIBILI_ONLINE_RANK_MAX_PAGES = 3;

class OnlineRankPoller {
  constructor(apiClient, identityCache) {
    this.apiClient = apiClient;
    this.identityCache = identityCache;
    this.timer = null;
  }

  start(roomId, ruid) {
    this.stop();
    if (!roomId || !ruid) return;

    this.pollOnlineRank(roomId, ruid).catch((error) => {
      console.warn(`[Bilibili] online rank polling failed: ${error.message}`);
    });
    this.timer = setInterval(() => {
      this.pollOnlineRank(roomId, ruid).catch((error) => {
        console.warn(`[Bilibili] online rank polling failed: ${error.message}`);
      });
    }, BILIBILI_ONLINE_RANK_POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async pollOnlineRank(roomId, ruid) {
    let cachedCount = 0;

    for (let page = 1; page <= BILIBILI_ONLINE_RANK_MAX_PAGES; page += 1) {
      const data = await this.apiClient.fetchOnlineRank(roomId, ruid, page, BILIBILI_ONLINE_RANK_PAGE_SIZE);
      const items = bilibiliHelpers.readBilibiliOnlineRankItems(data);
      if (items.length === 0) break;

      for (const item of items) {
        const userMeta = packetParser.extractBilibiliOnlineRankUserMeta(item);
        if (this.identityCache.remember(userMeta)) {
          cachedCount += 1;
        }
      }

      const onlineNum = normalizePositiveInteger(data.onlineNum || data.online_num);
      if (items.length < BILIBILI_ONLINE_RANK_PAGE_SIZE) break;
      if (onlineNum > 0 && page * BILIBILI_ONLINE_RANK_PAGE_SIZE >= onlineNum) break;
    }

    this.identityCache.cleanup();
    if (cachedCount > 0) {
      console.log(`[Bilibili] online rank cached ${cachedCount} viewer identity record(s).`);
    }
  }
}

module.exports = { OnlineRankPoller };
