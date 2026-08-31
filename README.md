# LIRA

English | [简体中文](README.zh-CN.md)

**LIRA** (**L**ive **I**nteraction & **R**equest **A**ssistant) is a lightweight, local-first companion for Bilibili streamers, featuring danmaku song requests, queue and library management, live overlays, and more. Live interaction, playback, the song library, and the queue run primarily in the desktop client; first use requires online LIRA account/device authorization, with an optional cloud public playlist and playlist-page background. Viewers request songs via danmaku, requests are queued automatically, and the queue is shown on stream through an OBS browser source. Beyond song requests, it packs a danmaku bot, an AI chat assistant, a gift-driven overtime timer, and Quanmin K-Ge lyrics capture.

## Usage Declaration

This project is for personal learning, research, and reference only. Commercial use, modification, republishing, or resale without written permission from the author is strictly prohibited. See [LICENSE](LICENSE) for details.

## Installation

Download the latest installer from [Releases](https://github.com/AuroraWhisperer/LIRA/releases) and run it.

### First Launch and Server-Assisted Features

LIRA remains local-first, but the desktop client must complete online authorization before the main UI opens. Release builds use the production authorization service automatically (the current default is `https://api.lirahub.cn`); custom deployments use the address supplied by the administrator.

1. **Activate the first device.** On the “Log in to LIRA” page, enter the account name, password, and the one-time activation key supplied by the administrator, then choose “Activate and enter LIRA”. The server creates an independent device identity; the password and activation key are not stored locally.
2. **Later launches verify automatically.** A bound device does not require the account name, password, or first activation key again, but it still performs an online authorization check at startup. If the service is temporarily unreachable, use “Retry connection”. A revoked device/license or disabled account requires administrator assistance.
3. **Pair another computer.** Ask the server administrator to issue a one-time authorization code for the new device; the desktop client cannot create, view, or revoke these codes. On the new computer, enter the same account name, password, and the one-time code supplied by the administrator. Each computer gets its own device identity; pairing does not copy the local library, settings, Bilibili login, or music-platform login. Never copy the old computer's `data`, `userData`, private key, or token.
4. **Sync the public playlist manually.** In “Song requests → Import/Export”, “Cloud playlist” can publish a full snapshot of the local library to the public playlist page after confirmation. The current service accepts up to 5,000 songs, does not merge concurrent edits, and does not automatically restore the cloud snapshot to the local library. Unresolved edits from another computer or the web page may be overwritten by the next full sync. The same page manages a PNG/JPG/JPEG/WebP/GIF background image up to 5 MB; uploading replaces the latest image and deleting it restores the default background.

In the current client, the LIRA server handles account/device authorization, optional cloud data, and authoritative Bilibili gift detection. The desktop receives normalized gift events over the authenticated HTTPS device channel and projects them into its existing local history, statistics, overtime, and overlay flows. Bilibili login, danmaku, the queue, playback, and the local library remain in the local runtime. The public playlist URL usually looks like `https://account.lirahub.cn/`; use the URL shown by “Open web playlist” for the remote HTTPS song page. OBS and 直播姬 browser sources continue to use the local `127.0.0.1` URLs and require OBS/直播姬 and LIRA to run on the same computer.

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
- Check-in / fortune slip bot: `签到` auto-replies with streak days, `抽签` draws a daily fortune
- DIY keyword replies: custom keyword triggers with fixed responses

**AI Danmaku Assistant**

- Auto-generates replies via DeepSeek when "小米" is mentioned; personality and system prompt are customizable
- Supports web search, weather, route queries, auto-retry on failed delivery

**Song Queue Display**

- Two display styles: classic queue / transparent leaderboard identity
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
- Manual lyrics time offset (±1500ms)

**Songlist Display Board**

- Scrolling display of all requestable songs, 6 independent preset themes
- Sort by initial letter, category, artist, language, song name length

**Song Library Management**

- Add, edit, enable/disable, delete songs
- Search, category filter, language filter, artist filter

**Device Authorization and Cloud Playlist**

- First-device LIRA account authorization with online checks on later launches
- Server-administrator-issued one-time pairing codes for additional computers
- Explicit full-snapshot publishing from the local library to the public playlist page
- Custom public playlist-page background (PNG/JPG/JPEG/WebP/GIF, up to 5 MB)

**Overtime Timer**

- Gift-driven countdown: viewers extend the countdown with gifts, real-time OBS overlay
- Gift rule editor: direct time adjustment / random result draw / time mystery box
- The gift picker prefers the server-wide catalog with a local cache, while the existing room catalog and local gift search remain available as fallbacks

**Streamer Planner**

- Local streaming planner: organize work by today / this week / this month across song learning, stream prep, content publishing, and stream review — all data stays local

**Desktop Features**

- Frameless window, SVG icons, custom minimize/maximize/close buttons
- Auto-checks GitHub Releases for updates, one-click restart to upgrade
- One-click open data and log directories

## Documentation

- [Architecture Documentation](docs/architecture/README.md) — full architecture for backend / frontend / desktop / engineering
- [Changelog](UPDATE.md) — version change records
