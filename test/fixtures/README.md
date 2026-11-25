# Gift effect media fixture

`gift-effect-alpha.webm` is a synthetic, silent VP8 video used by
`gift-effect-media-probe.cjs`. It is 64 × 32 pixels and about 0.43 seconds long:
the left 32 × 32 region alternates between two red colors, and the right region
is white for the player's alpha mask. It contains no platform or user media.

The clip was recorded once with Electron 43.2.0 from eight canvas frames, using
`MediaStreamTrackGenerator`, `VideoFrame` and `MediaRecorder` with
`video/webm;codecs=vp8`. Frames were timestamped 60 ms apart. Electron decoded
the saved clip and verified its dimensions before it became a fixture.

Keep this input fixed: recording at test runtime intermittently returned a
110-byte clip that could not play. The test still uses the real player, decoder,
WebGL renderer, natural completion, context loss and disposal paths. Test
fixtures are not served as product assets or included in application packages.

`danmaku-canvas-editor.cjs` 和 `daily-bot-editor.cjs` 在独立临时目录和端口提供 `/admin`，通过正式 HTML 鉴权加载验收所需的管理页片段和样式。两者都使用真实 preload、桌面请求认证和对应业务 IPC。画布夹具用合成 license manager 保存测试草稿。各验收用例负责关闭进程和清理目录。
