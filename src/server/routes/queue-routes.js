// 编写人：Aurora
// 播放队列域路由：主播手动点歌和队列操作。
'use strict';

const { sendJson } = require('../http-utils');

const prefixes = ['/api/queue/'];

const routes = {
  async 'POST /api/queue/add'(context, request, res) {
    const body = await request.body();
    const item = context.queue.add({
      songName: body.songName,
      artist: body.artist,
      categoryName: body.categoryName,
      requesterName: body.requesterName || '主播',
      requesterUid: body.requesterUid || 'admin',
      requesterGuardLevel: body.requesterGuardLevel,
      requesterMedalName: body.requesterMedalName,
      requesterMedalLevel: body.requesterMedalLevel,
      source: body.source || 'admin',
      message: body.message || ''
    });
    context.broadcastSnapshot('queue:add');
    sendJson(res, 200, { ok: true, data: item });
  },

  async 'POST /api/queue/action'(context, request, res) {
    const body = await request.body();
    const result = context.queue.handleAction(body.action, body.id);
    context.broadcastSnapshot(`queue:${body.action}`);
    sendJson(res, 200, { ok: true, data: result });
  }
};

module.exports = { prefixes, routes };
