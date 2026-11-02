'use strict';

const assert = require('node:assert/strict');

function chooseGameWord(service, word = service.getHostState().choices[0].word) {
  const session = service.getSession();
  const result = service.move({ value: {
    action: 'choose-word', word, sessionId: session.sessionId, round: session.state.round,
  } });
  assert.equal(result.accepted, true);
  return result.session;
}

module.exports = { chooseGameWord };
