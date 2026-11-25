'use strict';

const LOCAL_AUDIO_MIME_TYPES = Object.freeze({
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wma': 'audio/x-ms-wma',
});
const LOCAL_AUDIO_EXTENSIONS = Object.freeze(Object.keys(LOCAL_AUDIO_MIME_TYPES));

module.exports = { LOCAL_AUDIO_MIME_TYPES, LOCAL_AUDIO_EXTENSIONS };
