// Only the authorized client reads configuration; canvas frames receive display data.
export function startOpeningCanvasData(controller, emit) {
  const requests = new AbortController();
  let timer;
  async function refresh() {
    if (requests.signal.aborted) return;
    let opening = null;
    if (controller.getState().draft.document.items.some((item) => item.type === 'opening')) {
      try {
        const response = await fetch('/api/opening/config', { cache: 'no-store',
          signal: AbortSignal.any([requests.signal, AbortSignal.timeout(5000)]) });
        const payload = await response.json();
        if (response.ok && payload.ok) opening = payload.data;
      } catch {
        // Pause unavailable content until the next successful read.
        opening = null;
      }
    }
    if (requests.signal.aborted) return;
    emit({ previewData: { opening } });
    timer = window.setTimeout(refresh, 1000);
  }
  void refresh();
  return () => { requests.abort(); window.clearTimeout(timer); };
}
