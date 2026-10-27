'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { decodeXmlEntities } = require('../../src/music/qrc-xml-entities');

test('QRC entities decode named entities and decimal or hexadecimal Unicode points', () => {
  assert.equal(decodeXmlEntities('&quot;&apos;&lt;&gt;&amp;'), '"\'<>&');
  assert.equal(decodeXmlEntities('&#10;&#13;&#x7532;&#20057;&#X1F3B5;'), '\n\r甲乙🎵');
});

test('QRC entity order preserves ampersand-escaped text without recursive decoding', () => {
  assert.equal(decodeXmlEntities('&amp;lt; &amp;#10; &amp;#x41;'), '&lt; &#10; &#x41;');
  assert.equal(decodeXmlEntities('&#38;lt; &#x26;quot; &#x26;#65;'), '< " A');
});
