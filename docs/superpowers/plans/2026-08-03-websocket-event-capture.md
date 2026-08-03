# WebSocket Event Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a command-line utility that captures decoded Bilibili live-room WebSocket events to an NDJSON file for later diagnosis.

**Architecture:** Reuse the room-resolution API client, authenticated danmaku WebSocket connection, and packet parser. The script streams one decoded event per line and writes a summary when it stops; pure helpers handle argument parsing and event records so they can be tested without a network connection.

**Tech Stack:** Node.js 24, CommonJS, built-in WebSocket, `node:fs`, `node:test`.

## Global Constraints

- Use Node.js 24 or newer and existing CommonJS style.
- Add no dependency and make no changes to production gift-detection behavior.
- Never print or persist the `BILIBILI_COOKIE` value.
- Default output stays inside generated local directory `tmp/`.
- Run `npm run check` and `npm test` before delivery.

---

### Task 1: Capture Helpers

**Files:**
- Create: `scripts/capture-bilibili-events.js`
- Create: `test/capture-bilibili-events.test.js`

**Interfaces:**
- Consumes: CLI `--room <roomId>`, optional `--duration <seconds>`, optional `--output <path>`, optional `--gift-only`, and optional `BILIBILI_COOKIE`.
- Produces: `parseArguments(argv, cwd)`, `buildCaptureRecord(message, receivedAt)`, and `shouldCaptureMessage(message, giftOnly)`.

- [ ] **Step 1: Write the failing helper tests**

```javascript
const options = parseArguments(['--room', '123', '--duration', '90', '--gift-only'], process.cwd());
assert.equal(options.roomId, '123');
assert.equal(options.durationMs, 90_000);
assert.equal(options.giftOnly, true);

assert.deepEqual(buildCaptureRecord({ cmd: 'GUARD_BUY', data: { uid: 42 } }, '2026-08-03T12:00:00.000Z'), {
  type: 'event', receivedAt: '2026-08-03T12:00:00.000Z', cmd: 'GUARD_BUY', data: { uid: 42 }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --experimental-vm-modules --test test/capture-bilibili-events.test.js`

Expected: FAIL because the helpers do not exist.

- [ ] **Step 3: Implement helpers with validation**

```javascript
function parseArguments(argv, cwd) {
  return {
    roomId: readRequiredOption(argv, '--room'),
    durationMs: Number(readOption(argv, '--duration') || 300) * 1000,
    outputPath: path.resolve(cwd, readOption(argv, '--output') || defaultOutputName()),
    giftOnly: argv.includes('--gift-only')
  };
}

function buildCaptureRecord(message, receivedAt) {
  return { type: 'event', receivedAt, cmd: cleanText(message.cmd), data: message.data || {} };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --experimental-vm-modules --test test/capture-bilibili-events.test.js`

Expected: PASS.

### Task 2: Streaming Capture

**Files:**
- Modify: `scripts/capture-bilibili-events.js`
- Modify: `test/capture-bilibili-events.test.js`

**Interfaces:**
- Consumes: `BilibiliApiClient`, `WebSocketConnection`, and `packetParser.parseBilibiliPackets(buffer)`.
- Produces: NDJSON records `{ type: 'meta' | 'event' | 'summary', ... }`.

- [ ] **Step 1: Add the filter test**

```javascript
assert.equal(shouldCaptureMessage({ cmd: 'GUARD_BUY' }, true), true);
assert.equal(shouldCaptureMessage({ cmd: 'DANMU_MSG:4:0:2:2:2:0' }, true), false);
assert.equal(shouldCaptureMessage({ cmd: 'DANMU_MSG:4:0:2:2:2:0' }, false), true);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --experimental-vm-modules --test test/capture-bilibili-events.test.js`

Expected: FAIL because the filter does not exist.

- [ ] **Step 3: Stream events and close safely**

```javascript
connection.on('message', (buffer) => {
  for (const message of packetParser.parseBilibiliPackets(buffer)) {
    if (!shouldCaptureMessage(message, options.giftOnly)) continue;
    writer.write(`${JSON.stringify(buildCaptureRecord(message, new Date().toISOString()))}\n`);
    summary.commandCounts[message.cmd] = (summary.commandCounts[message.cmd] || 0) + 1;
  }
});
```

Use one idempotent shutdown function for duration expiry and `SIGINT`; it writes `summary`, closes the connection, and ends the output stream.

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --experimental-vm-modules --test test/capture-bilibili-events.test.js`

Expected: PASS.

### Task 3: Validate the Utility

**Files:**
- Modify: `scripts/capture-bilibili-events.js`
- Modify: `test/capture-bilibili-events.test.js`

**Interfaces:**
- Produces: help text for `--help`, and errors for a missing room or invalid duration.

- [ ] **Step 1: Add validation tests**

```javascript
assert.throws(() => parseArguments([], process.cwd()), /--room/);
assert.throws(() => parseArguments(['--room', '123', '--duration', '0'], process.cwd()), /duration/);
```

- [ ] **Step 2: Verify helpers and repository**

Run: `node --experimental-vm-modules --test test/capture-bilibili-events.test.js`, then `npm run check && npm test`.

Expected: every command exits with status 0.

- [ ] **Step 3: Commit**

Stage `scripts/capture-bilibili-events.js`, `test/capture-bilibili-events.test.js`, and this plan, then commit with subject `add Bilibili WebSocket event capture script`.
