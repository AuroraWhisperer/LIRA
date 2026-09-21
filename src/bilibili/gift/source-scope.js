'use strict';

function resolveGiftSourceScope(context) {
  const source =
    context.getActiveGiftSource?.() || context.activeGiftSource || null;
  if (source === null) {
    return { kind: 'local' };
  }
  if (String(source?.syncState || '').toUpperCase() === 'SOURCE_SWITCHING') {
    return { kind: 'unavailable' };
  }

  const sourceId = Number(source?.sourceId);
  if (Number.isSafeInteger(sourceId) && sourceId >= 1) {
    return { kind: 'source', sourceId };
  }

  return { kind: 'unavailable' };
}

module.exports = { resolveGiftSourceScope };
