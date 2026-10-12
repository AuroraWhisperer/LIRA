let roomGuard = { roomId: '', count: null };
const listeners = new Set();

export function getRoomGuardState() {
  return { ...roomGuard };
}

export function isThousandGuardRoom(count = roomGuard.count) {
  return Number.isSafeInteger(count) && count > 1000;
}

export function subscribeRoomGuardState(listener) {
  listeners.add(listener);
  listener(getRoomGuardState());
  return () => listeners.delete(listener);
}

// Reuse the existing room snapshot; consumers never fetch a count per image.
export function setRoomGuardState(state) {
  const count = state?.roomId && Number.isSafeInteger(state.count) && state.count >= 0 ? state.count : null;
  const next = { roomId: state?.roomId || '', count };
  if (next.roomId === roomGuard.roomId && next.count === roomGuard.count) return;
  roomGuard = next;
  for (const listener of listeners) listener(getRoomGuardState());
}
