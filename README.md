# LIRA

English | [简体中文](README.zh-CN.md)

**LIRA** (**L**ive **I**nteractive **R**oom **A**ssistant) is a lightweight, local-first companion for Bilibili streamers, featuring danmaku song requests, queue and library management, live overlays, and more. Live interaction, playback, the song library, and the queue run primarily in the desktop client; first use requires online LIRA account/device authorization, with an optional cloud public playlist and playlist-page background. Viewers request songs via danmaku, requests are queued automatically, and the queue is shown on stream through a browser source in OBS or Bilibili Livehime (哔哩哔哩直播姬). Beyond song requests, it packs a danmaku bot, an AI chat assistant, a gift-driven overtime timer, and Quanmin K-Ge lyrics capture.

## Usage Declaration

This project is for personal learning, research, and reference only. Commercial use, modification, republishing, or resale without written permission from the author is strictly prohibited. See [LICENSE](LICENSE) for details.

## Installation

Download the latest installer from [Releases](https://github.com/AuroraWhisperer/LIRA/releases) and run it.

### First Launch and Server-Assisted Features

LIRA remains local-first, but the desktop client must complete online authorization before the main UI opens. Release builds use the production authorization service automatically (the current default is `https://api.lirahub.cn`); custom deployments use the address supplied by the administrator.

1. **Register on first use.** Choose “Register a new account” (注册新账号), enter the username, password, and administrator-issued registration activation code, then choose “Register and enter” (注册并进入). Existing users choose “Log in to an existing account” (登录已有账号). The server creates an independent device identity; the password and activation code are not stored locally.
2. **Later launches verify automatically.** A bound device does not require the account name, password, or registration activation code again, but it still performs an online authorization check at startup. If the service is temporarily unreachable, use “Retry connection”. A revoked device/license or disabled account requires administrator assistance.
3. **Log in on another computer.** Ask the administrator for a one-time short-lived login code (短效登录码). On the new computer, choose “Log in to an existing account”, enter the original username, password, and login code, then choose “Log in and enter” (登录并进入). Each computer gets an independent device identity. After authorization, cloud sync can restore supported shared songs and settings; local files, device identity, and music-platform sessions do not migrate automatically. Never copy the old computer's `data`, `userData`, private key, or token.
4. **Cloud playlist sync is automatic.** Local library changes mark the song scope dirty and upload a full snapshot after authorization. When no local upload is pending, the client pulls newer cloud revisions. “Song requests → Import/Export” also supports a manual full sync. The service accepts up to 5,000 songs; snapshots do not merge concurrent edits. The same page manages a PNG/JPG/JPEG/WebP/GIF background up to 5 MB; uploading replaces the image and deleting restores the default.

In the current client, the LIRA server handles account/device authorization, optional cloud data, and authoritative Bilibili gift detection. The desktop receives normalized gift events over the authenticated HTTPS device channel and projects them into its existing local history, statistics, overtime, and overlay flows. Bilibili login, local danmaku interactions, the queue, playback, and the local library remain in the local runtime; the server danmaku overlay receives and displays Bilibili chat independently. The public playlist URL usually looks like `https://account.lirahub.cn/`; use the URL shown by “View web playlist” (查看网页歌单) for the remote HTTPS song page. Both OBS and Bilibili Livehime can load LIRA overlays. Local overlays such as the song queue, lyrics, and overtime timer use `127.0.0.1` URLs and require LIRA and the streaming software to run on the same computer. The server danmaku overlay uses the complete HTTPS `/overlay/<token>` URL copied from LIRA or the streamer console; it depends on the server’s Bilibili connection and continues to work when the desktop client is closed. The public playlist, local overlays, and server danmaku overlay have separate URLs.

## Key Features

**Song Requests**

- `点歌 晴天` — request a song via danmaku, with fuzzy matching
- `随机点歌` — random pick from the library, filterable by artist, category, language
- Manual queue management: add, skip, pin, clear
- Floating notification on successful request

**Danmaku Monitoring**

- Real-time Bilibili public danmaku WebSocket with history compensation
- Dedicated Super Chat (SC) queue, sorted by amount
- Gift sprint tracking: target amount, collected stats, crystal ball conversion

**Danmaku Interaction**

- Danmaku bot: posts in the live room with a logged-in account, auto-mentions recent requesters
- Check-in / fortune slip bot: `签到` auto-replies with cumulative check-in days, `抽签` draws a daily fortune
- DIY keyword replies: custom keyword triggers with fixed responses

**AI Danmaku Assistant**

- Generates replies when danmaku contains a saved custom trigger keyword; the keyword is empty by default, so no replies are triggered
- Supports DeepSeek, OpenAI, Claude / Gemini compatibility endpoints, and custom compatible services, with selectable, saved, and imported persona packs
- Ordinary chat needs no tool accounts. Search, weather, places, and routes are off by default; enable them according to model support and configured credentials. See the [AI configuration guide](docs/guides/third-party-api-support.md)

**Song Queue Display**

- Six display styles: classic, identity leaderboard, storybook, neon vinyl, cherry ribbon, and golden lily
- Loop or bounce scrolling with adjustable speed
- 11 preset themes + customizable colors, transparency, font size, border radius, font family, weight
- Glass morphism, gradient background, glow intensity, low resource mode

**Music Player**

- Built-in player with NetEase Cloud Music and QQ Music search & playback
- Playback queue popup: current song highlighted, played songs dimmed, click any row to jump
- Playback history, playlist loop playback
- Right drawer panel: daily recommendations, favorites, playlist browser, play all / shuffle
- Desktop lyrics, volume control, player docking/expansion

**Quanmin K-Ge Lyrics Capture**

- Third playback source on the player page: reads current song, progress, and word-by-word lyrics from the local Quanmin K-Ge client, auto-follows playback and syncs desktop lyrics
- Local QRC cache, auto-fallback to QQ Music / NetEase Cloud online lyrics when missing
- Manual lyrics time offset (±3000ms)

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

- Gift-driven countdown: viewers extend the countdown with gifts, real-time overlay in OBS or Bilibili Livehime
- Gift rule editor: direct time adjustment / random result draw / text display board
- The gift picker prefers the server-wide catalog with a local cache, while the existing room catalog and local gift search remain available as fallbacks

**Streamer Planner**

- Local streamer workbench: dated calendar events, before / live / after tasks, ideas, viewer promises, and reviews; the v3 model migrates older planner data

**Desktop Features**

- Frameless window, SVG icons, custom minimize/maximize/close buttons
- Auto-checks GitHub Releases for updates, one-click restart to upgrade
- One-click open data and log directories

## Documentation

- [Architecture Documentation](docs/architecture/README.md) — full architecture for backend / frontend / desktop / engineering
- [Changelog](UPDATE.md) — version change records
