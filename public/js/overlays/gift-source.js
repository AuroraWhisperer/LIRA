// gift:source also announces newly readable history for the current owner.
export function createGiftSourceTracker() {
  let epoch;
  return (state, reasons) => {
    const next = state?.giftSourceEpoch;
    if (next !== undefined) {
      const changed = epoch === undefined ? reasons.includes('gift:source') : next !== epoch;
      epoch = next;
      return changed;
    }
    if (epoch !== undefined && reasons.includes('connect')) {
      epoch = undefined;
      return true;
    }
    return reasons.includes('gift:source');
  };
}
