// One request per component type; only the authorized parent reads these endpoints.
export function startCanvasDataPolling(controller, { type, url, emit }) {
  const requests = new AbortController();
  let timer;
  async function refresh() {
    if (requests.signal.aborted) return;
    let data = null;
    if (controller.getState().draft.document.items.some(item => item.type === type)) {
      try {
        const response = await fetch(url, { cache: 'no-store',
          signal: AbortSignal.any([requests.signal, AbortSignal.timeout(5000)]) });
        const payload = await response.json();
        if (response.ok && payload.ok) data = payload.data;
      } catch {
        // Clear unavailable content until the next successful read.
        data = null;
      }
    }
    if (requests.signal.aborted) return;
    emit(data);
    timer = window.setTimeout(refresh, 1000);
  }
  void refresh();
  return () => { requests.abort(); window.clearTimeout(timer); };
}
