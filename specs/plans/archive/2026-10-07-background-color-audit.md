# 背景滤镜参数与算法核对

Status: Completed

## Goal and current behavior

按用户要求采用成熟参数和公开实现，纠正将三区乘色当作 Shoost 调色轮的偏差。当前 RGB 白平衡和三区乘色为 LIRA 自定义近似；已有像素、ZIP 和隔离 Electron 检查，但它们不证明算法等同 Shoost。保留原色默认值。

## Ownership and compatibility

- `background-appearance.js` 负责字段、默认值、兼容判定；`scene-extra-config.js` 复用该判定。`component-style-library.js` 合并作者配置前不填模式，防止旧 ZIP 被默认 standard 覆盖。继续使用扁平 config、既有 API、包 schema、媒体生命周期和权限。
- `background-filters.js` 负责 SVG；新增 `background-color-science.js` 仅负责有出处的数学公式。使用 Unity PostProcessing v1 的 MIT 版本 `933df236f509ed64ae5763ed57af33f2342cd1c2`，附上许可；不移植使用受限许可证的 v2。
- 新增 `colorProcessing: standard/legacy`。未声明且旧白平衡/三区强度非零的配置自动进入 legacy；其他缺省为 standard。已保存旧值不重解释。
- standard 使用 CAT02 白平衡及线性 RGB LGG 系数；legacy 保留原白平衡、保持亮度、三区乘色。标准模式不使用旧字段，UI 分别显示。新增 LGG 为逐通道系数，不冒充 Shoost 色轮数值。
- 辉光等既有 SVG 行为不变，明确其效果类型和参数概念的来源与数值差异。不新增框架、依赖、HDR/LUT/工程导入或人物处理。

## Milestones and verification

- [x] 参数、兼容判定、标准数学公式与 UI：增加标准值/旧值往返、公式参考向量、浏览器像素检查；零值无需滤镜，源 Alpha 保留。
- [x] 文档：修改现有作者指南、字段合同和 JSON；添加官方参数对照、其他工具、分层合成及导出流程；文档示例经过真实 inspect/install。
- [x] 使用现有隔离 Electron 夹具验证新控件保存重开/输出/恢复原色，不控制用户应用。
- [x] 运行 `node --test` 的背景像素（含公式参考值）检查；场景/ZIP 背景用例；`npm run check`、`npm run verify:docs`、`npm run verify:architecture`；最终增量审查、`git diff --check`、`git status --short`。

## Evidence

- `node --test test/overlays/background-filters.test.js`：通过。四组 CAT02 参考像素、线性 RGB LGG、模式互斥、旧效果、透明度、恢复及滤镜节点生命周期。
- `node --test --test-name-pattern="background" test/scenes/scene-extra-components.test.js test/scenes/component-styles.test.js`：6/6。场景和作者默认往返、字段校验、旧资源包与普通媒体包使用 legacy、新包 standard、示例 1.1.0 真实 inspect/install。
- `node --test test/desktop/background-filters-electron.test.js`：1/1，约 70 秒。真实授权桌面入口、控件切换、LGG 保存/重开、正式来源与恢复原色；恢复截图每通道平均绝对差 <0.0001。截图为 tmp/background-filters-qa/desktop-canvas.png、original-blue.png、soft-blue.png；临时应用和数据由夹具关闭/清理。
- `npm run check`：1322 文件通过；`npm run verify:architecture`：23/23；`npm run verify:docs`：10/10。文档、字段与公式来源完成交叉审查；不需要无关全量业务测试。
- 保留其他任务的工作区修改；没有新增依赖、修改媒体原图、提交、构建安装包或发布。实际 OBS/直播姬 GPU 性能与 Shoost 工程互操作仍不在已验证范围。

## Rollback and done

局部基线在 `tmp/background-filter-audit/before/`；失败时只回退本轮增量，不能覆盖并发改动。验收以中性像素、旧配置兼容、新配置持久化、来源与许可证可追溯、文档示例可导入为准。实播性能、Shoost 完整数值兼容与作者未公开的工程格式不在已验证结论中。不提交、不构建安装包、不发布。
