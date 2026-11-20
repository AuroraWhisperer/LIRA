// 歌词行按起始时间升序排列。同毫秒取末行，首行开始前返回 -1。
export function findLyricLineIndex(lines, targetMs, getStartMs) {
  let low = 0;
  let high = lines.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (getStartMs(lines[middle]) <= targetMs) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return low - 1;
}
