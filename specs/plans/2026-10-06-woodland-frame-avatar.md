# 林间花信宽边与送礼头像

**Status:** Awaiting Verification

实现、54 项相关测试和隔离浏览器展示检查已完成；仅仓库契约门禁因服务器检出版本与锁定版本不一致待补验，不以此授权切换服务器仓库或发布。

## 目标与范围

保留用户认可的四边独立重绘花叶、黄色铭牌和四秒播放流程。四边展示时轻微摆动；
送礼头像居中放在铭牌上方，牌内显示单行“感谢 礼物名×数量 ~”。不调整门槛、队列、其他礼物特效或设置键。

## 现状与所有权

`gift/frame-config.js` 生成 final 礼物事件，`overlay-projection.js` 投影至独立网页源和场景；
当前 `gift:frame` 没有头像字段。`gift-effects-frame.js` 驱动透明视频和原两行昵称/礼物文本。
相邻大航海感谢和礼物滚动已有头像校验、代理与占位图惯例。四边新素材和合成视频由同目录图像资源拥有。

## 兼容约束

仅给 `gift:frame` 增加可选展示字段 `avatarUrl`；旧事件缺失时显示已有默认头像。
头像使用现有受限 B 站代理及 overlay 凭据；为 `gift-effects` 仅增加 `GET /api/bilibili/avatar` 展示权限，
不开放其他读取或写入能力，不改变 HTTP 地址、场景身份或持久化。
全部礼物文本使用 `textContent`，长礼物名缩小后截断，数量与结尾独立保留。
保留其他工作区修改；不提交、发布或替换正在运行的安装版。

## 实施与验证

- [x] 事件 adapter 读取已知头像，将既有大航海头像校验移至 gift 内共用 helper；投影透传该字段。
  导出现有礼物头像代理地址 helper 供边框复用，为 gift-effects 增加该只读代理路由。验证 adapter、授权与投影/场景测试，确认私有字段仍被排除。
- [x] 修改现有 HTML/CSS/controller，头像随字幕一起进退场，缺失或加载失败回落默认图；更新控制器生命周期测试。
- [x] 完成四边素材和黄色铭牌的透明视频，展示阶段保持四边持续摆动。验证 120 帧、四秒、中央透明、四边外沿覆盖与相邻帧变化。
- [x] 浏览器源检查默认/有效/失败头像、长礼物名、文字对齐、重复播放与结束清空；复核契约文档及最终差异。
- [ ] 在服务器仓库与锁定版本一致的工作区补跑 `npm run verify:contracts`。

测试命令：`node --experimental-vm-modules --test test/gifts/gift-frame-config.test.js test/gifts/gift-frame-controller.test.js test/gifts/gift-effects-overlay.test.js test/gifts/gift-frame-queue.test.js test/scenes/scene-gift-events.test.js`，并运行实际发现的 overlay 投影安全测试。
受影响 JS 单独语法检查；契约增加字段后运行 `npm run verify:contracts`；最终 `git diff --check` 与 `git status --short`。

## 验证记录（2026-10-06）

- `node --experimental-vm-modules --test test/gifts/gift-frame-config.test.js test/gifts/gift-frame-controller.test.js test/gifts/gift-effects-overlay.test.js test/gifts/gift-frame-queue.test.js test/gifts/guard-thanks.test.js test/scenes/scene-gift-events.test.js test/overlays/overlay-projection.test.js test/bilibili/bilibili-avatar-proxy.test.js`：54 项通过。
- `node --check` 检查 avatar-url、frame-config、overlay-projection、access-policy、gift-effects-frame 和 gift-banner，全部通过。
- 解码视频共 120 帧、30fps、4 秒；中央 `(310,260)–(1610,850)` 全程透明。上/下/左/右外沿 12px 平均覆盖率分别为 98.3% / 99.3% / 99.1% / 98.7%，四边展示阶段均有逐帧变化。首帧透明，最后编码帧处于退场尾部（alpha 最大 5/255），4 秒结束时控制器清空。
- 隔离浏览器使用当前工作区静态文件及模拟 WebSocket/头像响应，验证有效头像、代理失败回落、旧事件缺失头像、长礼物名缩小省略、完整数量、重复播放及结束清空；无页面异常。头像在 `(912,864)`、96×96，文字在 `(676,976)`、568×56。截图与媒体测量保存在根目录 `tmp/gift-frame-redesign/`。
- 浏览器验证未写入真实礼物或场景数据，测试上下文和进程已清理。运行中的安装版位于 `D:/Work/live-exe/LIRA/`，本次未替换；验证对象是工作区版本。
- Impeccable 检测指出头像初始无 src；这是事件播放前赋值、结束后清空的生命周期设计，成功与回落均已实测。其他告警来自原有大航海样式，本次范围外。
- `npm run verify:contracts` 未通过：要求服务器 revision `01fb2b47d5e081f5dd559933991ade4819eb3428`，实际检出 `4f287489825c606875bfdfbb46b78c6d08f8e000`。未修改该仓库或版本锁；此门禁保留待补验状态。

## 失败处理与完成条件

不写入真实礼物或场景数据。素材原版与前一版保存在根目录 tmp；失败仅恢复本任务修改的片段或资产，不覆盖整份已有变更文档。
上述验证通过、公开契约一致、视频/头像/文本在预览中可见且无错位后完成，归档并记录实际证据。
