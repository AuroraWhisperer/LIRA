# LIRA

English | [简体中文](README.zh-CN.md)

**LIRA** (**L**ive **I**nteraction & **R**equest **A**ssistant) is a lightweight, local-first companion for Bilibili streamers, featuring danmaku song requests, queue and library management, live overlays, and more — with no server or subscription required. It runs entirely on the streamer's computer: viewers request songs via danmaku, requests are queued automatically, and the queue is shown on stream through an OBS browser source. Beyond song requests, it packs a danmaku bot, an AI chat assistant, a gift-driven overtime timer, and Quanmin K-Ge lyrics capture.

## Usage Declaration

This project is for personal learning, research, and reference only. Commercial use, modification, republishing, or resale without written permission from the author is strictly prohibited. See [LICENSE](LICENSE) for details.

## Installation

Download the latest installer from [Releases](https://github.com/AuroraWhisperer/LIRA/releases) and run it.

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

**Overtime Timer**

- Gift-driven countdown: viewers extend the countdown with gifts, real-time OBS overlay
- Gift rule editor: direct time adjustment / random result draw / time mystery box

**Streamer Planner**

- Local streaming planner: organize work by today / this week / this month across song learning, stream prep, content publishing, and stream review — all data stays local

**Desktop Features**

- Frameless window, SVG icons, custom minimize/maximize/close buttons
- Auto-checks GitHub Releases for updates, one-click restart to upgrade
- One-click open data and log directories

## Documentation

- [Architecture Documentation](docs/architecture/README.md) — full architecture for backend / frontend / desktop / engineering
- [Changelog](UPDATE.md) — version change records
