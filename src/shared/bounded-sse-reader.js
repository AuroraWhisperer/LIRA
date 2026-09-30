'use strict';

async function readBoundedSse(response, { onOpen, onBlock, createLimitError, signal }) {
  const reader = response.body.getReader();
  const eventBytes = Buffer.allocUnsafe(64 * 1024);
  let eventLength = 0;
  let pendingNewline = false;
  let pendingCarriageReturn = false;
  let firstBlock = true;
  let cancellation;
  const cancel = () => {
    cancellation ??= Promise.resolve().then(() => reader.cancel?.()).catch(() => {});
    return cancellation;
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    onOpen(response);
    while (true) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      for (const byte of value || []) {
        signal?.throwIfAborted();
        if (pendingCarriageReturn) {
          pendingCarriageReturn = false;
          if (byte !== 10) acceptByte(13);
        }
        if (byte === 13) pendingCarriageReturn = true;
        else acceptByte(byte);
      }
      if (done) {
        if (pendingCarriageReturn) acceptByte(13);
        break;
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    await cancel();
    reader.releaseLock?.();
  }

  function acceptByte(byte) {
    if (byte === 10) {
      if (!pendingNewline) {
        pendingNewline = true;
        return;
      }
      let block = eventBytes.toString('utf8', 0, eventLength);
      if (firstBlock && block.startsWith('\uFEFF')) block = block.slice(1);
      firstBlock = false;
      pendingNewline = false;
      eventLength = 0;
      onBlock(block);
      return;
    }
    if (pendingNewline) {
      writeByte(10);
      pendingNewline = false;
    }
    writeByte(byte);
  }

  function writeByte(byte) {
    if (eventLength === eventBytes.length) throw createLimitError();
    eventBytes[eventLength++] = byte;
  }
}

function parseEventBlock(block) {
  let eventName = '';
  const dataLines = [];
  for (const line of String(block || '').split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  return { eventName, data: dataLines.join('\n') };
}

module.exports = { readBoundedSse, parseEventBlock };
