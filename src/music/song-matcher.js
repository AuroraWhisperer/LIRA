'use strict';

const AUTO_ACCEPT_SCORE = 70;

function rankTrackCandidates(request, candidates) {
  const normalizedRequest = normalizeRequest(request);
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => scoreTrackMatch(normalizedRequest, candidate))
    .sort((a, b) => b.score - a.score || a.track.title.localeCompare(b.track.title));
}

function scoreTrackMatch(request, candidate) {
  const track = normalizeCandidate(candidate);
  const reasons = [];
  let score = 0;

  if (track.title && request.songName && track.title === request.songName) {
    score += 60;
    reasons.push('歌名完全一致 +60');
  }

  if (request.artist && track.artists.some((artist) => artist === request.artist)) {
    score += 25;
    reasons.push('歌手完全一致 +25');
  }

  if (track.cleanTitle && request.cleanSongName && track.cleanTitle === request.cleanSongName && track.title !== request.songName) {
    score += 15;
    reasons.push('歌名清洗后一致 +15');
  }

  if (request.durationMs > 0 && track.durationMs > 0 && Math.abs(request.durationMs - track.durationMs) <= 5000) {
    score += 10;
    reasons.push('时长误差小于 5 秒 +10');
  }

  if (track.album && !hasPenaltyKeyword(track.album)) {
    score += 5;
    reasons.push('有专辑信息 +5');
  }

  for (const penalty of penaltyRules(track)) {
    score += penalty.value;
    reasons.push(`${penalty.label} ${penalty.value}`);
  }

  return {
    score,
    autoAccept: score >= AUTO_ACCEPT_SCORE,
    reasons,
    track
  };
}

function normalizeRequest(request) {
  const input = request && typeof request === 'object' ? request : {};
  const songName = cleanText(input.songName || input.title);
  const artist = cleanText(input.artist);
  return {
    songName,
    cleanSongName: normalizeSongKey(songName),
    artist,
    durationMs: Math.max(0, Number(input.durationMs) || 0)
  };
}

function normalizeCandidate(candidate) {
  const input = candidate && typeof candidate === 'object' ? candidate : {};
  const title = cleanText(input.title || input.name || input.songName);
  const artists = Array.isArray(input.artists)
    ? input.artists.map(cleanText).filter(Boolean)
    : cleanText(input.artist).split('/').map(cleanText).filter(Boolean);

  return {
    id: cleanText(input.id || input.sourceTrackId),
    source: cleanText(input.source || 'local'),
    title,
    cleanTitle: normalizeSongKey(title),
    artists,
    album: cleanText(input.album),
    durationMs: Math.max(0, Number(input.durationMs) || 0)
  };
}

function penaltyRules(track) {
  const text = `${track.title} ${track.album}`.toLowerCase();
  const penalties = [];
  if (/live|现场|演唱会/.test(text)) penalties.push({ value: -15, label: 'Live / 现场' });
  if (/dj|remix|混音|电音/.test(text)) penalties.push({ value: -25, label: 'DJ / Remix' });
  if (/伴奏|纯音乐|instrumental/.test(text)) penalties.push({ value: -30, label: '伴奏 / 纯音乐' });
  if (/翻唱|cover/.test(text)) penalties.push({ value: -20, label: '翻唱' });
  if (/加速|慢速|speed up|sped up|slowed/.test(text)) penalties.push({ value: -20, label: '加速版 / 慢速版' });
  return penalties;
}

function hasPenaltyKeyword(value) {
  return penaltyRules({
    title: value,
    album: '',
    artists: [],
    durationMs: 0
  }).length > 0;
}

function normalizeSongKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[\s"'`~!@#$%^&*_\-+=|\\/:;：，,.。?？<>《》[\]{}]+/g, '');
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

module.exports = {
  AUTO_ACCEPT_SCORE,
  rankTrackCandidates,
  scoreTrackMatch
};
