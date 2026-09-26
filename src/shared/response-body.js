'use strict';

async function readResponseBytes(response, maxBytes, createLimitError) {
  if (Number(response.headers?.get?.('content-length')) > maxBytes) {
    const error = createLimitError();
    try {
      await response.body?.cancel();
    } catch {
      throw error;
    }
    throw error;
  }

  if (response.body?.[Symbol.asyncIterator]) {
    let bytes = Buffer.alloc(0);
    let total = 0;
    // Exiting the iterator on overflow cancels the unread body and releases it.
    for await (const chunk of response.body) {
      const length = total + chunk.byteLength;
      if (length > maxBytes) throw createLimitError();
      if (length > bytes.length) {
        // Geometric growth bounds retained objects even when every chunk is one byte.
        const grown = Buffer.alloc(Math.min(maxBytes, Math.max(length, bytes.length * 2, 4096)));
        bytes.copy(grown, 0, 0, total);
        bytes = grown;
      }
      bytes.set(chunk, total);
      total = length;
    }
    return bytes.subarray(0, total);
  }

  // Preserve injected response fixtures that implement only the body helpers.
  const bytes = typeof response.arrayBuffer === 'function'
    ? Buffer.from(await response.arrayBuffer())
    : Buffer.from(await response.text());
  if (bytes.length > maxBytes) throw createLimitError();
  return bytes;
}

async function readResponseText(response, maxBytes, createLimitError) {
  return new TextDecoder().decode(await readResponseBytes(response, maxBytes, createLimitError));
}

module.exports = { readResponseBytes, readResponseText };
