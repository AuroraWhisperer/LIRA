'use strict';

function trackBodyReads(t, db, column) {
  const stats = { queries: [], returnedBytes: 0, largestBind: 0 };
  const prepare = db.prepare.bind(db);
  t.mock.method(db, 'prepare', sql => {
    const stmt = prepare(sql);
    const get = stmt.get.bind(stmt);
    stmt.get = (...args) => {
      const row = get(...args);
      stats.queries.push(sql);
      if (row?.[column] != null) stats.returnedBytes += Buffer.byteLength(row[column]);
      for (const arg of args) {
        if (typeof arg === 'string' || ArrayBuffer.isView(arg)) {
          stats.largestBind = Math.max(stats.largestBind, Buffer.byteLength(arg));
        }
      }
      return row;
    };
    return stmt;
  });
  return stats;
}

module.exports = { trackBodyReads };
