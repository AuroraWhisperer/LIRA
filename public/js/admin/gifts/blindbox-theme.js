const BLIND_BOX_THEMES = [
  { name: '心动盲盒', id: '32251', key: 'heart', className: 'blind-box-heart' },
  { name: '幸运盲盒', id: '35206', key: 'lucky', className: 'blind-box-lucky' },
  { name: '修仙盲盒', id: '35891', key: 'xiuxian', className: 'blind-box-xiuxian' },
  { name: '中秋盲盒', key: 'mid-autumn' },
  { name: '小熊虫盲盒', key: 'bear' },
  { name: '七夕鹊匣', key: 'qixi' },
  { name: '羁绊宝盒', key: 'bond' },
];

export function findBlindBoxTheme(name, id) {
  const boxName = String(name || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const boxId = String(id || '').trim();
  // Gift IDs can be reused for another seasonal box; the full name must also match.
  return BLIND_BOX_THEMES.find(
    (theme) => theme.name === boxName && (!theme.id || !boxId || theme.id === boxId),
  );
}
