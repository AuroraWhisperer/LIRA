# LIRA

English | [简体中文](README.zh-CN.md)

**LIRA** (**L**ive **I**nteractive **R**oom **A**ssistant) is a lightweight, local-first companion for Bilibili streamers with danmaku song requests, queue and library management, live overlays, and more. Live interaction, playback, the song library, and the queue run primarily on the streamer's computer. First use requires online LIRA account and device authorization; optional cloud features include public playlist sync and a custom playlist-page background. Viewers request songs through danmaku, and requests automatically enter a queue that can be shown on stream through a browser source in OBS or Bilibili Livehime (哔哩哔哩直播姬). LIRA also includes a danmaku bot, an AI chat assistant, a gift-driven overtime timer, and lyrics capture from Quanmin K-Ge.

## Usage Terms

This project is for personal learning, research, and reference only. Commercial use, modification, republishing, or resale without written permission from the author is strictly prohibited. See [LICENSE](LICENSE) for details.

## Installation

Download the latest installer from [Releases](https://github.com/AuroraWhisperer/LIRA/releases) and run it.

### First Launch and Server-Assisted Features

LIRA remains local-first, but the desktop client must complete online authorization before the main UI opens. Release builds use the LIRA authorization service automatically (the current default is `https://api.lirahub.cn`); custom deployments use the address supplied by the administrator.

1. **Register on first use.** Choose “Register a new account” (注册新账号), enter the username, password, and administrator-issued registration activation code, then choose “Register and enter” (注册并进入). Existing users choose “Log in to an existing account” (登录已有账号). The server creates an independent device identity; the password and activation code are not stored locally.
2. **Later launches verify automatically.** A bound device does not require the account name, password, or registration activation code again, but it still performs an online authorization check at startup. If the service is temporarily unreachable, use “Retry connection”. A revoked device/license or disabled account requires administrator assistance.
3. **Log in on another computer.** Ask the administrator for a one-time short-lived login code (短效登录码). On the new computer, choose “Log in to an existing account”, enter the original username, password, and login code, then choose “Log in and enter” (登录并进入). Each computer gets an independent device identity. After authorization, cloud sync can restore supported shared songs and settings; local files, device identity, and music-platform sessions do not migrate automatically. Never copy the old computer's `data`, `userData`, private key, or token.
4. **Cloud playlist sync is automatic.** Local library changes mark the song scope dirty and upload a full snapshot after authorization. When no local upload is pending, the client pulls newer cloud revisions. “Song requests → Import/Export” also supports a manual full sync. The service accepts up to 5,000 songs. Synchronization uses full snapshots and does not merge concurrent edits from multiple computers. The same page manages a PNG/JPG/JPEG/WebP/GIF background up to 5 MB; uploading replaces the image and deleting restores the default.

In the current client, the LIRA server handles account/device authorization, optional cloud data, and authoritative Bilibili gift detection. The desktop client receives normalized gift events through the authenticated HTTPS device channel and projects them into local history, statistics, overtime, and overlay flows. Bilibili login, local danmaku interactions, the queue, playback, and the local library still run locally. The server danmaku overlay receives and displays Bilibili chat independently.

These features use different URLs:

- **Public playlist:** Usually `https://<account>.lirahub.cn/`. Use the URL shown by “View web playlist” (查看网页歌单) for the remote HTTPS song page.
- **Local overlays:** The song queue, lyrics, overtime timer, and other local overlays use `127.0.0.1` URLs. LIRA and the streaming software must run on the same computer.
- **Server danmaku overlay:** Use the complete HTTPS `/overlay/<token>` URL copied from LIRA or the streamer console. It depends on the server’s Bilibili connection and continues to work when the desktop client is closed.

Both OBS and Bilibili Livehime can load local overlays and the server danmaku overlay.

### Remote Server Address

By default, the desktop client connects to `https://api.lirahub.cn`. Maintainers can override this with `LIRA_LICENSE_API_BASE`, but the value must be an HTTPS root origin with a DNS hostname (for example, `https://api.example.com`). It must not contain credentials, a subpath, query parameters, or a fragment; HTTP, `localhost`, and IPv4/IPv6 literals are rejected. The same address is used for the device API and the server's gift catalog for the overtime timer. The catalog is cached locally at `data/cache/overtime-gift-catalog-v2.json`, and the last snapshot remains available during short network outages.

Changing the remote server address does not change the `127.0.0.1` URLs used by local overlays. The server danmaku overlay uses the complete URL returned by the server. When adding a browser source, use the URL copied from the corresponding feature.

## Key Features

**Song Requests**

- `点歌 晴天` — request a song via danmaku, with fuzzy matching
- `随机点歌` — random pick from the library, filterable by artist, category, language
- `取消点歌` / `取消点歌 晴天` — cancel your latest queued request, or your latest request with that full title; other viewers' songs stay in place
- Manual queue management: add, skip, pin, clear
- Floating notification on successful request

**Danmaku Monitoring**

- Real-time Bilibili public danmaku WebSocket with history compensation
- Dedicated Super Chat (SC) queue, sorted by amount
- Gift sprint tracking: target amount, collected stats, crystal ball conversion

**Danmaku Interaction**

- Danmaku bot: posts in the live room with a logged-in account and automatically mentions recent requesters
- Check-in / fortune slip bot: `签到` replies with the viewer's cumulative check-in days, and `抽签` draws a daily fortune
- Custom keyword replies: trigger fixed responses when a message contains a keyword
- Exact-match replies: trigger only when the entire message matches, with a built-in `菜单` command listing available interactions
- Scheduled danmaku: sends messages from cloud libraries at fixed or random intervals, in sequence or randomly, only while the stream is live

**AI Danmaku Assistant**

- Generates replies when danmaku contains a saved trigger keyword; the keyword is empty by default, so the assistant does not reply until one is configured
- Supports DeepSeek, Kimi / Moonshot, OpenAI, Claude, Gemini, Doubao account login (experimental), and custom OpenAI-compatible services; persona packs can be selected, saved, and imported
- Basic chat requires no tool accounts. Search, weather, places, and routes are off by default; enable them according to model support and configured credentials. See the [AI configuration guide](docs/guides/third-party-api-support.md)

**Song Queue Display**

- Six display styles: classic, identity leaderboard, storybook, neon vinyl, cherry ribbon, and golden lily
- Loop or back-and-forth scrolling with adjustable speed
- 11 preset themes, plus customizable colors, transparency, font size, border radius, font family, and font weight
- Glassmorphism, gradient backgrounds, adjustable glow, and a low-resource mode

**Music Player**

- Built-in player with NetEase Cloud Music and QQ Music search and playback
- Playback queue popup: highlights the current song, dims played songs, and lets you click any row to jump to it
- Playback history and playlist looping
- Right drawer: daily recommendations, favorites, and playlist browsing, with play-all and shuffle controls
- Desktop lyrics, volume control, and player docking/expansion

**Quanmin K-Ge Lyrics Capture**

- A third playback source on the player page: reads the current song, playback position, and word-by-word lyrics from the local Quanmin K-Ge client, then follows playback and syncs the desktop lyrics
- Local QRC cache with automatic fallback to QQ Music or NetEase Cloud Music lyrics when local lyrics are missing
- Manual lyrics timing offset (±3000 ms)

**Songlist Display Board**

- Scrolling display of all requestable songs, 6 independent preset themes
- Sort by initial letter, category, artist, language, song name length

**Song Library Management**

- Add, edit, enable/disable, delete songs
- Search, category filter, language filter, artist filter

**Device Authorization and Cloud Playlist**

- First-device LIRA account authorization with online checks on later launches
- Administrator-issued one-time short-lived login codes for additional computers
- Automatic full-snapshot cloud sync after library changes, with newer cloud revisions restored when no local upload is pending; manual sync is also available
- Custom public playlist-page background (PNG/JPG/JPEG/WebP/GIF, up to 5 MB)

**Overtime Timer**

- Gift-driven countdown: viewers extend the timer with gifts, and a real-time overlay shows the remaining time in OBS or Bilibili Livehime
- Gift rules: adjust the timer directly, draw a random result, or display text
- The gift picker prefers the server-wide catalog with a local cache, while the existing room catalog and local gift search remain available as fallbacks

**Streamer Planner**

- A local workbench with calendar events; pre-stream, live, and post-stream tasks; notes; promises to viewers; and reviews. The v3 model migrates older planner data

**Desktop Features**

- Frameless window with SVG icons and custom minimize, maximize, and close buttons
- Automatically checks GitHub Releases for updates; restart with one click to install an update
- Open the data and log directories with one click

## Documentation

- [Documentation index](docs/README.md) — architecture, technical references, user guides, specifications, and reports
- [Architecture](docs/architecture/README.md) — backend, frontend, desktop, and engineering boundaries
- [Changelog](UPDATE.md) — version history
