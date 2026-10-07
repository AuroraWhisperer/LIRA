# 月渡花汀文楷

Source: [LXGW WenKai Light v1.522](https://github.com/lxgw/LxgwWenKai/releases/tag/v1.522),
`fonts/TTF/LXGWWenKai-Light.ttf`. Copyright LXGW and the Klee Project Authors;
licensed under SIL OFL 1.1, reproduced in [OFL.txt](OFL.txt).

Source SHA-256: `526ec70cbb0118e871d481f8179e03ff045f0e4d72d080dcca87950c4ab27cca`.

These WOFF2 subsets preserve all 46,490 source Unicode characters, including
simplified/traditional Chinese and kana. fontTools splits the sorted Unicode
cmap into consecutive groups of 2,048 characters (23 files); shaping closure
is retained. The largest file is 793,920 bytes, below the package's 1 MiB limit.
The matching ranges are declared in `public/css/lyrics/moonlit-font.css`.

The glyph drawings are unchanged. The subset's internal family is renamed to
`Lira Moon WenKai`; its CSS name is `月渡花汀文楷`. Light outlines are exposed as
weight 400 to use the existing desktop lyric controls' normal weight. Copyright
and license name records are retained. Fonts ship in the external Moonlit ZIP,
not the EXE, and require no network access or Windows font installation.
