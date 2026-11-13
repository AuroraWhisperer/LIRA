'use strict';

const { toSimplifiedChinese } = require('../shared/chinese-text');

function createPoll(options) {
  const voters = new Set();
  const indices = new Map(options.map((text, index) => [text, index]));
  const comparableIndices = new Map();
  options.forEach((text, index) => {
    const key = toSimplifiedChinese(text);
    comparableIndices.set(key, comparableIndices.has(key) ? null : index);
  });
  const votes = options.map(() => 0);
  return {
    accept(uid, text) {
      if (voters.has(uid)) return false;
      const index = indices.get(text) ?? comparableIndices.get(toSimplifiedChinese(text));
      if (!Number.isInteger(index)) return false;
      voters.add(uid);
      votes[index] += 1;
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
