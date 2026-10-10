'use strict';

const { createDisplayNotifications } = require('./display-notifications');

function createSceneOutputEvents(options) {
  return createDisplayNotifications({ ...options,
    createError: (statusCode) => Object.assign(new Error('场景通知暂时不可用，请重试。'), {
      statusCode, code: 'SCENE_EVENTS_UNAVAILABLE',
    }),
  });
}

module.exports = { createSceneOutputEvents };
