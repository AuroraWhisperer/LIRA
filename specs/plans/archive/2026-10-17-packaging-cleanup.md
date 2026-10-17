# 打包冗余清理实施计划

Status: Completed

## 目标与边界

按当前 electron-builder 规则核对进入客户端的文件，将确认过期或未使用的文件直接移入仓库根目录 `tmp/`，排除仅供开发制作使用的资料，再给出剩余大图占用。保留实际使用的内置样式、字体与许可证、动态加载入口、兼容逻辑和用户既有修改；不改变功能、公共 URL、持久化数据、授权、更新、签名或安装流程，不发布或提交。

## 现状与归属

- `package.json` 的 `build.files` 收集 `src/**/*`、`public/**/*` 和窗口图标；已有外置套装、旧礼物图库和重复 PNG 排除。
- `test/engineering/packaging-scope.test.js` 使用 electron-builder 的真实过滤器验证范围；构建参考由 `docs/reference/engineering/build.md` 拥有。
- 首轮统计为 258 张 PNG/WebP、32,519,719 字节；`danmaku-comet` 的素材说明已确认五张旧装饰不再使用。
- 工作区已有大量未提交修改。当前文件清单、状态及本任务将修改的既有文件基线保存在 `tmp/package-cleanup-before*`，不覆盖这些修改。

## 步骤与验证

- [x] 审计：列出真实打包过滤器包含的全部源码、数据和资源，核对直接与动态引用；每个移出项记录原路径、用途和移出依据，保存在 `tmp/package-cleanup-moves.json`。
- [x] 清理：八个旧文件平铺移动到 `tmp/`，源/目标绝对路径均在仓库内、目标未覆盖且移动前后 SHA-256 相同；开发制作资料采用精确排除，保留必要许可。更新素材现状和构建参考，不修改无关业务实现。
- [x] 回归：扩展既有 packaging-scope 测试，使用真实过滤器及既有合成归档验证排除规则、必需资源和完整生产依赖；最终 15 项通过。新增规则均先观察到对应断言失败，再实施排除。
- [x] 实包：使用当前 Electron 的本地分发目录构建 `--dir` 到 `tmp/`，检查生成的 `app.asar` 的移出项、剩余图片与生产依赖；不生成或发布正式安装器。
- [x] 收尾：`npm run verify:docs` 10 项、`node --check test/engineering/packaging-scope.test.js` 和 `git diff --check` 通过；任务增量已审阅，体积和限制记录如下。

## 文档与用户指导

构建参考与有变更的素材说明同步更新。只清理无用文件与开发资料，用户操作和功能入口不变，指南及引导预期不需更改；若发现消费者仍需要候选文件则保留。

## 审计发现与验证记录

- 组件预览图、千舰徽章与头像框、辉光纹章通过动态路径引用，保留。旧歌词字体入口虽然没有当前静态调用，但前端页面参考明确约定兼容 URL，保留。
- 第一轮实际 `--dir` 打包成功，归档还包含上游 TypeScript 源码/测试、类型声明、开发说明和 pako/js-yaml 浏览器重复构建。新增精确排除，保留全部生产依赖、Node CJS/ESM 入口、WASM 与许可证；再次打包验证这些新增排除。
- 首轮相关回归 43 项中 42 项通过；`danmaku-style-ownership` 在资源检查前失败，因为工作区原有共享字体改动新增 `display-fonts.css` import，旧测试的精确列表尚未同步。该 CSS 与测试均未由本任务修改，保留此已知基线问题，额外检查实际归档的当前图片引用。
- 文档门禁首次因本计划使用中文状态标签而失败，改为标准 `Status:` 后 10 项通过。
- 第二组 `danmaku-overlay-renderer`、`danmaku-message-renderer`、`qq-provider`、`qq-provider-streams` 与 `qq-encrypted-stream` 回归共 65 项通过。
- 最终构建命令：`node node_modules/electron-builder/out/cli/cli.js --win --x64 --dir --publish never --config.electronDist=node_modules/electron/dist --config.directories.output=tmp/package-cleanup-final-build`。构建期间已记录的源码与配置哈希未变化；22 个生产依赖完整，资源清单哈希一致。
- 使用 Electron 的 Node 模式从归档内解析依赖，压缩/QRC 往返、QQ 签名、YAML、semver、WASM 与更新器模块加载通过；没有启动用户桌面应用、读取用户数据或调用外部服务。290 处当前静态图片引用通过归档核对。
- 工作区同期的字体按需下载改动更新了字体排除和原有测试；本任务保留该改动，本任务体积统计不包含其效果。旧字体兼容入口与所有许可证继续保留。

## 结果

本任务移出或排除共 40 个文件、5,376,449 字节（5.13 MiB）：8 个旧文件原样平铺移动到 `tmp/`，8 个维护资料与 24 个依赖开发文件/浏览器构建副本只排除分发。未在运行时代码中发现可以安全移除且不承担兼容契约的孤立模块。

PNG/WebP 从 258 张、32,519,719 字节降为 252 张、28,544,959 字节，即 31.01 → 27.22 MiB。主要剩余项为队列主题 7.30 MiB、指南截图 4.95 MiB、弹幕示意头像 4.43 MiB、猫咪/兔子感谢插画 2.65 MiB、辉光纹章 1.53 MiB。大图尺寸、逐目录统计与前二十项见本机 `tmp/package-cleanup-images.md`；清单与回退路径见 `tmp/package-cleanup-moves.json`。

上述为归档内文件体积，不等于压缩后 EXE 节省量。现有安装器未修改；仍有独立于本次清理的弹幕样式测试基线失败，原因已在上方记录。功能、操作入口未变化，技术参考与素材说明已同步，用户指南无需因本次清理改动。

## 回退与完成条件

移动前检查目标冲突，并记录原路径和字节数。失败时仅按清单移回本任务文件并撤销本任务的精确编辑，禁止全局 reset/checkout。只有移出项均有证据、相关回归和实包核验通过、文档准确且增量审阅完成，才标记完成。
