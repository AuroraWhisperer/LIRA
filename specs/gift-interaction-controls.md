# Feature: Cloud gift interaction controls

## Goal and requirements

The Electron gift page exposes independent `giftAutoThanksEnabled` and
`giftStatsQueryEnabled` controls. Both default to false until the server confirms
otherwise. Thanks includes paid and confirmed free gifts, excluding SC; query
uses the paid ledger. Login never enables either feature. Electron exit does
not stop the cloud process.

## Architecture and compatibility

The existing cloud controller serializes explicit `{key, enabled}` intents with
other settings writes. It merges each intent into the current account's complete
base settings, through the existing Device `PUT /api/device/cloud-settings`.
Untouched flags are omitted and preserved server-side, including ordinary local
settings uploads. There is no fourth sync scope or new HTTP endpoint. Whole
settings writes retain the server's last-successful-write semantics; no version
conflict merge is promised.

The server remains authoritative for cloud Bilibili login validity and account,
room and authorization races. Confirmed cloud preferences live only in main
memory, are reloaded after restart and never seed another account. No local
settings key or SQLite migration is added. Bilibili unlink, changed sending UID
or room resets both flags server-side; a same-UID refresh may preserve them.

## Security and IPC

The renderer sends only the flag name and exact boolean. Main checks the current
main window, exact main frame and desktop origin. The response and event contain
only two booleans, `confirmed`/`pending`/`unconfirmed`, an error code and `ok`.
No Cookie, CSRF, token, account identity or upstream response body is exposed.
The canonical IPC registry is [preload](../docs/architecture/desktop/preload.md).

## Acceptance criteria

- All four combinations are independent. Clicking sends the explicit target,
  never a remote toggle operation. A repeated in-flight submission is rejected.
- The visual checkmark remains the last server-confirmed value while saving;
  both controls temporarily disable during submission only.
- Logged-out controls stay clickable. Server `BILIBILI_LOGIN_REQUIRED` says
  “请先登录 B 站，再同步到服务器。”; invalid credentials/account mismatch says
  “B 站登录已失效，请重新登录并同步。”; temporary verification failure says
  “B 站登录验证超时，请稍后再试。”
- Failed or lost responses do not show success. Unconfirmed disable says
  “关闭还没同步，服务器可能仍在运行。” A visible refresh, online event and
  existing cloud event/poll reconciliation can recover confirmed values.
- Account changes discard the old display immediately. Late prior-account
  operations cannot apply results; renderer change replies also preserve newer,
  incompatible confirmed/unconfirmed state events. Remote resets update both controls.
- Closing the page removes its listeners; Electron shutdown unregisters IPC,
  aborts cloud work and drains the existing controller before closing runtime.
- In browser-only mode the desktop controls are hidden.

## Verification

`test/gift-interaction-controls.test.js` exercises controller, IPC and renderer
contracts with synthetic cloud responses and no real credentials. Existing cloud
sync/isolation and Electron shutdown tests protect surrounding behavior. Real
upstream login, live sending and the server's own reset/gate implementation are
verified in the server repository, not inferred from these client mocks.
