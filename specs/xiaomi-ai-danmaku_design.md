# Feature: 小米 AI 弹幕助手

## Requirements (EARS Format)

- While the AI assistant is enabled and configured, when a live danmaku contains the trigger word `小米`, the system shall submit the viewer's question to the AI workflow.
- While several viewers are waiting, when AI requests are processed, the system shall allow bounded parallel generation but shall send complete replies in original receive order.
- When a reply exceeds one Bilibili danmaku, the system shall split it so every emitted danmaku, including `@用户名 `, contains no more than 40 Unicode characters.
- When a question depends on current public information, weather, places, routes, or time, the system shall use the matching enabled tool instead of inventing an answer.
- When input or output is unsafe, the system shall avoid external tools for rejected input and shall emit only the approved short refusal or sanitized text.
- When a secret is saved, the system shall encrypt it at rest and shall never return its plaintext value to the browser or write it to logs.
- When an upstream request fails or times out, the system shall return a short, explicit fallback and shall continue processing later viewers.
- When a location is ambiguous, the system shall ask the viewer to clarify instead of silently choosing a place.

## Architecture

### Frontend

- Add a compact `小米 AI` section immediately after the manual danmaku composer.
- Keep credential and endpoint inputs blank until the operator enters values. Saved secrets are represented only by `已保存`; they are never refilled into the DOM.
- Validate URLs, numeric limits, trigger text, and response length before submitting.
- Show enabled/disabled, configuration readiness, queue depth, and last error without exposing request bodies or credentials.
- Reuse the current admin palette and form controls. The distinctive element is a small cat-ear status badge tied to the live queue state; the rest remains visually quiet.

### Backend

- `src/ai/config-store.js`: SQLite persistence for non-secret options, encrypted secret blobs, blacklist, request logs, usage counters, and short-lived viewer context/cache.
- `src/ai/secret-codec.js`: encryption boundary backed by Electron `safeStorage`; tests inject a deterministic codec.
- `src/ai/deepseek-client.js`: Responses API transport, response parsing, hosted `web_search` declaration, timeouts, and usage extraction.
- `src/ai/tools/`: QWeather, AMap, and local-time adapters with normalized results.
- `src/ai/prompt.js`: fixed cat persona, routing rules, and tool schemas.
- `src/ai/safety.js`: local blocklist/prompt-injection guard plus structured model input/output review.
- `src/ai/xiaomi-ai-service.js`: trigger parsing, per-user/global limits, cache/context, bounded generation, tool loop, and FIFO delivery coordinator.
- `src/server/routes/ai-routes.js`: token-protected read/update/test/status endpoints with strict allowlists.
- The existing danmaku sender gains an opt-in `mentionEveryChunk` mode; all existing callers retain current behavior.

### Security

- Existing session-token authentication protects all AI administration endpoints.
- Server-side validation is authoritative; client validation is convenience only.
- API responses expose `hasDeepSeekApiKey`, `hasQWeatherApiKey`, and `hasAmapApiKey` booleans, never secret values.
- Electron `safeStorage` encrypts secrets. If OS encryption is unavailable, saving a non-empty secret fails clearly instead of writing plaintext.
- SQL writes use bound parameters. Logs record category, latency, token counts, and redacted errors only.
- Per-user and room-wide rate limits, request timeout, maximum tool-call count, maximum output length, queue capacity, and send interval are enforced server-side.
- Text is rendered with `textContent`; no model or tool output enters `innerHTML`.
- The feature implements platform-compliant rate control, not platform-detection evasion.

## Defaults and Data Flow

- Trigger: `小米`
- Model: `ds-v4-flash`
- Reasoning: disabled through the provider request option supported by the configured Responses-compatible endpoint.
- Hosted Web Search: enabled.
- Total generated reply ceiling: 50 characters before mention-aware splitting. Greetings and simple replies should contain about 18–22 Chinese text characters, followed optionally by punctuation or one short emoticon; factual tool answers may grow when necessary.
- Bilibili message limit: 40 Unicode characters including the visible mention.
- Generation concurrency: 3; delivery concurrency: 1.
- Send interval: 3000 ms; per-user cooldown: 30 seconds; room limit: 20 requests/minute.
- Maximum tool calls: 4; upstream timeout: 12 seconds; cache TTL: 60 seconds; viewer context TTL: 20 minutes.

```text
danmaku -> trigger/rate/safety -> generation slot -> DeepSeek
                                             <-> hosted web search
                                             <-> QWeather / AMap / local time
        -> completed reply held by sequence -> FIFO delivery -> mention-aware chunks
```

## Acceptance Tests

- Unit tests cover trigger removal, input rejection, per-user and global limits, cache reuse, bounded parallel generation, FIFO delivery, timeouts, tool routing, tool result normalization, and secret redaction.
- Sender tests prove every AI chunk repeats the mention and remains within 40 characters without changing legacy reply splitting.
- Route tests prove invalid configuration is rejected and secret values cannot be read back.
- Frontend regression tests prove the section appears after the sender, defaults are rendered, save/test actions exist, and no secret is injected into page markup.
- `npm run check` and `npm test` pass.

## Out of Scope

- No attempt is made to bypass Bilibili automation or AI detection.
- No dedicated finance, sports, transport, or events provider is added; those use hosted Web Search with source caveats.
- Precise nearby search requires a user-provided location; the service does not infer private device coordinates.
