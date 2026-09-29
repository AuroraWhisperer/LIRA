# QQ encrypted playback

**Status:** Superseded.

**复核日期：** 2026-09-28。旧实施安排由当前规格、后续实现记录和现状参考承接；不再按旧代码路径执行，也不把未勾选的历史验收补记为通过。

当前依据：[所属规格或参考](../../../docs/reference/backend/music/services.md)。状态索引见 [计划入口](../README.md)。

## 原始计划与执行记录

以下保留原计划时点的行为、命令和验证记录；它们不覆盖上述状态或当前契约，历史未勾选项不直接等同于当前缺陷。

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
