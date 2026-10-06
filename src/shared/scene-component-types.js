'use strict';

const { SCENE_EXTRA_COMPONENTS } = require('../../public/js/shared/scene-extra-components.js');
const SHARED_SCENE_TYPES = Object.freeze(['danmaku', 'clock', 'queue', 'overtime']);
const SCENE_TYPES = Object.freeze([...SHARED_SCENE_TYPES, ...Object.keys(SCENE_EXTRA_COMPONENTS), 'text-box', 'browser']);

module.exports = { SCENE_TYPES, SHARED_SCENE_TYPES };
