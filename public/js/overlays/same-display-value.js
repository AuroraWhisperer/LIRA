// Display snapshots cross JSON and postMessage boundaries, so equal data may have new references.
export function sameDisplayValue(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameDisplayValue(value, right[index]));
  }
  if (Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && sameDisplayValue(left[key], right[key]));
}
