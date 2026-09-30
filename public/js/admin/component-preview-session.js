let active = null;

export function getActiveComponentPreview(id) {
  return active?.id === id ? active : null;
}

export function closeComponentPreview() {
  active?.close();
}

export function setActiveComponentPreview(handle) {
  active = handle;
}

export function releaseComponentPreview(handle) {
  if (active === handle) active = null;
}
