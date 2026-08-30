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

    this.pollOnlineRank(context, localGeneration).catch((error) => {
      console.warn(`[Bilibili] online rank polling failed: ${error.message}`);
    });
    this.timer = setInterval(() => {
      this.pollOnlineRank(context, localGeneration).catch((error) => {
        console.warn(`[Bilibili] online rank polling failed: ${error.message}`);
      });
    }, BILIBILI_ONLINE_RANK_POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.localGeneration += 1;
  }

  async pollOnlineRank(context, localGeneration = this.localGeneration) {
    if (this.pollInFlight) return;
    this.pollInFlight = true;
    let cachedCount = 0;
    const onlineUids = [];
    try {
      for (let page = 1; page <= BILIBILI_ONLINE_RANK_MAX_PAGES; page += 1) {
        if (localGeneration !== this.localGeneration) return;
        const data = await this.apiClient.fetchOnlineRank(
          context.roomId,
          context.ownerUid,
          page,
          BILIBILI_ONLINE_RANK_PAGE_SIZE,
        );
        if (localGeneration !== this.localGeneration) return;
        const items = bilibiliHelpers.readBilibiliOnlineRankItems(data);
        if (items.length === 0) break;

        for (const item of items) {
          if (localGeneration !== this.localGeneration) return;
          const userMeta = packetParser.extractBilibiliOnlineRankUserMeta(
            item,
            context.ownerUid,
          );
          if (userMeta.uid) onlineUids.push(userMeta.uid);
          const result = this.sink.ingestHint(toIdentityHint(userMeta), {
            ...context,
            source: 'online_rank',
            roomIdentityVerified: userMeta.currentRoomVerified === true,
          });
          if (result && result.snapshot) cachedCount += 1;
        }

        const onlineNum = normalizePositiveInteger(
          data.onlineNum || data.online_num,
        );
        if (items.length < BILIBILI_ONLINE_RANK_PAGE_SIZE) break;
        if (onlineNum > 0 && page * BILIBILI_ONLINE_RANK_PAGE_SIZE >= onlineNum)
          break;
      }
      if (localGeneration !== this.localGeneration) return;
      this.sink.replaceOnlineSnapshot(onlineUids, context);
    } finally {
      this.pollInFlight = false;
    }

    if (cachedCount > 0) {
      console.log(
        `[Bilibili] online rank cached ${cachedCount} viewer identity record(s).`,
      );
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

module.exports = { OnlineRankPoller };
