'use strict';

const { readJsModuleBundle } = require('./js-module-bundle');

// The classic-script bundle inlines queue-theme.js, so its re-export line must be
// removed before the concatenated source can run in a vm context. Fail loudly if the
// re-export changes instead of silently evaluating a broken bundle.
const QUEUE_THEME_REEXPORT =
  /^\s*(?:export\s+)?\{\s*applyTheme,\s*setIdentityRuleThemeVars\s*\}\s+from\s+['"]\.\/queue-theme\.js['"];\s*/gm;

function readQueueOverlayBundle(...relativeSegments) {
  const source = readJsModuleBundle(...relativeSegments);
  const stripped = source.replace(QUEUE_THEME_REEXPORT, '');
  if (/from\s+['"]\.\/queue-theme\.js['"]/.test(stripped)) {
    throw new Error('queue overlay bundle still references ./queue-theme.js; update the test helper');
  }
  return stripped;
}

module.exports = { readQueueOverlayBundle };
