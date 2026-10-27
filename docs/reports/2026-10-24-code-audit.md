# LIRA 当前工作树只读代码审计

日期：2026-10-24。基线：`98923fbd9918ab32fab89451cd3ae511e8013dc1` 加当前工作树。最终复核输入快照：`a84d3b7148311fc5eaab16e7aaaca4f1dbc234b9cf92b3650f8354e4aa11f4b5`。配套[审计提示词](2026-10-24-code-audit-prompt.md)。

本报告只提出问题和修复方向，没有修改业务实现、测试、配置、依赖或锁文件，也没有把建议标记为 Accepted。快照覆盖 2,458 个源码、测试、脚本、native/build、契约和文档文本输入，包括非忽略未跟踪文件；三份报告输出不纳入清单，避免报告写入改变自身摘要。

## 结论

本轮形成 **8 项结论**：4 项已确认、1 项条件性风险、3 项改进建议；按严重度为 **Critical 0、High 1、Medium 4、Low 2、Info 1**。唯一的 High 是实际桌面运行时 Electron 落入已知公告范围，不代表已经证明 LIRA 可被利用。

当前代码中有两项值得分别修复的正确性问题：点歌冷却键会发生跨主播及昵称/UID 碰撞；空当前曲目且普通保存仍在途时，显式卸载/关机 flush 缺少快照兜底。另有未来时间戳放大冷却的条件性风险。依赖方面还应处理构建链公告和即将到来的 .NET 8 停止支持日期。

未确认未授权管理访问、真实秘密泄漏、任意本地文件读取、dry-run 实际删除、迁移或礼物/加班机/云同步的新数据破坏路径。没有测得新的性能缺陷；已有查询性能提案不重新包装成本轮发现。

| 编号 | 严重度 / 状态 | 结论 | 首要处理方向 |
| --- | --- | --- | --- |
| F-01 | High / 已确认依赖风险 | Electron 43.2.0 是实际桌面运行时，落入 12 项公告的受影响范围 | 评估并升级到同线 43.8.3+，做桌面与打包回归 |
| F-02 | Medium / 已确认 | 用户点歌冷却未绑定 `fanScope`，且昵称可写入稳定 UID 的键 | 以可信 scope + 稳定类型身份构键，明确旧记录策略 |
| F-03 | Medium / 已确认 | 在途空当前曲目快照不能被卸载/关机显式 flush 取得 | 让在途快照在 settle 前仍可供显式 flush 重发 |
| F-04 | Medium / 已确认依赖风险 | fast-uri、http-cache-semantics、undici 的受影响版本存在于安装/构建链 | 经受支持的父依赖和锁文件更新，验证安装与打包 |
| F-05 | Medium / 改进 | 原生音频助手仍以即将停止支持的 .NET 8 为目标 | 在 2026-11-10 前规划并验证运行时迁移 |
| F-06 | Low / 条件性 | 未来持久化时间可把 60 秒冷却放大到一年以上 | 定义未来时间的忽略、钳制或修复策略 |
| F-07 | Low / 改进 | 构建/测试直接引用未直接声明的传递包及 builder 内部路径 | 明确直接 devDependency 和内部 API 耦合 |
| F-08 | Info / 改进 | 仓库不能单独还原锁定的 NuGet SDK/传递依赖图 | 在原生构建任务中固定 SDK 与锁文件 |

## F-01：Electron 43.2.0 需要按实际运行时处理公告

**证据。** [package.json:48](../../package.json#L48) 固定 Electron 43.2.0；[package-lock.json:1465-1468](../../package-lock.json#L1465-L1468) 一致，已安装的 `node_modules/electron/dist/version` 也是 43.2.0。因此它不是只在清单中出现、实际不执行的开发包。

`npm audit --json` 对 Electron 汇总 12 项公告，受影响上界分别涉及 `<43.4.1`、`<43.5.0`、`<43.5.1`、`<43.7.0`、`<43.7.3`、`<43.7.6` 和 `<43.8.1`；npm 提供同 major 的 43.8.3 修复版本。尤其是 `GHSA-jr5w-w6x2-84p9` 的 eMudhra 中间证书缓解涉及平台 HTTPS 证书信任，不能只按开发依赖忽略。

**LIRA 功能面分诊。** 这 12 项公告不能算作 12 个独立的 LIRA 漏洞：

- 主窗口使用 `contextIsolation:true`、`nodeIntegration:false`，其 preload 为 `sandbox:false`；屏幕取色器虽使用 sandboxed preload，但加载打包本地文件并禁止导航和新窗口，见 [screen-color-picker.js:46-60](../../src/electron/screen-color-picker.js#L46-L60)。没有证明“renderer 已被 compromise”这一公告前提。
- `local-media` 显式设置 `corsEnabled:true`，并有 realpath、允许集合、扩展名及 regular-file 检查；没有证明跨源任意文件读取。
- 已审查窗口的新窗口处理器均拒绝创建子窗口，或只在原登录窗口导航/交给系统浏览器。定向搜索未找到 `<webview>`、HID/USB、pointer lock 或扩展 API 使用面；相应公告不另列为可达发现。

**最小处理方向。** 在独立依赖任务中升级到 43.8.3 或后续兼容 43.x，并核对 Electron 更新说明。重点运行窗口/导航、请求认证与重定向、local-media、播放关闭 flush、屏幕取色器及打包验证。此次没有升级依赖、启动 Electron 或构建安装器，因而不声称升级已完成或其兼容性是已验证事实。

## F-02：点歌冷却键缺少主播 scope，并允许昵称污染 UID 命名空间

**位置与所有者。** [bilibili-message-handler.js:66-83](../../src/bilibili/bilibili-message-handler.js#L66-L83) 以 `open_id:<id>`、裸 UID 或裸昵称作为冷却键；[同文件:143](../../src/bilibili/bilibili-message-handler.js#L143) 在每次成功接纳后记录。`fanScope` 虽在同文件第 105–129 行传进队列，却不参与冷却。[domain-services.js:47-48](../../src/server/domain-services.js#L47-L48) 只创建一个冷却实例，[schema.js:236-243](../../src/storage/schema.js#L236-L243) 的 `user_cooldowns.user_key` 也是单列主键。

可信 scope 已存在：[fan-profile-controller.js:8-13](../../src/electron/fan-profile-controller.js#L8-L13) 从认证 Server origin 与 `streamerId` 构造 scope，[bilibili-client.js:23,64-79](../../src/server/bilibili-client.js#L23-L79) 捕获并传入消息处理器。相邻的歌曲冷却已经按 `(owner_scope, song_key)` 隔离，见 [queue-store.js:41-47,89-96](../../src/storage/queue-store.js#L41-L47)。这违反[架构的主播租户边界](../architecture/README.md#跨端与数据所有权)；已完成点歌规格也明确“不接受昵称为身份”，见[点歌控制规格:26](../../specs/plans/archive/2026-10-14-song-request-controls.md#L26)。

**已复现的两条路径。** 使用隔离临时数据库和合成消息：

1. UID 42 在 scope A 以 60 秒规则成功点歌后，其在 scope B 的首次点歌被返回“用户冷却中，还需 60 秒。”；清空内存并从数据库恢复后仍被拒绝。不同 UID 43 的 B 对照请求成功。请求流水已经分别保存 A/B 的 `owner_scope`，只有用户冷却仍共享裸键。
2. 冷却为 0 时，无稳定身份、昵称为 `42` 的合法请求能够成功，却写入 `user_key='42', uid=''`。随后启用 60 秒规则并恢复，真正的 UID 42 被错误拒绝，UID 43 对照成功。

**影响与边界。** 第一种是跨主播业务状态干扰，第二种是无身份消息对稳定身份点歌资格的碰撞影响；均可持续经过启动恢复。需要账号/scope 切换或特定缺身份昵称等前提，不是秘密读取或管理授权绕过，因此不定为 High。

**最小处理方向。** 在消息处理/冷却 owner 中以可信 `fanScope` 和 `requesterIdentity` 的类型化稳定身份构成无歧义键；`user_key` 可继续作为不透明键，避免为键编码本身制造不必要迁移。无稳定身份且规则为 0 的合法请求仍可接受，但不要写入稳定身份命名空间。旧无 scope 记录必须有明确兼容策略，不能回退为对所有主播生效。

后续修复应复用 `queue-service`/`song-cooldown` 的隔离测试风格，增加上述两例及恢复覆盖，并同步弹幕和存储参考；本次未修改测试或契约文档。

## F-03：显式 flush 无法接管在途的空当前曲目快照

**触发交错。** [state-persistence.js:125-139](../../public/js/playback/operations/state-persistence.js#L125-L139) 在普通非 keepalive `fetch` 前调用 `takePendingPayload()`；[同文件:165-173](../../public/js/playback/operations/state-persistence.js#L165-L173) 同时清空 dirty 和 pending。若此时 `playbackState.current === null` 且没有更新一轮 dirty 状态：

1. `pagehide` 调用 [initializer.js:121](../../public/js/playback/core/initializer.js#L121) 注册的卸载 flush；
2. [state-persistence.js:179-185](../../public/js/playback/operations/state-persistence.js#L179-L185) 因 current 为空而不重新捕获，只能取到 `null`；
3. IPC、beacon/keepalive 均不发送。若普通请求随后被卸载取消或失败，最新队列/待确认请求状态没有第二条提交通道；
4. 关机 flush 在[同文件:213-238](../../public/js/playback/operations/state-persistence.js#L213-L238) 使用同样的取值条件，存在相同的缺失兜底路径。

这与[播放持久化契约:143,155](../reference/frontend/playback.md#L143-L155)所述“卸载直接发出实际快照、IPC 与 beacon/keepalive 同发”不符。现有空当前曲目测试 [playback-snapshot-ordering.test.js:179-197](../../test/playback/playback-snapshot-ordering.test.js#L179-L197) 只覆盖 dirty 尚未发送的情况；后续在途测试沿用非空 current 的 fixture，未覆盖此交错。

**合成复现与 guard。** 延迟普通保存后调用显式 flush，再模拟普通请求取消：

- 空 current 的 unload：IPC 0、beacon 0、keepalive 0；普通请求失败后已接受快照仍为 0。
- 空 current 的 shutdown：IPC 0、keepalive 0；普通请求失败后已接受快照仍为 0。
- 非空 current 对照：unload IPC 1、beacon 1，说明差异来自上述取值条件。

正常桌面关闭会 quiesce 并 drain 已进入 tracker 的 HTTP，见 [server.js:487-520](../../src/server.js#L487-L520)。普通请求若成功提交，不会丢失；本项只指“已取出但未成功持久化”的交错，不能宣称每次关闭都回滚。未实际关闭浏览器或 Electron，复现证明的是缺失兜底及模拟失败路径，不是发生频率。

**最小处理方向。** 让最新在途快照在 settle 前仍可由显式 flush 获取，并沿用现有 `snapshotVersion`、IPC + beacon/keepalive 幂等协议同步重发；不要在 `pagehide` 中等待普通 fetch。修复后补空 current + 在途 + 失败的 unload/shutdown 两例，同时保留非空对照、较新快照优先和迟到旧响应测试。

## F-04：三个受影响传递包位于安装/构建链

`npm audit` 共报告 4 个受影响包条目；除 F-01 外，其余为下表。`npm explain --offline` 将它们归于 dev/devOptional 链，当前没有证据表明它们是生产客户端运行时依赖；本次未重建安装器，因此也不把这一结论外推为新的打包证明。

| 包与当前版本 | 实际依赖链 | 公告范围 / 同线处理目标 | LIRA 暴露分类 |
| --- | --- | --- | --- |
| fast-uri 3.1.8 | `ajv → app-builder-lib → electron-builder` | 当前范围 3.0.0–3.1.8；3.1.9+ | 构建配置处理，不是已证明的客户端 URL 漏洞 |
| http-cache-semantics 4.2.0 | `cacheable-request → got → @electron/get@3.1.0 → app-builder-lib` | `<=4.2.0` | Electron 下载/构建缓存链 |
| undici 7.29.0 / 6.28.0 | 分别在 `@electron/get@5` 安装链、`node-gyp → @electron/rebuild → app-builder-lib` 链 | 当前公告延伸至 7.30.0 / 6.29.0；需 7.30.1+ / 6.29.1+ | 安装与原生重建工具链 |

**最小处理方向。** 在后续依赖任务中通过受支持的父依赖和锁文件更新消除受影响版本，不使用 `--force`，也不在审计中运行 `npm audit fix`。更新后重新执行 `npm ls`/`npm audit`、安装下载路径、builder 相关测试和打包验证。npm 的 High 聚合级别不直接等同于 LIRA 产品严重度；本项定为 Medium 是因为暴露主要在开发/构建环境。

## F-05：.NET 8 停止支持日期已临近

[AudioAssistant.csproj:4](../../native/audio-assistant/AudioAssistant.csproj#L4) 目标为 `net8.0-windows10.0.19041.0`，直接包为 NAudio 2.2.1 和 Microsoft.ML.OnnxRuntime 1.26.0；[NativeChecks.csproj:4](../../test/desktop/audio-assistant-native/NativeChecks.csproj#L4) 也使用 net8.0。

2026-10-24 读取 Microsoft 官方 [release metadata](https://dotnetcli.blob.core.windows.net/dotnet/release-metadata/releases-index.json)：.NET 8 为 maintenance，EOL 是 **2026-11-10**；.NET 10 为 active LTS，EOL 是 2028-11-14。self-contained 发布仍需要运行时 servicing 计划。

这不是当前漏洞证据，而是时间明确的维护风险。建议在停止支持前单独规划原生目标框架迁移，评估 .NET 10 LTS 与两个包及 Windows 目标的兼容性，同时迁移原生测试目标，再执行获授权的原生构建、音频行为和打包验证。不能只改 TFM 就宣布完成。

## F-06：未来持久化时间可把冷却放大到一年以上（条件性）

[bilibili-message-handler.js:72-83](../../src/bilibili/bilibili-message-handler.js#L72-L83) 直接用 `Date.now() - lastAt`，没有处理负 elapsed。[cooldown-store.js:14-29](../../src/storage/cooldown-store.js#L14-L29) 会恢复未来行，第 49–64 行的 pruning 也只删除过旧记录。

合成写入一个比当前时间晚 365 天的记录，恢复后使用 60 秒规则，实际返回“用户冷却中，还需 31536060 秒。”。机制得到复现，但需要系统时钟回拨、先前错误未来时钟或其他未来行来源；没有发现 accepted 的异常时钟恢复策略，也没有真实时钟事故证据，因此只列 Low / 条件性。

若确认需要防御，应在恢复/读取层定义未来时间的忽略、钳制或修复规则，保证剩余时间有界，并覆盖重启。仅换 monotonic clock 不能解决已经持久化的未来行。

## F-07：直接构建/测试引用应摆脱隐式传递依赖

[package.json:40-51](../../package.json#L40-L51) 未直接声明 `@electron/asar`、`builder-util`、`app-builder-lib`，但当前脚本/测试直接加载它们：

- [verify-packaged-dependencies.js:4](../../scripts/verify-packaged-dependencies.js#L4)、[client-integrity-manifest.js:59](../../scripts/client-integrity-manifest.js#L59)、[verify-client-installer.js:97](../../scripts/verify-client-installer.js#L97)；
- [packaging-scope.test.js:13,267-269](../../test/engineering/packaging-scope.test.js#L13) 等测试还引用 `app-builder-lib/out/...` 内部路径；`test/helpers/packaged-app.js`、安装器和 Electron 资源测试也直接使用 asar/builder 包。

当前 lockfile 能安装这些包，未复现出现有构建故障。风险是父依赖调整依赖图或内部路径时，项目自身的直接消费面没有被声明，升级容易意外破坏。建议把 intentional 的构建工具引用声明为兼容版本的直接 devDependency；内部路径优先改用公开 API，若测试确实必须耦合则明确固定/封装并在 builder 升级时重点验证。`original-fs` 是 Electron 特殊内建模块，不属于此问题。

## F-08：NuGet 传递图和 SDK 缺少仓库内锁定证据

仓库未发现 `global.json`、`packages.lock.json` 或 `project.assets.json`；[build-audio-assistant.js:18-21](../../scripts/build-audio-assistant.js#L18-L21) 直接执行 `dotnet publish`，没有 locked restore 步骤。因此本次只能核实 `.csproj` 的两个直接包版本，不能从仓库单独还原并审计完整 NuGet 传递图，也不能证明不同时间的 restore 解析完全一致。

这不是已发现的 NuGet 漏洞或构建失败。建议在下一次原生/构建任务中固定预期 SDK、提交 NuGet 锁文件并以 locked mode 验证，同时保留现有隔离输出和资源完整性检查。为遵守只读边界，本次没有 restore 来生成这些资产。

## 结构与效率结论

- 没有证据支持新增框架、服务、前端构建步骤或按行数拆分文件。`check-modularity` 的 2,088 个文件中 18 项均为规模 review signal；不能据此制造结构缺陷。
- 用户缓存有 TTL/dispose，消息去重裁剪到 500 项，AI 生产入口有 1–100 的队列上限；这些候选没有形成无界增长发现。同步 I/O 命中也只作为热点线索，未在缺乏频率和预算证据时列为性能问题。
- 已有 [B1 查询性能提案](../../specs/plans/open-items.md)仍由原 owner 跟踪。本轮没有出现符合现有合成查询基准范围的新具体候选，因此未运行 benchmark，也不虚构优化比例。
- 结构改进仅限 F-07/F-08 的依赖声明和构建可复核性；不建议把代码、依赖和原生迁移合成一次跨领域整改。

## 代表性排除项与已知事项

| 候选 | 排除或保留理由 |
| --- | --- |
| 特殊 API 提前分派绕过 principal | 各 preview/scene/media 路径有独立 session/capability/owner 检查；scene SSE 还周期重验。提前分派本身不是授权绕过。 |
| retention dry-run 续批遗漏 `dryRun` | 真实 dry-run 在 [retention.js:39-52,83-91](../../src/storage/retention.js#L39-L52) 保持 `hasMoreGiftEvents=false`，不会进入路由续批。 |
| clear-all partial 后 writer 仍暂停 | 符合当前恢复契约；consumer-first resume、失败重暂停和投影重建均存在，不将 accepted 行为报成 bug。 |
| 迁移、礼物、加班机、云同步恢复 | 深查未发现新的可辩护候选；已有事务、generation/cursor/fence 和恢复测试是排除证据，不等于全量形式化证明。 |
| 桌面请求认证、local-media、IPC 来源 | 已有主窗口/mainFrame/origin/path、redirect 凭据重核及 canonical path guard，未形成泄漏或任意文件读取路径。 |
| 最新弹幕 renderer DOM/清理 | 对晚到变化做了增量复核；动态文本使用 DOM/textContent，未新增不受控 URL、异步代次或自有资源。 |
| 私钥模式命中 | 仅 [log-redaction.test.js:18](../../test/shared/log-redaction.test.js#L18) 的合成脱敏标记，相邻测试值不是实际私钥。 |
| 历史 M1–M5、B1–B3、签名/安装验收 | 已整改或已有 owner/plan；没有新机制时不重复计数。缺少验收不自动等于现有功能失效。 |

## 实际验证

环境：Node `v24.21.0`，npm `10.9.0`。工作树在审计期间有后续弹幕修改；每次 focused 检查前后都比较输入。播放和点歌检查期间只有无关弹幕文件变化，涉及本报告 F-02/F-03 的输入保持一致；最新生产 renderer 变化另做了增量语义复核。

| 检查 | 实际结果 |
| --- | --- |
| `npm run verify:docs` | 基线与最终均 10/10 通过，含本地文档链接检查 |
| `node scripts/check-js.js` | 最新 1,656 文件通过；10 个实际执行，1,646 个缓存复用 |
| `node scripts/check-modularity.js` | 2,088 文件，18 个 advisory；只作规模信号 |
| `node scripts/sync-danmaku-source.cjs --check` | 通过，固定源 SHA-256 `edeafac2020a3abb3ac44a18007a31e97e87643682af4ce36b2a8b8dc76dbe5e` |
| `node scripts/verify-server-contract.js` | 使用既有固定检出 `67119e81…`，10 个 contract fixtures 通过；未 clone/fetch |
| 播放快照顺序套件 | 23/23 通过；另用隔离 VM 合成复现 F-03，退出码 0 |
| 点歌三个 focused 套件 | `queue-service`、`song-cooldown`、`user-request-cooldown` 共 34/34 通过；另用隔离数据库复现 F-02/F-06，退出码 0 |
| `npm ls --depth=0 --offline --json` | 通过，直接依赖树完整 |
| `npm audit --json` + `npm explain --offline` | audit 退出码 1 是因存在公告；4 个包条目已逐项分诊，未执行 fix |
| `git diff --check` | 起始与最终均通过；新文档另做 no-index 检查，无 whitespace error，只有 LF→CRLF 提示 |

主要复现命令如下；测试 TEMP/TMP 和审计输出均隔离在 `tmp/code-audit/`，数据全部合成：

```powershell
node --experimental-vm-modules --test test/playback/playback-snapshot-ordering.test.js
node --test test/songs/queue-service.test.js test/songs/song-cooldown.test.js test/songs/user-request-cooldown.test.js
node --experimental-vm-modules tmp/code-audit/repro-playback-inflight-unload.cjs
node tmp/code-audit/repro-user-cooldown-scope.cjs
```

## 覆盖限制与交付边界

- 本次是高风险路径抽样深查加全库定向静态模式扫描，不是逐行审计或完整 SAST。环境没有 Semgrep、Gitleaks、Trivy、OSV、Snyk、ESLint；没有安装新工具，定向搜索不能证明“没有秘密”或“没有漏洞”。
- 没有运行全量 `npm test`/`verify`、真实 Electron/UI 关闭、真实账号或生产服务、主动利用、native build/restore、安装器、发布或 roundtrip。需要这些证据的事项均保留为限制，没有用隔离测试冒充端到端验收。
- 没有运行真实性能 benchmark；不能据此承诺启动、主线程、渲染或大数据性能。NuGet 只有直接包和官方生命周期证据，未完成传递漏洞审计。
- 中间快照、日志和复现脚本位于未提交的 `tmp/code-audit/`。复现脚本断言的是当前缺陷行为，不是修复后的产品测试，也没有加入测试套件。
- 实现、业务测试、技术契约和用户指南均未由本任务修改，因为审计不改变行为、接口或操作步骤；F-02/F-03 等条目列出的是后续实施时应补的覆盖和文档，不是已完成整改。

## 收尾结论

推荐先在独立任务中处理 F-01；F-02 与 F-03 分属点歌身份和播放持久化，应各自小批量修复并回归。F-05 有明确日期约束，应与 F-04 一并纳入近期依赖维护，但不要共享未经分解的验证。F-06 先确认异常时钟策略，F-07/F-08 可随对应构建工作完成。

最终 `npm run verify:docs` 为 10/10 通过；`git diff --check` 退出码 0，两份新文档的 no-index 检查也没有空白错误。最终快照与报告基线一致，2,458 个输入无缺失、比较变化为 0。`git status --short --untracked-files=all` 共 212 条记录，本任务新增的交付变更仍只有本报告、提示词和报告索引，其他既有修改均保留。未提交、未分支、未发布。
