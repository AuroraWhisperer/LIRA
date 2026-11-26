export const SONG_PRICE_HEADERS = Object.freeze([
  'requestPrice', 'request_price', '点歌价格', '点歌价', '点歌门槛', '点歌要求', '点歌条件', '点歌说明',
]);

// A row object cannot retain two cells with the same key. Keep their source
// values for the domain's existing per-row price validation.
export function repeatedPriceIndexes(header) {
  const indexes = header.flatMap((label, index) => SONG_PRICE_HEADERS.includes(label) ? [index] : []);
  const distinct = new Set(indexes.map((index) => header[index]));
  return distinct.size === indexes.length ? [] : indexes;
}
