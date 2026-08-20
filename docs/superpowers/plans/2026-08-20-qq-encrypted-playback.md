# QQ encrypted playback

## Goal

Add a bounded, server-side QMC2 playback path for QQ Music EVkey media while
keeping the existing Standard/HQ/SQ contract and explicitly falling back when
Electron cannot decode a returned container or spatial/Dolby DSP is required.

## Tasks

1. Add the audited QMC2 runtime dependency and a small decrypting stream helper.
   - Verify arbitrary HTTP Range offsets decrypt to the same bytes as a
     contiguous request.
2. Extend QQ provider resolution with EVkey Q0/O8 candidates and short-lived,
   server-memory stream records. Never return ekeys to the renderer.
3. Add an authenticated local HTTP Range proxy route that decrypts QMC2 bytes
   on demand and returns FLAC/Ogg media headers.
4. Expose experimental QQ premium quality choices in the existing playback
   selector, preserving normal fallback semantics and labeling spatial/Dolby
   limitations honestly.
5. Add focused provider/proxy tests and update the owning architecture docs.
6. Run focused tests, syntax/architecture gates, and review the diff.
