'use strict';

// Comparison-only character folding; never rewrite stored or displayed text.
// OpenCC 1.1.9 TSCharacters, first mappings with chains flattened (Apache-2.0).
// Source: BYVoid/OpenCC@556ed22496d650bd0b13b6c163be9814637970ae.
// The derived table is chinese-variants.json; license: opencc-license.txt.
const variants = require('./chinese-variants.json');

function toSimplifiedChinese(value) {
  return Array.from(String(value ?? ''), (character) => variants[character] || character).join('');
}

module.exports = { toSimplifiedChinese };
