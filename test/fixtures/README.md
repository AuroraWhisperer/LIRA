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
