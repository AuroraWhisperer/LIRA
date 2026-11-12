# Compact Installer and Online Agreement Implementation Plan

**Status:** Completed

**Goal:** 缩小现有 NSIS 安装窗口，将协议页改为带官网全文链接的一段简要说明；保留同意/不同意单选并默认不同意。按用户后续要求单独收紧完成页及其文案、位置，安装范围、目录和进度页保持原样。

**Architecture:** 安装和更新继续由 electron-builder/NSIS 拥有；客户端现有 `user-agreement.txt` 是本次协议正文来源，官网固定地址 `/legal` 展示从该文件导出的现行静态 HTML，安装包保留对应正文。沿用官网页面注册、Host 边界与公共样式，不新增服务或依赖。

**Tech Stack:** NSIS/MUI2/nsDialogs、Node.js、原生 HTML/CSS、Express。

## Boundaries and compatibility

- 用户要求在现有基础上迭代；后续提供了正式字标，替换协议页、客户端标题栏、登录页及关于页品牌位置，软件图标继续独立使用。
- 不改安装位置、安装范围、迁移/保留数据、卸载策略、授权或更新启动语义。
- 不提交、推送、部署或发布；官网上线与客户端正式发布是后续操作。
- 首次交互安装默认未同意；只有明确勾选后才能继续。自动更新与静默安装保留原流程。
- 官网版本与客户端原有设置页正文对应；按用户修正移除安装页离线全文入口，不把隐私说明当作所有可选功能/出境处理的一揽子同意。
- 免责条款保留法定责任；不宣称不存在漏洞或可以排除一切责任。
- 保留两仓所有既有修改。

## Initial behavior and ownership

- `build/installer.nsh` owns the builder license slot; current page displays the entire bundled agreement.
- `build/installer-ui.nsh` owns 640×480 installer geometry, DPI scaling, footer and update/finish presentation.
- `public/pages/admin/toolbox/user-agreement.txt` is also read from client settings; keep that entry and source.
- `test/engineering/installer-static.test.js` guards agreement ownership and installation data safety; existing installer update/migration/uninstall suites cover unchanged lifecycle contracts.
- `docs/reference/engineering/build.md` owns installer implementation facts.
- Server `src/register-pages.js` owns website pages and Host guards; `public/site/` owns public page styling and homepage footer.
- Server requirements/acceptance documentation owns public-page behavior; update only the new legal-page rule and navigation entry.

## Milestones

- [x] **Agreement and website:** Update the bundled agreement where the new delivery model or known retired functionality requires it; preserve substantive existing disclosure. Add a deterministic exporter and readable static page at `/legal`, with terms/privacy anchors, important terms highlighted, print support and homepage entry.
  - Verify: exported content/hash matches bundled text; primary/development Hosts return 200; unrelated Hosts remain excluded; full content works without JavaScript.
- [x] **Installer:** Keep builder's license slot and upgrade skip behavior; show one short paragraph with an inline online link and the original accept/decline radio options, initially declined. Reduce the ordinary window to 600×380 and preserve the original directory/progress presentation. Following the user's later request, independently reduce the finish page to 420×260 and tighten its text and control positions. Use the supplied wordmark, build version and existing app icon on the agreement header. The paragraph uses neutral wording without platform brands and is enlarged by two logical pixels.
  - Verify: cached NSIS compiler builds actual production page/UI in an isolated fixture with the production DPI manifest; native inspection covers initial declined/disabled Next, explicit acceptance, online callback, back navigation and retained directory/progress/finish layout. No real installation or user app lifecycle changes.
- [x] **Synchronization and review:** Update build reference and server legal-page requirement/acceptance; run affected installer/server checks and both documentation gates.
  - Verify: focused tests pass; `git diff --check` and touched diffs reviewed in both repositories; only intended files and permanent assets changed.

## Verification commands

- Live: `node --test test/engineering/installer-static.test.js test/engineering/installer-update.test.js` and affected native installer checks selected after the final diff.
- Live: `npm run verify:docs`.
- Server: existing page Host/cache tests plus the legal-page integration coverage; `npm run docs:check`.
- Native fixture and screenshots live only in root `tmp/`; browser preview uses an owned isolated local server.
- Review both worktrees using scoped `git diff`, `git diff --check` and `git status --short`.

## Failure handling

Stop only owned fixtures/preview servers. Inspect scoped diffs and reverse only this task's edits if needed; do not reset either worktree or touch running user applications/data. A source build or local preview does not establish production deployment.

## Done when

The compact installer is sharp at actual Windows DPI and accepts only explicit consent through the original radio controls. The agreement page has the requested content/header, the finish page has its own compact layout, and the installation mode/directory/progress pages retain their original presentation. The inline online link opens `/legal`, the website displays current full text without login/JavaScript, affected checks pass and documentation describes the final result. Production deployment/legal-review limitations are reported separately.

## Evidence

- Initial inspection: existing installer/UI and agreement files are clean; both repositories contain unrelated user changes, including documentation and website shared CSS. Preserve those diffs.
- Legal boundary checked against Civil Code Articles 496–497/506 and PIPL Articles 14/17; do not treat acknowledgement of a privacy notice as unrestricted permission.
- User correction: remove the offline button and new checkbox; retain the original accept/decline radios, initially declined. Revert broader header and finish-page redesign. The first fixture omitted the production DPI manifest and its PrintWindow capture was virtualized; replace it with a DPI-aware fixture/capture before assessing clarity.
- Subsequent clarification: render the paragraph as a single native SysLink instead of separately positioned text/link controls; hide the branding footer, keeping version only in the header. Expand disclosure to software purpose, cloud processing and the meaning of acceptance. User supplied the real wordmark; its matching SVG geometry is reused for client branding and its supplied raster yields the installer bitmap.
- Final wording: remove platform brands from the installation paragraph, increase that paragraph by exactly two logical pixels, preserve other fonts and controls.
- Current workspace website changes retain a single `/legal` page without a dated URL/title; preserve that coordinated change and validate the current source instead of restoring the earlier proposed version routes.
- User follow-up: independently reduce the finish page from 480×360 to 420×260, align the icon/title/text/run option, and shorten the text to installation success plus the exit instruction. Native 150% DPI preview is 630×390 physical pixels; the title, both text lines, launch checkbox and finish button are visible without overlap.
- Verification: the initial 33 focused client checks passed; after the finish-page follow-up, all 11 installer static/update checks and the current 12 server page checks passed. Live documentation 10/10 and Server documentation/contracts 59/59 passed. Native 150% DPI fixture verifies default decline/disabled Next, acceptance toggling, inline keyboard activation, directory selection, return to agreement and the compact completion page; no real installation or user data was touched. CUA checked narrow/wide legal reading, in-page navigation, emphasis and matching wordmark geometry on light/dark backgrounds. The installer bitmap is explicitly retained by `.gitignore` as a permanent source asset.
- Remaining boundary: no full release installer was built, no server deployment occurred, no real account operation was performed, and the full legal text is not represented as a substitute for legal review.
