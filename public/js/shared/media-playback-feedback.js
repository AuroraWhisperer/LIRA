export function isInterruptedMediaPlayError(error) {
  return error?.name === 'AbortError'
    || /play\(\) request was interrupted/i.test(String(error?.message || error || ''));
}
