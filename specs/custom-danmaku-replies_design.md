# Custom Danmaku Replies Design

## Assumptions

- DIY replies are simple keyword containment rules: if a danmaku contains the keyword, reply with the configured text.
- Built-in commands keep priority over DIY rules, so `点歌`, `随机`, `签到`, and `抽签` behavior is unchanged.
- Rules are stored in the existing settings key/value table as JSON, matching the blessing and fortune editors.
- Automatic replies are split into at most 40 visible grapheme characters; the first segment reserves the visible `@username ` prefix.

## Success Criteria

1. Users can enable/disable DIY replies and edit keyword/reply pairs from 百宝箱 -> 弹幕姬.
2. Server-side settings writes normalize DIY rules and limit rule count/text length.
3. A matched non-built-in danmaku produces an automatic reply targeted at the sender, split when needed without breaking emoji or symbols.
4. Existing 点歌, 签到, and 抽签 tests continue to pass.

## Security Notes

- API access already uses the existing session token gate for `/api/settings` and Bilibili routes.
- User-provided rule text is stored as plain JSON and rendered through DOM text/value APIs, not `innerHTML`.
- The server normalizes rule shape, drops incomplete entries, and caps rules at 30, keywords at 30 chars, replies at 120 chars.
