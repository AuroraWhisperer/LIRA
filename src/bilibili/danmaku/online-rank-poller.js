// 编写人：Aurora
// 在线榜轮询器 — 定时拉取网页在线榜，缓存身份数据（勋章、舰长等）。
'use strict';

const packetParser = require('../packet-parser');
const { toRankIdentityHint } = require('./rank-identity-hint');

const BILIBILI_ONLINE_RANK_POLL_MS = 60 * 1000;
const ONLINE_RANK_SORTS = ['contribution_rank', 'entry_time_rank'];

class OnlineRankPoller {
  constructor(apiClient, sink) {
    this.apiClient = apiClient;
    this.sink = sink;
    this.timer = null;
    this.pollInFlight = null;
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
    this.pollInFlight = null;
  }

  pollOnlineRank(context, localGeneration = this.localGeneration) {
    if (localGeneration !== this.localGeneration) return Promise.resolve();
    if (this.pollInFlight) return this.pollInFlight;
    const request = this.fetchOnlineSnapshot(context, localGeneration).finally(() => {
      if (this.pollInFlight === request) this.pollInFlight = null;
    });
    this.pollInFlight = request;
    return request;
  }

  async fetchOnlineSnapshot(context, localGeneration) {
    // Each ordering exposes up to 100 users; pagination repeats that ordering's list.
    const results = await Promise.allSettled(ONLINE_RANK_SORTS.map((sort) =>
      this.apiClient.fetchOnlineRank(context.roomId, context.ownerUid, sort),
    ));
    if (localGeneration !== this.localGeneration) return;
    const available = results.filter((result) => result.status === 'fulfilled');
    if (!available.length) throw results[0].reason;
    const items = available.flatMap((result) => result.value.item.slice(0, 100));
    let cachedCount = 0;
    const onlineUids = new Set();
    for (const item of items) {
      if (localGeneration !== this.localGeneration) return;
      const userMeta = packetParser.extractBilibiliOnlineRankUserMeta(item, context.ownerUid);
      if (!userMeta.uid || onlineUids.has(userMeta.uid)) continue;
      onlineUids.add(userMeta.uid);
      const result = this.sink.ingestHint(toRankIdentityHint(userMeta), {
        ...context,
        source: 'online_rank',
        roomIdentityVerified: userMeta.currentRoomVerified === true,
      });
      if (result && result.snapshot) cachedCount += 1;
    }
    if (localGeneration !== this.localGeneration) return;
    this.sink.replaceOnlineSnapshot([...onlineUids], context);

    if (cachedCount > 0) {
      console.log(`[Bilibili] online rank cached ${cachedCount} viewer identity record(s).`);
    }
  }
}

module.exports = { OnlineRankPoller };
