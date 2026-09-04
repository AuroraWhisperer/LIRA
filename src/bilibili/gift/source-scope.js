'use strict';

function resolveGiftSourceScope(context) {
  const source =
    context.getActiveGiftSource?.() || context.activeGiftSource || null;
  if (source === null) {
    return { sql: 'source_id IS NULL', params: [] };
  }
  if (String(source?.syncState || '').toUpperCase() === 'SOURCE_SWITCHING') {
    return { sql: '1 = 0', params: [] };
  }

  const sourceId = Number(source?.sourceId);
  if (Number.isSafeInteger(sourceId) && sourceId >= 1) {
    return { sql: 'source_id = ?', params: [sourceId] };
  }

  return { sql: '1 = 0', params: [] };
}

module.exports = { resolveGiftSourceScope };
