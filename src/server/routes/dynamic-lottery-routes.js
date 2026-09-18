'use strict';

const { sendJson } = require('../http-utils');
const { publicCode } = require('../../bilibili/dynamic-lottery/service');

async function respond(context, res, operation) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!context.dynamicLottery) {
      sendJson(res, 503, { ok: false, error: 'LOTTERY_DESKTOP_REQUIRED' });
      return;
    }
    const data = await operation(context.dynamicLottery);
    sendJson(res, 200, { ok: true, data });
  } catch (error) {
    if (error.code === 'REQUEST_BODY_TOO_LARGE') throw error;
    const code = publicCode(error);
    const status =
      code === 'LOTTERY_IDENTITY_UNAVAILABLE'
        ? 403
        : code === 'LOTTERY_TASK_NOT_FOUND'
          ? 404
          : code === 'LOTTERY_BUSY' || code === 'LOTTERY_DRAW_CONFLICT'
            ? 409
            : 400;
    sendJson(res, status, { ok: false, error: code });
  }
}

const routes = {
  'GET /api/bilibili/dynamic-lottery/state'(context, request, res) {
    return respond(context, res, (service) =>
      service.getState({ taskId: request.query.get('taskId') || undefined }),
    );
  },
  'POST /api/bilibili/dynamic-lottery/tasks'(context, request, res) {
    return respond(context, res, async (service) => {
      const body = await request.body();
      return service.createTask({
        url: body.url,
        winnerCount: body.winnerCount,
        requireLike: body.requireLike,
        requireRepost: body.requireRepost,
        requireFollow: body.requireFollow,
        requestId: body.requestId,
      });
    });
  },
  'POST /api/bilibili/dynamic-lottery/tasks/action'(context, request, res) {
    return respond(context, res, async (service) => {
      const body = await request.body();
      return service.actOnTask({
        taskId: body.taskId,
        action: body.action,
        revision: body.revision,
      });
    });
  },
};

module.exports = { prefixes: ['/api/bilibili/dynamic-lottery/'], routes };
