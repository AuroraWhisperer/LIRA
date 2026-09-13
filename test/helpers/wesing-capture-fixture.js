'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { encryptQrc } = require('qrc-decoder');

function qrcXml(content, options = {}) {
  const saveTime = options.saveTime || 8;
  return `<?xml version="1.0" encoding="utf-8"?>\n<QrcInfos><LyricInfo SaveTime="${saveTime}"><Lyric_1 LyricType="1" LyricContent="${content}"/></LyricInfo></QrcInfos>`;
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wesing-cache-'));
  const cachePath = path.join(root, 'WeSingCache');
  const mid = 'safe_mid-123';
  const logDir = path.join(cachePath, 'Log', 'WeSing');
  const qrcDir = path.join(cachePath, 'WeSingDL', 'Res', mid);
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(qrcDir, { recursive: true });
  fs.writeFileSync(
    path.join(logDir, 'WeSing-1.log'),
    Buffer.from(
      [
        'ignored line',
        'event "StartKSong" payload {"mid":"older","songname":"旧歌"}',
        `event "StartKSong" payload {"mid":"${mid}","songname":"测试歌曲","singer":"测试歌手"}`,
      ].join('\r\n'),
      'utf16le',
    ),
  );

  const content =
    '[ti:测试歌曲]\n[ar:测试歌手]\n[1000,1800]你(1000,800)好(1800,1000)\n[4000,1200]世(4000,600)界(4600,600)';
  const encrypted = Buffer.from(encryptQrc(qrcXml(content)), 'hex');
  fs.writeFileSync(
    path.join(qrcDir, `${mid}.qrc`),
    Buffer.concat([Buffer.from('[offset:0]\n', 'utf8'), encrypted]),
  );
  return { root, cachePath, mid };
}

module.exports = {
  createFixture,
  qrcXml,
};
