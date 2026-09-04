# Feature: 全屏随机弹幕

## Goal

在现有弹幕姬固定区域样式之外，提供一种全屏随机弹幕预设：每条消息在浏览器源的不同位置出现，显示发送者与正文，忽略大航海/灯牌身份，并按客户端设置的秒数自动消失。

## Context

当前 `/danmaku` 的四种历史样式以及上一版新增的 `outline` 都由共享 feed 在底部小区域按顺序堆叠。用户需要另一种行为型预设，而不是再增加一个固定区域皮肤；参考图表现为覆盖整屏的半透明消息块，消息没有等级徽章，位置不按队列排列。

## Requirements (EARS)

- While `danmakuOverlayStyle` is `outline`, when a new `danmaku:message` arrives, the overlay shall place the sender name and message at a bounded random position in the full viewport.
- While `danmakuOverlayStyle` is `outline`, the overlay shall not display avatar, guard label, medal name, or medal level, regardless of the message identity fields.
- While `danmakuOverlayStyle` is `outline`, each rendered message shall be removed after `danmakuFullscreenDurationSeconds` seconds.
- While an Admin user edits the fullscreen duration, when the value is saved, the server shall accept only an integer from 2 through 30 and broadcast the normal settings snapshot.
- While `bubble`, `signal`, `minimal`, or `ranked` is selected, the existing ordered feed layout and identity rendering shall remain unchanged.

## Architecture

### Frontend

- Admin keeps the existing `/danmaku` link and style preview, groups fixed-area choices separately from `全屏随机`, and shows an accessible numeric seconds control when fullscreen is selected.
- Overlay reads `danmakuOverlayStyle` and `danmakuFullscreenDurationSeconds` from the existing snapshot. The fullscreen renderer uses the existing safe DOM builder and an opt-in lifecycle/position mode; it never interpolates message HTML.
- Preview uses deterministic sample messages and deterministic/randomized-in-bounds placement suitable for visual inspection; live messages use the same bounded placement algorithm.

### Backend

- Add `danmakuFullscreenDurationSeconds: '6'` to `DEFAULT_SETTINGS`.
- Extend `POST /api/settings` normalization with a dedicated integer range check; the existing `outline` style allowlist entry remains unchanged.
- No database schema or new route is needed: the settings store initializes new default keys and the existing snapshot broadcast carries them to overlays.

### Security

- Existing Admin authentication/loopback and settings route remain the gate; no new public endpoint or privilege is introduced.
- Server validation rejects non-integer, out-of-range, or malformed duration values; client min/max attributes are usability only.
- Sender names/messages continue through `textContent`/node APIs. CSS variables are assigned from fixed internal values, never from user text.
- Timers are owned by the overlay renderer and cleared on replacement/style switch/destroy to avoid stale DOM or unbounded callbacks.

## Compatibility

- `signal` remains the default; `bubble`, `signal`, `minimal`, and `ranked` retain their existing keys and visuals. `outline` retains its key but intentionally changes from the mistaken fixed-region interpretation to the clarified full-screen behavior.
- Existing WebSocket event names and item fields remain unchanged.
- Existing game consumers of `createDanmakuFeed` receive the default ordered behavior because fullscreen mode is opt-in.
- Existing settings rows upgrade by default insertion; no destructive migration is required.

## Acceptance Criteria

1. Admin presents fixed-area styles as one group and `全屏随机` as a distinct full-screen option.
2. The fullscreen-only duration control persists valid seconds and rejects invalid values server-side.
3. Fullscreen items are visually distributed across the viewport, stay within bounds, and expire on time.
4. Fullscreen output contains sender and message only, with one neutral visual treatment regardless of guard/medal fields.
5. Existing fixed styles and tests continue to pass.

## Done When

The acceptance criteria and the plan's focused verification pass, and the final scoped diff contains no generated, secret, or unrelated changes.
