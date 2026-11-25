import { readApiResponse } from './json-response.js';

export async function requestApiData(path, { body, signal, errorMessage }) {
  // Keep the timeout active through body reading on older browser-source Chromium.
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 10000);
  try {
    const response = await fetch(path, {
      ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    return (await readApiResponse(response, errorMessage)).data;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
