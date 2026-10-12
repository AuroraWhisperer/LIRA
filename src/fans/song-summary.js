'use strict';

const { dayOf, addDays, dateValue } = require('./dates');

const SONG_STATS_DAYS = 30;

function songIdentity(data) {
  return JSON.stringify([data.songName, data.artist || ''].map((value) => value.trim().toLowerCase()));
}

function recentSongCounts(counts, at, includeFuture = false) {
  const today = dayOf(at);
  const start = addDays(today, 1 - SONG_STATS_DAYS);
  return counts.filter((item) => item.date >= start && (includeFuture || item.date <= today));
}

// A summary contains counts and dates, never individual requests or revisions.
function summarizeSongs(records, at) {
  const groups = new Map();
  for (const record of records) {
    const data = record.data;
    const key = songIdentity(data);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.values()].map((songs) => {
    songs.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
    const latest = songs.find((record) => Object.hasOwn(record.data, 'count') ? record.data.count > 0 :
      !record.data.excluded && !/^random(?::|$)/.test(record.original?.source || '')) || songs[0];
    let count = 0;
    const dates = new Set();
    const notes = new Set();
    const daily = new Map();
    for (const record of songs) {
      const data = record.data;
      if (data.note) for (const line of data.note.split('\n')) notes.add(line);
      const summary = Object.hasOwn(data, 'count');
      const eligible = !data.excluded && !/^random(?::|$)/.test(record.original?.source || '');
      const amount = summary ? data.count : Number(eligible);
      count += amount;
      if (!Number.isSafeInteger(count)) throw new Error('点歌累计次数超出可保存范围。');
      const recentDates = summary ? data.recentDates : amount ? [dayOf(record.occurredAt)] : [];
      for (const date of recentDates) dates.add(date);
      const counts = summary ? data.dailyCounts : amount && !data.excludeFromStats
        ? [{ date: dayOf(record.occurredAt), category: data.category || '未分类', count: 1 }] : [];
      for (const item of recentSongCounts(counts, at, true)) {
        const dailyKey = JSON.stringify([item.date, item.category]);
        const current = daily.get(dailyKey) || { ...item, count: 0 };
        current.count += item.count;
        daily.set(dailyKey, current);
      }
    }
    return {
      ...latest,
      sourceKey: null,
      data: {
        songName: latest.data.songName,
        artist: latest.data.artist || '',
        count,
        recentDates: [...dates].sort().reverse().slice(0, 3),
        dailyCounts: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category)),
        note: [...notes].join('\n'),
      },
      original: {},
      revisions: [],
    };
  });
}

function validateSongSummary(data) {
  const fail = () => { throw new Error('备份中的点歌汇总无效。'); };
  if (!Number.isSafeInteger(data.count) || data.count < 0 || !Array.isArray(data.recentDates) ||
      data.recentDates.length > Math.min(3, data.count) || !Array.isArray(data.dailyCounts)) fail();
  let previous = '';
  for (const date of data.recentDates) {
    dateValue(date, '最近点歌日期', false);
    if (previous && date >= previous) fail();
    previous = date;
  }
  if (data.count && !data.recentDates.length) fail();
  let counted = 0;
  const keys = new Set();
  for (const item of data.dailyCounts) {
    dateValue(item.date, '点歌统计日期', false);
    if (!data.recentDates.length || item.date > data.recentDates[0]) fail();
    if (typeof item.category !== 'string' || item.category.length > 300 ||
        !Number.isSafeInteger(item.count) || item.count < 1) fail();
    const key = JSON.stringify([item.date, item.category]);
    if (keys.has(key)) fail();
    keys.add(key);
    counted += item.count;
  }
  if (!Number.isSafeInteger(counted) || counted > data.count) fail();
}

module.exports = { SONG_STATS_DAYS, songIdentity, recentSongCounts, summarizeSongs, validateSongSummary };
