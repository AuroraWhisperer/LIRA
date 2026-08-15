'use strict';

const {
  extractQrcLyricContent,
  findLatestSongEntry,
  loadWeSingLyrics,
  normalizeWeSingCachePath,
  normalizeWeSingLyricOffsetMs,
  parseQrcDocument
} = require('./wesing-cache');
const { createWeSingCapture } = require('./wesing-capture-engine');
const {
  buildPowerShellMonitorScript,
  createPowerShellWeSingMonitor
} = require('./wesing-monitor');

module.exports = {
  buildPowerShellMonitorScript,
  createPowerShellWeSingMonitor,
  createWeSingCapture,
  extractQrcLyricContent,
  findLatestSongEntry,
  loadWeSingLyrics,
  normalizeWeSingCachePath,
  normalizeWeSingLyricOffsetMs,
  parseQrcDocument
};
