'use strict';

function createRating() {
  const scores = new Map();
  let sum = 0;
  return {
    accept(uid, text) {
      if (!/^(?:[1-9]|10)$/.test(text)) return false;
      const score = Number(text);
      sum += score - (scores.get(uid) || 0);
      scores.set(uid, score);
      return true;
    },
    count: () => scores.size,
    average: () => (scores.size ? sum / scores.size : null),
  };
}

module.exports = { createRating };
