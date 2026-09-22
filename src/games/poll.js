'use strict';

function createPoll(options) {
  const voters = new Set();
  const indices = new Map(options.map((text, index) => [text, index]));
  const votes = options.map(() => 0);
  return {
    accept(uid, text) {
      if (voters.has(uid) || !indices.has(text)) return false;
      voters.add(uid);
      votes[indices.get(text)] += 1;
      return true;
    },
    count: () => voters.size,
    result: () =>
      options.map((text, index) => ({
        text,
        votes: votes[index],
        percentage: voters.size ? (votes[index] / voters.size) * 100 : 0,
      })),
  };
}

module.exports = { createPoll };
