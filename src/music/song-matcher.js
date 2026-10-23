'use strict';

const AUTO_ACCEPT_SCORE = 70;
const VERSION_RULES = [
  { pattern: /\blive\b|现场|演唱会/i, value: -15, label: 'Live / 现场' },
  { pattern: /\b(?:dj|remix)\b|混音|电音/i, value: -25, label: 'DJ / Remix' },
  { pattern: /\binstrumental\b|伴奏|纯音乐/i, value: -30, label: '伴奏 / 纯音乐' },
  { pattern: /\bcover\b|翻唱/i, value: -20, label: '翻唱' },
  { pattern: /\b(?:speed up|sped up|slowed)\b|加速|慢速/i, value: -20, label: '加速版 / 慢速版' },
];

function rankTrackCandidates(request, candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => scoreTrackMatch(request, candidate))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || Number(a.track.playable === false) - Number(b.track.playable === false));
}

function scoreTrackMatch(input, candidate) {
  const request = normalizeRequest(input);
  const track = normalizeCandidate(candidate);
  const sameTitle = Boolean(request.titleKey && normalizeSongKey(track.title) === request.titleKey);
  const sameBaseTitle = Boolean(track.cleanTitle && track.cleanTitle === request.cleanSongName);
  const titleTypo = !sameTitle && !sameBaseTitle && hasSingleLetterTypo(request.cleanSongName, track.cleanTitle);
  if (!sameTitle && !sameBaseTitle && !titleTypo) return null;

  const trackVersions = findVersionRules(`${track.title} ${track.album}`);
  if (request.versions.some((version) => !trackVersions.includes(version))) return null;

  const artistMatched = track.artists.some((artist) => normalizeComparableText(artist) === request.artist);
  const artistConflict = Boolean(request.artist && !artistMatched);
  const hasDurations = request.durationMs > 0 && track.durationMs > 0;
  const durationConflict = hasDurations && Math.abs(request.durationMs - track.durationMs) > 5000;
  const reasons = [];
  let score = 0;

  if (sameTitle) {
    score += 60;
    reasons.push(track.title === request.songName ? '歌名完全一致 +60' : '歌名格式归一后一致 +60');
  }

  if (request.artist && artistMatched) {
    score += 25;
    reasons.push('歌手完全一致 +25');
  }

  if (sameBaseTitle && !sameTitle) {
    score += 15;
    reasons.push('忽略版本标记后歌名一致 +15');
  }

  if (titleTypo) {
    score += 10;
    reasons.push('歌名仅一个英文字母不同，需确认 +10');
  }

  if (hasDurations && !durationConflict) {
    score += 10;
    reasons.push('时长误差不超过 5 秒 +10');
  }

  if (track.album && findVersionRules(track.album).every((version) => request.versions.includes(version))) {
    score += 5;
    reasons.push('有专辑信息 +5');
  }

  for (const penalty of trackVersions.filter((version) => !request.versions.includes(version))) {
    score += penalty.value;
    reasons.push(`${penalty.label} ${penalty.value}`);
  }

  if (artistConflict) reasons.push('歌手未匹配，需确认');
  if (durationConflict) reasons.push('时长误差超过 5 秒，需确认');
  if (track.playable === false) reasons.push('平台标记可能不可播，需确认');

  return {
    score,
    autoAccept: score >= AUTO_ACCEPT_SCORE && !artistConflict && !durationConflict && track.playable !== false,
    reasons,
    track,
  };
}

function normalizeRequest(request) {
  const input = request && typeof request === 'object' ? request : {};
  const songName = cleanText(input.songName || input.title);
  return {
    songName,
    titleKey: normalizeSongKey(songName),
    cleanSongName: normalizeSongKey(stripVersionAnnotations(songName)),
    versions: findVersionRules(songName),
    artist: normalizeComparableText(input.artist),
    durationMs: Math.max(0, Number(input.durationMs) || 0),
  };
}

function normalizeCandidate(candidate) {
  const input = candidate && typeof candidate === 'object' ? candidate : {};
  const title = cleanText(input.title || input.name || input.songName);
  const artists = Array.isArray(input.artists)
    ? input.artists.map(cleanText).filter(Boolean)
    : cleanText(input.artist).split('/').map(cleanText).filter(Boolean);

  return {
    ...input,
    id: cleanText(input.id || input.sourceTrackId),
    source: cleanText(input.source || 'local'),
    title,
    cleanTitle: normalizeSongKey(stripVersionAnnotations(title)),
    artists,
    album: cleanText(input.album),
    durationMs: Math.max(0, Number(input.durationMs) || 0),
  };
}

function findVersionRules(value) {
  const text = normalizeComparableText(value);
  return VERSION_RULES.filter((rule) => rule.pattern.test(text));
}

function stripVersionAnnotations(value) {
  return normalizeComparableText(value).replace(/\(([^()]*)\)/g, (annotation, content) =>
    findVersionRules(content).length ? '' : annotation);
}

function normalizeSongKey(value) {
  return normalizeComparableText(value)
    .replace(/[\s"'`~!@#$%^&*_\-+=|\\/:;：，,.。?？<>《》()[\]{}]+/g, '');
}

function normalizeComparableText(value) {
  return cleanText(value).normalize('NFKC').toLowerCase();
}

function hasSingleLetterTypo(requestedTitle = '', candidateTitle = '') {
  // Compare the whole title; short names and non-Latin substitutions are ambiguous.
  if (requestedTitle.length < 5 || requestedTitle.length !== candidateTitle.length) return false;
  let differences = 0;
  for (let index = 0; index < requestedTitle.length; index++) {
    if (requestedTitle[index] === candidateTitle[index]) continue;
    if (!/[a-z]/.test(requestedTitle[index]) || !/[a-z]/.test(candidateTitle[index])) return false;
    if (++differences > 1) return false;
  }
  return differences === 1;
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  AUTO_ACCEPT_SCORE,
  rankTrackCandidates,
  scoreTrackMatch,
};
