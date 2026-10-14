# 歌词自动补字资源

这些字体不作为用户选项出现。歌词设置只选择风格，预览、画布和直播输出由同一字体链自动补字。

全部来自 [Google Fonts](https://github.com/google/fonts/tree/e9678a5385322c63730122ba464765baad83cfd8) 的固定版本，按 SIL Open Font License 1.1 随应用分发；每个字体的原始许可保存在同目录。

仅用 fontTools 将完整上游 TTF 压缩成 WOFF2，没有裁剪字符、改名字或改字形；cmap、GSUB、GPOS、GDEF、name 和 fvar 与源文件逐表校验一致。可变字重保留原始范围。

`css/lyrics/font-fallbacks.css` 使用 `unicode-range` 按文字加载资源，不依赖运行时外网。`Lira Lyric Scripts` 优先为连写与组合文字提供完整字形；`Lira Lyric Korean` 在所选字体之后补充韩文，`Lira Lyric Extended` 在小赖字体之后补充其他字母。韩文使用独立字体族，确保单字重与可变字体在加粗时都能参与补字。其余缺字仍由系统字体处理，不宣称覆盖全部 Unicode 或所有历史文字。

歌词字体链与兼容行为见[直播歌词合同](../../../docs/reference/frontend/overlays.md#6-直播歌词页lyrics)；风格字体见[播放器与直播歌词字体](../player/README.md)。

| 文件 | 文字范围 | 上游文件 / 许可 | Unicode 码点数 |
| --- | --- | --- | --- |
| `notosans.woff2` | Latin / Greek / Cyrillic / Vietnamese | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf) / [OFL](notosans-OFL.txt) | 3,094 |
| `gowundodum.woff2` | Korean | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/gowundodum/GowunDodum-Regular.ttf) / [OFL](gowundodum-OFL.txt) | 12,494 |
| `notosansarmenian.woff2` | Armenian | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosansarmenian/NotoSansArmenian%5Bwdth%2Cwght%5D.ttf) / [OFL](notosansarmenian-OFL.txt) | 430 |
| `notosansgeorgian.woff2` | Georgian | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosansgeorgian/NotoSansGeorgian%5Bwdth%2Cwght%5D.ttf) / [OFL](notosansgeorgian-OFL.txt) | 509 |
| `notosansethiopic.woff2` | Ethiopic | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosansethiopic/NotoSansEthiopic%5Bwdth%2Cwght%5D.ttf) / [OFL](notosansethiopic-OFL.txt) | 860 |
| `notosansarabic.woff2` | Arabic / Persian / Urdu | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosansarabic/NotoSansArabic%5Bwdth%2Cwght%5D.ttf) / [OFL](notosansarabic-OFL.txt) | 1,561 |
| `notosanshebrew.woff2` | Hebrew | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosanshebrew/NotoSansHebrew%5Bwdth%2Cwght%5D.ttf) / [OFL](notosanshebrew-OFL.txt) | 464 |
| `notosansdevanagari.woff2` | Devanagari | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosansdevanagari/NotoSansDevanagari%5Bwdth%2Cwght%5D.ttf) / [OFL](notosansdevanagari-OFL.txt) | 551 |
| `notosansbengali.woff2` | Bengali | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosansbengali/NotoSansBengali%5Bwdth%2Cwght%5D.ttf) / [OFL](notosansbengali-OFL.txt) | 444 |
| `notosansgurmukhi.woff2` | Gurmukhi | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosansgurmukhi/NotoSansGurmukhi%5Bwdth%2Cwght%5D.ttf) / [OFL](notosansgurmukhi-OFL.txt) | 436 |
| `notosansgujarati.woff2` | Gujarati | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosansgujarati/NotoSansGujarati%5Bwdth%2Cwght%5D.ttf) / [OFL](notosansgujarati-OFL.txt) | 442 |
| `notosansoriya.woff2` | Odia | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosansoriya/NotoSansOriya%5Bwdth%2Cwght%5D.ttf) / [OFL](notosansoriya-OFL.txt) | 423 |
| `notosanstamil.woff2` | Tamil | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosanstamil/NotoSansTamil%5Bwdth%2Cwght%5D.ttf) / [OFL](notosanstamil-OFL.txt) | 428 |
| `notosanstelugu.woff2` | Telugu | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosanstelugu/NotoSansTelugu%5Bwdth%2Cwght%5D.ttf) / [OFL](notosanstelugu-OFL.txt) | 444 |
| `notosanskannada.woff2` | Kannada | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosanskannada/NotoSansKannada%5Bwdth%2Cwght%5D.ttf) / [OFL](notosanskannada-OFL.txt) | 436 |
| `notosansmalayalam.woff2` | Malayalam | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosansmalayalam/NotoSansMalayalam%5Bwdth%2Cwght%5D.ttf) / [OFL](notosansmalayalam-OFL.txt) | 467 |
| `notosanssinhala.woff2` | Sinhala | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosanssinhala/NotoSansSinhala%5Bwdth%2Cwght%5D.ttf) / [OFL](notosanssinhala-OFL.txt) | 453 |
| `notosansthai.woff2` | Thai | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosansthai/NotoSansThai%5Bwdth%2Cwght%5D.ttf) / [OFL](notosansthai-OFL.txt) | 426 |
| `notosanslao.woff2` | Lao | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosanslao/NotoSansLao%5Bwdth%2Cwght%5D.ttf) / [OFL](notosanslao-OFL.txt) | 421 |
| `notoseriftibetan.woff2` | Tibetan | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notoseriftibetan/NotoSerifTibetan%5Bwght%5D.ttf) / [OFL](notoseriftibetan-OFL.txt) | 552 |
| `notosansmyanmar.woff2` | Myanmar | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosansmyanmar/NotoSansMyanmar%5Bwdth%2Cwght%5D.ttf) / [OFL](notosansmyanmar-OFL.txt) | 564 |
| `notosanskhmer.woff2` | Khmer | [上游](https://github.com/google/fonts/blob/e9678a5385322c63730122ba464765baad83cfd8/ofl/notosanskhmer/NotoSansKhmer%5Bwdth%2Cwght%5D.ttf) / [OFL](notosanskhmer-OFL.txt) | 483 |

## SHA-256

| 文件 | 原始 TTF | WOFF2 |
| --- | --- | --- |
| `notosans` | `bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d` | `53208f9765e482324820264bba9f20d66e95de569d3acbe65aeb4e05fa0aa40e` |
| `gowundodum` | `a6e457933227483a11758fd0947bc74422a106d46f0bf057fdaa5af94a30067d` | `d592c6efb811af0a573ebcb96772d21b7c0627da5dfc54f9507012016bbfd6d8` |
| `notosansarmenian` | `0870908d8318435a5daf1cd280ae15063f990cd9ad60f3e94c734ce9e1ffef71` | `b1d1348e69aa3b5e5fc809035fec387d8f4278b34ebd2fdc01f3635ae27b48e2` |
| `notosansgeorgian` | `dc591156f36842d38996c4a7a17fee9bb58e45da3e2cac7a31b7d33de700adb9` | `1f817650b64e10329a067ea8940c8bb620fd726f42791ed1e360d05e38ea2ce9` |
| `notosansethiopic` | `0dbccc00b22d180ebd6a4bd8a733918a29e709fa6798023adc3e6cd40da65077` | `d6541a57946ddb65ffd3a5408a1b3c40cda0d91d156a1fe43ff3cf6cec9e9870` |
| `notosansarabic` | `63111b5b2e074dd48cc67692e0a2726d86ee94c1c37fe8598257b7b4e87e869e` | `0f7be8450855fa4161cbe008cfb278656f5cb1ee655358de7386156d35458112` |
| `notosanshebrew` | `7ef36a2c3593758cdb622e1bdef4f84523e92fbc3ccc667438dd80ff54c2de88` | `e0cf41f0b3eaefb34086adf235245e475a5eeb53a7c3cff363570932ec1f89a1` |
| `notosansdevanagari` | `14ec4af41f27482216d1c2229f417ff9b1425e1babb014e57d1d40d03229853e` | `63c47e0e3412d9dd6f52f57cde45e6bb1b52837ea2a7f7272ebaadf0e23ccfa0` |
| `notosansbengali` | `dcd42978094e584a849c84a51450eeac40c8826057d566ea6d4b9627a403a05a` | `a700833ffb2216b50a56f58eb42fe241c343a53dbaae6f9993ef78177eb8d940` |
| `notosansgurmukhi` | `1e6f728fa620e566f842d81e220265813faa12771214765d289c98e035adc5f2` | `6029b3b661c568b11652be47f8bbaeae4f4368407d5a707bce6f7e3aebe166d1` |
| `notosansgujarati` | `9901d8552f1dd5d2c50dbd4caa6f6e174e74e8264f06594ab259ae6e7b1ac428` | `a6055153c8926c938b27ec012d9b26375cc6fcf321b54e32d8e3c1274e510e16` |
| `notosansoriya` | `910342275d619081b896b4ed25fd9ad6ff320c25591b810de1fcc4beb153ba82` | `192ce7c2e7f15d1cbe78cde18b7dbe013a2a2671c235e03053734dda0e6b0653` |
| `notosanstamil` | `aa3a9b321f4b0bb2c40203ffbde9af89713227866e0e13f76e5b9eeea727cf88` | `2c3a02462cb6ff75a2848cd076200e5541c7f7d92a60259abdfa907c15ddd99f` |
| `notosanstelugu` | `e618af7bf999df192ed4f388eba2e563f2b5015034e9cbb317b5bd793bd7334d` | `1475236834b1558762ac41c8636152ff201ccdcec6371a230ab5a3e85bca0fb5` |
| `notosanskannada` | `cca4f3b3a8cb12fb261f1b43baf5d2f7f59d90fe123d41f0065ed3a183997ec9` | `4117e9360436698805e81359467f33fb45ef0c6313b638a348207411aedeb7fc` |
| `notosansmalayalam` | `312e0e7c3cc15fa09eb42a8f749eeb246b593ed420e3c81aafe8d910c3a6fb56` | `ab11b832baec51eaa2101a8cf00c5c45665eaa2bc238690078d6c04e381a1a29` |
| `notosanssinhala` | `9bd93e407a278075be403324063bc94a7e306c44de4df81214e932330c22eecf` | `c97a203b08d547ba98da2e34ee8f7a5156135d374bd955b55aa1282c37b82975` |
| `notosansthai` | `5a1c559bb539583c8a1fd99d1c5b9491e5e14478c9cd2bd0970d5c3096cc9ef8` | `61b98de8f43336734d88c62574fe4b707342650b86b94bb04e873afa0f70db7a` |
| `notosanslao` | `9608b94603a82d09a8038946f9775242f99e3b3459b7f1e4d5b335b578cd7ab3` | `ee500590331d9a5f97163474bf1cede0ce28320ff94872f3fa2adc11183d1eb2` |
| `notoseriftibetan` | `060ec022b04c306de3f58d051fb0e1cf81a5b610c5910fbfc43bba154c057cda` | `16749cdd3898b00edd3ae307aac5d268dd7ae9d250816f0179ff9120b9e8e537` |
| `notosansmyanmar` | `7abbbfbe2514105d7ce94937aee3feb2ba89b73a256c8b77b5866bd9b83e32ec` | `92d61bb15f407b2589dd8e8e7cff913319743025992b7b5624cd4f8c0a5d3478` |
| `notosanskhmer` | `f37a8431a0c5d5ed2f81a767417546aca576a81fb7eff9c924d46aecf828f2ca` | `4b2ee178e4c0057890572b4cfbc4b73de5cf72e02edc0a61d7bd35bca184ef7e` |
