'use strict';

const fs = require('node:fs');
const path = require('node:path');
const tools = require('./lib/page-tools.cjs');
const { OUT_ROOT } = require('./manifest.js');

// Small recipes keep navigation and screenshot subjects reviewable.
const SHOTS = [
  { id: 'A1', file: 'client-login-window', title: '注册 LIRA', kind: 'license', annotations: ['#licenseAccountName', '#licensePassword', '#licenseActivationCode', '#licenseSubmitBtn'] },
  { id: 'A2', file: 'client-login-existing-mode', title: '登录已有账号与短效登录码', kind: 'license', click: '#licenseLoginMode' },
  { id: 'A3', file: 'client-login-username-help', title: '用户名规则', kind: 'license', size: [880, 800], hover: 'lira-help[label="用户名说明"]' },
  { id: 'A4', file: 'client-login-password-help', title: '密码规则', kind: 'license', size: [880, 800], hover: 'lira-help[label="密码规则"]' },
  { id: 'A5', file: 'client-login-activation-code', title: '注册激活码与一次性使用提示', kind: 'license', clip: '#licenseLoginCard', annotations: ['#licenseActivationCode', '#licenseCodeHelp'] },
  { id: 'A6', file: 'client-login-preparing', title: '正在准备直播工具（演示状态）', kind: 'license', license: { state: 'authorized' }, catalog: { status: 'running', phase: 'catalog', percent: 42 } },
  { id: 'A7', file: 'client-login-failed-retry', title: '连接失败与重试连接（演示状态）', kind: 'license', license: { state: 'needs_connection', error: 'NETWORK_UNAVAILABLE' } },
  { id: 'A7b', file: 'client-preparation-failed', title: '准备未完成与重新准备（演示状态）', kind: 'license', license: { state: 'authorized' }, catalog: { status: 'error', percent: 42, error: 'NETWORK_UNAVAILABLE' } },
  { id: 'A8', file: 'client-main-first-open', title: '主界面四个主标签与直播状态' },
  { id: 'A9', file: 'client-tour-bubble', title: '聚光灯引导：登录你的直播账号', feature: 'otherUsageGuideFeature', click: ['#reopenInteractiveTourBtn', '.lira-tour-next', '.lira-tour-next'] },
  { id: 'A10', file: 'client-topbar-status', title: '顶部导航、直播状态与窗口按钮', clip: '.topbar' },
  { id: 'B1', file: 'song-queue-overview', title: '点歌与 SC 队列总览' },
  { id: 'B2', file: 'song-queue-item-actions', title: '队列条目：置顶、复制歌名和删除', annotations: ['#queueList .queue-row:nth-child(2) .queue-actions button:nth-child(1)', '#queueList .queue-row:nth-child(2) .queue-actions button:nth-child(2)', '#queueList .queue-row:nth-child(2) .queue-actions button:nth-child(3)'] },
  { id: 'B3', file: 'song-library-list', title: '歌库列表、搜索与筛选', scroll: '#songSearch' },
  { id: 'B4', file: 'song-library-edit', title: '新增歌曲表单与可点开关', clip: '#songForm' },
  { id: 'B5', file: 'song-settings-account', title: '直播账号登录入口（未登录）', tab: 'settingsPage', scroll: '#bilibiliLoginBtn' },
  { id: 'B6', file: 'song-settings-room', title: '连接直播间设置（未配置）', tab: 'settingsPage', clip: '#settingsForm' },
  { id: 'B7', file: 'song-settings-rules', title: '接收消息与点歌规则', tab: 'settingsPage', scroll: '#enableBilibili' },
  { id: 'B8', file: 'song-theme-styles', title: '点歌板六种风格', tab: 'themePage', scroll: '#themePage' },
  { id: 'B9', file: 'song-theme-detail', title: '点歌板文字与滚动设置', tab: 'themePage', clip: '#classicThemeArea' },
  { id: 'B10', file: 'song-board-settings', title: '展示板排序、滚动与主题设置', tab: 'displayPage', clip: '#displayPage' },
  { id: 'B11', file: 'song-overlay-addresses', title: '浏览器源上半页：点歌与音乐', tab: 'overlayPage', setup: async (page) => { await page.locator('#overlayPage').evaluate((el) => { const scroller = el.closest('.song-workspace'); scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 60; }); }, mustShow: ['#queueUrl', '#songsUrl', '#lyricsUrl', '[data-tab="overlayPage"]'] },
  { id: 'B11b', file: 'song-overlay-addresses-scene', title: '浏览器源下半页：场景与氛围', tab: 'overlayPage', scroll: '#sceneOverlayGroupTitle', mustShow: ['#liveOvertimeUrl', '#liveClockUrl', '[data-copy-url="liveClockUrl"]'] },
  { id: 'B12', file: 'song-import-export', title: '下载模板、导入与导出歌库', tab: 'importPage', scroll: '#importPage' },
  { id: 'B12b', file: 'song-import-result', title: '粘贴表格后的实际导入结果（隔离歌库）', tab: 'importPage', setup: async (page) => { await page.locator('#importText').fill('歌曲名字\t原唱/首发歌手\t歌曲分类\t歌曲标签\t是否可点\t语言\t点歌价格\n说明用示例歌曲\t示例歌手\t示例\t文档\t是\t华语\t免费'); await page.locator('#importBtn').click(); await page.locator('#importResult').filter({ hasText: /成功|导入|跳过/ }).waitFor(); }, scroll: '#importBtn', mustShow: ['#importResult'] },
  { id: 'B14', file: 'song-request-confirmation', title: '点歌匹配后的下一首播放与跳过通知（示例请求）', keepPending: true, wait: '#pendingConfirmPopup.visible', annotations: ['#pendingConfirmAcceptBtn', '#pendingConfirmRejectBtn'] },
  { id: 'B13', file: 'desktop-lyric-appearance', title: '桌面歌词基础字体设置', tab: 'desktopLyricPage', size: [1440, 1040], scroll: '.desktop-lyric-settings-group.is-basic' },
  { id: 'B13b', file: 'desktop-lyric-stroke', title: '桌面歌词描边与阴影', tab: 'desktopLyricPage', setup: (page) => openLyricGroup(page, '#desktopLyricStrokeEnabled') },
  { id: 'B13c', file: 'desktop-lyric-karaoke', title: '桌面歌词逐字高亮与翻译', tab: 'desktopLyricPage', setup: (page) => openLyricGroup(page, '#desktopLyricKaraokeMode') },
  { id: 'B13d', file: 'desktop-lyric-opacity', title: '桌面歌词可见性与时间偏移', tab: 'desktopLyricPage', setup: (page) => openLyricGroup(page, '#desktopLyricTimeOffsetMs'), size: [1440, 1040] },
  { id: 'B13e', file: 'desktop-lyric-rendering', title: '桌面歌词背景与整体透明度', tab: 'desktopLyricPage', setup: (page) => openLyricGroup(page, '#desktopLyricGlobalOpacity') },
  { id: 'C1', file: 'playback-platform-tabs', title: '三个音乐平台与登录入口（未登录）', main: 'playbackAssistantPage' },
  { id: 'C2', file: 'playback-search', title: '在线搜索与结果条数', main: 'playbackAssistantPage', clip: 'section.panel:has(#playbackSearchKeyword)' },
  { id: 'C3', file: 'playback-wesing-cache', title: '全民 K 歌缓存目录与歌词时间调整', main: 'playbackAssistantPage', click: '[data-source="wesing"]', scroll: '#weSingCachePath' },
  { id: 'C4', file: 'playback-player-bar', title: '播放器控制栏（示例曲目，未播放）', main: 'playbackAssistantPage', click: '#playerDockToggle', clip: '#playbackPlayerBody' },
  { id: 'C6', file: 'playback-queue-drawer', title: '播放队列、导入点歌与清空', main: 'playbackAssistantPage', click: ['#playerDockToggle', '#playbackQueueBtn'], annotations: ['#playbackImportSongQueue', '#playbackClearQueue'] },
  { id: 'C7', file: 'playback-desktop-lyric-preview', title: '桌面歌词预览与浏览器源（等待播放）', tab: 'desktopLyricPage', clip: '#desktopLyricLivePreview' },
  { id: 'C8', file: 'playback-content-drawer', title: '最近播放的内容抽屉（登录状态与历史演示）', main: 'playbackAssistantPage', musicAuth: true, click: '[data-playback-home-action="recent"]', wait: '#playbackDrawer.open', mustShow: ['#playbackDrawerTitle', '#playbackDrawerClose', '#playbackDrawerPlayAllHeader'] },
  { id: 'C9', file: 'playback-match-diagnostic', title: '点歌匹配诊断（未找到候选的示例）', main: 'playbackAssistantPage', click: '.playback-match-panel summary', setup: async (page) => { await page.locator('#playbackMatchSong').fill('晴天'); await page.locator('#playbackMatchArtist').fill('周杰伦'); await page.locator('#playbackMatchBtn').click(); }, scroll: '.playback-match-panel', mustShow: ['#playbackMatchBtn', '#playbackMatchResults'] },
  { id: 'D1', file: 'gift-page-overview', title: '礼物统计与最近礼物', main: 'giftAssistantPage' },
  { id: 'D2', file: 'gift-auto-thanks', title: '自动答谢、礼物查询与服务器运行说明（演示设置）', main: 'giftAssistantPage', clip: '.gift-controls-grid' },
  { id: 'D3', file: 'gift-danmaku-query', title: '弹幕查询礼物统计开关（演示设置）', main: 'giftAssistantPage', clip: '.gift-controls-grid', annotations: ['#giftStatsQueryDescription'] },
  { id: 'D4', file: 'gift-recent-and-all', title: '最近礼物和查看全部入口', main: 'giftAssistantPage', clip: '.gift-recent-panel' },
  { id: 'D5', file: 'gift-history-drawer', title: '礼物历史筛选、已选记录与导出入口', main: 'giftAssistantPage', click: '#giftHistoryOpenBtn', setup: async (page) => { await page.locator('#giftHistoryBody input').first().check(); await page.locator('#giftHistoryBody input').nth(1).check(); }, mustShow: ['#giftHistoryExport'] },
  { id: 'D6', file: 'gift-export-workspace', title: '礼物 PNG 导出预览与保存设置（界面演示）', main: 'giftAssistantPage', click: '#giftHistoryOpenBtn', setup: async (page) => { await page.locator('#giftHistoryBody input').first().check(); await page.locator('#giftHistoryBody input').nth(1).check(); await page.locator('#giftHistoryExport').click(); await page.locator('#giftExportPanel').waitFor({ timeout: 5000 }); } },
  { id: 'D7', file: 'gift-wishes', title: '礼物许愿三个周期与目标进度', feature: 'otherGiftFeature', click: '#giftAssistantWishesTab' },
  { id: 'D7b', file: 'gift-wishes-text', title: '礼物许愿纯文字样式与动态占位符', feature: 'otherGiftFeature', click: '#giftAssistantWishesTab', clip: '#giftWishesPanel', setup: async (page) => { await page.locator('#giftWishDisplayStyle').selectOption('text'); await page.locator('#giftWishTextTemplate').fill('许愿{礼物}（{已收}/{目标}），谢谢大家的支持！'); } },
  { id: 'D8', file: 'gift-blindbox-analysis', title: '盲盒盈亏分析工作区', main: 'giftAssistantPage', click: '#blindBoxAnalysisOpenBtn' },
  { id: 'D8b', file: 'gift-blindbox-boxes', title: '盲盒盈亏分析：按盲盒看', main: 'giftAssistantPage', click: ['#blindBoxAnalysisOpenBtn', '[data-blind-analysis-view="boxes"]'] },
  { id: 'D8c', file: 'gift-blindbox-records', title: '盲盒盈亏分析：开盒记录', main: 'giftAssistantPage', click: ['#blindBoxAnalysisOpenBtn', '[data-blind-analysis-view="records"]'] },
  { id: 'D9', file: 'gift-blindbox-leaderboard-settings', title: '盲盒盈亏榜标题、人数与筛选', main: 'giftAssistantPage', scroll: '#blindboxOverlayTitle' },
  { id: 'D10', file: 'gift-sprint', title: '月底冲刺目标、进度与重置本轮', main: 'giftAssistantPage', scroll: '#giftSprintTargetRmb' },
  { id: 'E1', file: 'toolbox-nav', title: '百宝箱导航：直播互动、直播画面与主播工作', main: 'otherAssistantPage' },
  { id: 'E1b', file: 'toolbox-nav-help', title: '百宝箱导航：软件与帮助', feature: 'otherUsageGuideFeature', mustShow: ['[data-other-feature="otherSettingsFeature"]', '[data-other-feature="otherDesktopUpdateFeature"]'] },
  { id: 'E2', file: 'danmaku-connection', title: '弹幕姬连接状态（未登录、未设置直播间）', feature: 'otherDanmakuFeature' },
  { id: 'E3', file: 'danmaku-styles', title: '六种固定样式与三种全屏随机样式', feature: 'otherDanmakuFeature', clip: '.danmaku-style-picker' },
  { id: 'E4', file: 'danmaku-send', title: '弹幕输入、发送与自动钓鱼入口', feature: 'otherDanmakuFeature', clip: '.danmaku-compose-section' },
  { id: 'E5', file: 'danmaku-blacklist', title: '用户黑名单与敏感词屏蔽（示例数据）', feature: 'otherDanmakuFeature', clip: '#danmakuOverlayFilters' },
  { id: 'E6', file: 'danmaku-params', title: '深色面板字体、颜色与透明度', feature: 'otherDanmakuFeature', clip: '.danmaku-parameters' },
  { id: 'E6b', file: 'danmaku-random-params', title: '全屏随机样式停留时间与应用按钮', feature: 'otherDanmakuFeature', click: '[data-danmaku-style="outline"]', scroll: '.danmaku-parameters', mustShow: ['#danmakuFullscreenDurationSeconds', '#danmakuApplyOverlayBtn'] },
  { id: 'E6c', file: 'danmaku-apply-style', title: '深色面板参数与应用到直播画面', feature: 'otherDanmakuFeature', scroll: '.danmaku-parameters', mustShow: ['#danmakuApplyOverlayBtn'] },
  { id: 'E7', file: 'ai-assistant-config', title: 'AI 互动助手配置（未填写密钥）', feature: 'otherDanmakuFeature', clip: '#xiaomiAiSection' },
  { id: 'E7b', file: 'ai-assistant-provider-menu', title: 'AI 平台选择（展开下拉框）', feature: 'otherDanmakuFeature', scroll: '#xiaomiAiTitle', click: '#xiaomiAiModelProvider-trigger', mustShow: ['#xiaomiAiModelProvider-trigger'] },
  { id: 'E8', file: 'dynamic-lottery-setup', title: '动态抽奖设置（未登录）', feature: 'otherDynamicLotteryFeature' },
  { id: 'E10', file: 'toolbox-games', title: '小游戏入口与启动设置', feature: 'otherGamesFeature' },
  { id: 'E10d', file: 'toolbox-draw-guess', title: '你画我猜回合与题库设置', feature: 'otherGamesFeature', click: '#drawCardTrigger', scroll: '[data-game-card="draw-guess"]', mustShow: ['#drawTotalRounds', '#drawRoundDuration'] },
  { id: 'E10f', file: 'toolbox-draw-board', title: '你画我猜主持区、快捷键与开始入口（未开局）', feature: 'otherGamesFeature', click: '#drawCardTrigger', scroll: '#drawHostTitle', mustShow: ['[data-start-game="draw-guess"]'] },
  { id: 'E10e', file: 'toolbox-wheel', title: '转盘内容、份数与独立网页入口', feature: 'otherGamesFeature', click: '#wheelCardTrigger', scroll: '#wheelCategoryTitle', mustShow: ['#wheelOverlayUrl', '#wheelSaveBtn', '#wheelSpinBtn'] },
  { id: 'E10b', file: 'toolbox-voting', title: '投票与评分设置', feature: 'otherGamesFeature', clip: '#interactionsAdmin' },
  { id: 'E11', file: 'toolbox-overtime-rule', title: '加班机礼物规则编辑', feature: 'otherOvertimeMachineFeature', clip: '#overtimeRules', setup: async (page) => { await page.locator('.overtime-rule-toggle').first().click(); } },
  { id: 'E11b', file: 'toolbox-overtime-controls', title: '加班机初始时间、启用与开始暂停', feature: 'otherOvertimeMachineFeature', mustShow: ['#overtimeApplyTimeBtn', '#overtimeStartBtn', '#overtimePauseBtn'] },
  { id: 'E11c', file: 'toolbox-overtime-settlements', title: '加班机最近结算与直播画面入口（暂无结算）', feature: 'otherOvertimeMachineFeature', wait: '#overtimeSettlements .overtime-settlement-empty', scroll: '#overtimeSettlements', mustShow: ['#overtimeSettlements'] },
  { id: 'E12', file: 'toolbox-gift-effects', title: '礼物特效 ID、测试与画面链接', feature: 'otherGiftEffectsFeature' },
  { id: 'E13', file: 'toolbox-planner', title: '主播工作台日历、备忘与待办', feature: 'otherDailyTodoFeature' },
  { id: 'E14', file: 'toolbox-desktop-update', title: '检查更新、自动更新与目录入口（演示状态）', feature: 'otherDesktopUpdateFeature' },
  { id: 'E14b', file: 'toolbox-update-download', title: '发现新版本与下载按钮（演示状态）', feature: 'otherDesktopUpdateFeature', update: { status: 'available', version: '5.0.4', canDownload: true, message: '发现新版本 5.0.4，可以下载更新。' } },
  { id: 'E14c', file: 'toolbox-update-ready', title: '重启并更新（演示状态）', feature: 'otherDesktopUpdateFeature', update: { status: 'downloaded', version: '5.0.4', canInstall: true, message: '更新已下载完成，重启后安装。' } },
  { id: 'E15', file: 'gift-frame-settings', title: '礼物边框金额、动效与预览', feature: 'otherGiftFeature' },
  { id: 'E16', file: 'gift-feed-settings', title: '滚动礼物分色、行数与滚动速率', feature: 'otherGiftFeature', click: '#giftAssistantDisplayTab' },
  { id: 'E17', file: 'toolbox-clock', title: '萌时钟六种风格与预览', feature: 'otherClockFeature' },
  { id: 'E18', file: 'toolbox-opening', title: '开播动画文案、画质与素材', feature: 'otherStartAnimationFeature' },
  { id: 'E18b', file: 'toolbox-opening-audio', title: '开播动画人物、音乐、音量与地址', feature: 'otherStartAnimationFeature', scroll: '#openingCharacterHeading', mustShow: ['#openingAudioVolume', '#openingCopyUrl'] },
  { id: 'E19', file: 'toolbox-fan-profiles', title: '粉丝档案入口与筛选', feature: 'otherFanProfilesFeature' },
  { id: 'E20', file: 'toolbox-settings', title: '账户与网站设置（示例账号）', feature: 'otherSettingsFeature' },
  { id: 'E21', file: 'toolbox-performance', title: '性能页与本机硬件入口', feature: 'otherPerformanceFeature' },
  { id: 'E10c', file: 'toolbox-rating', title: '观众评分范围与平均分显示设置', feature: 'otherGamesFeature', click: '#interactionRatingTab', clip: '#interactionsAdmin' },
  { id: 'E13b', file: 'toolbox-planner-event', title: '新建日程的日期、时间与分类', feature: 'otherDailyTodoFeature', setup: async (page) => { await page.locator('[data-event-new]').first().click(); await page.locator('#plannerEventTitle').fill('示例歌回'); await page.locator('#plannerEventTime').fill('20:00'); }, clip: '#plannerEventDialog' },
  { id: 'E19b', file: 'fan-profiles-settings', title: '粉丝档案设置：同步与备份', feature: 'otherFanProfilesFeature', click: '#fanSettingsTab' },
  { id: 'E19c', file: 'fan-profiles-create', title: '新建粉丝档案：基本信息上半部', feature: 'otherFanProfilesFeature', click: '#fanNewProfileButton', mustShow: ['#fanSaveButton'] },
  { id: 'E19i', file: 'fan-profiles-basic-tags', title: '新建粉丝档案：标签与特别关注', feature: 'otherFanProfilesFeature', click: '#fanNewProfileButton', setup: async (page) => { await page.locator('#fanEditorFields [name="tags"]').scrollIntoViewIfNeeded(); }, mustShow: ['#fanEditorFields [name="tags"]', '#fanEditorFields [name="favorite"]'] },
  { id: 'E19d', file: 'fan-profiles-management', title: '粉丝档案设置：档案管理', feature: 'otherFanProfilesFeature', click: '#fanSettingsTab', scroll: '#fanSettingsProfilesTitle', mustShow: ['[data-fan-action="suppressions"]', '[data-fan-action="archived"]', '[data-fan-action="delete-all"]'] },
  { id: 'E19e', file: 'fan-profiles-personal', title: '新建粉丝档案：生日与偏好', feature: 'otherFanProfilesFeature', click: ['#fanNewProfileButton', '#fanProfilePersonalTab'], size: [1440, 1100] },
  { id: 'E19f', file: 'fan-profiles-notes', title: '新建粉丝档案：记录与提醒', feature: 'otherFanProfilesFeature', click: ['#fanNewProfileButton', '#fanProfileNotesTab'], size: [1440, 1100] },
  { id: 'E19g', file: 'fan-profiles-detail', title: '选中粉丝后的档案详情', feature: 'otherFanProfilesFeature', click: '[data-fan-id]:first-child', mustShow: ['#fanDetail'] },
  { id: 'E19h', file: 'fan-profiles-reminders', title: '粉丝档案提醒页（暂无提醒）', feature: 'otherFanProfilesFeature', click: '#fanRemindersTab' },
  { id: 'E22', file: 'danmaku-reply-tools', title: '回复与辅助：签到、抽签、欢迎与 PK', feature: 'otherDanmakuFeature', scroll: '#danmakuFixedReplyTitle', size: [1440, 1040] },
  { id: 'E22b', file: 'danmaku-custom-reply', title: '自定义关键词与回复编辑', feature: 'otherDanmakuFeature', click: '[data-fixed-open="diy"]', scroll: '#danmakuCustomRepliesPanel' },
  { id: 'E22c', file: 'danmaku-welcome-settings', title: '进场欢迎参数与词库入口（演示草稿）', feature: 'otherDanmakuFeature', click: '[data-fixed-open="welcome"]', setup: async (page) => { await page.locator('#danmakuWelcomewelcomeDelaySeconds').fill('5'); await page.locator('#danmakuWelcomewelcomeMinHonorLevel').fill('10'); }, scroll: '#danmakuFixedEditorHeading', size: [1440, 1040] },
  { id: 'E22d', file: 'danmaku-pk-settings', title: 'PK 对手信息播报说明', feature: 'otherDanmakuFeature', click: '[data-fixed-open="pk"]', scroll: '#danmakuFixedReplyTitle' },
  { id: 'F2a', file: 'client-song-page-link', title: '客户端查看网页歌单入口', tab: 'importPage', clip: '#licenseSongSync' },
  { id: 'F2b', file: 'client-song-sync-result', title: '覆盖同步确认后的反馈（接口演示）', tab: 'importPage', setup: async (page) => { await page.locator('#licenseSyncSongsBtn').click(); await page.getByRole('button', { name: '覆盖同步', exact: true }).click(); await page.locator('#licenseSyncResult').filter({ hasText: '已同步' }).waitFor(); }, scroll: '#licenseSongSync' },
  { id: 'F3a', file: 'client-song-page-background', title: '客户端当前背景与恢复默认背景（示例图片）', tab: 'importPage', background: true, scroll: '#licenseSongBackground', mustShow: ['#licenseSongBgDeleteBtn', '#licenseSongBgPickBtn'] },
];

async function openLyricGroup(page, control) {
  const group = page.locator('.desktop-lyric-settings-group').filter({ has: page.locator(control) });
  if (!(await group.evaluate((el) => el.open))) await group.locator('summary').click();
  await group.evaluate((el) => el.scrollIntoView({ block: 'start' }));
}

async function capture(electronApp, shot) {
  const kind = shot.kind || 'admin';
  const size = shot.size || (kind === 'license' ? [1280, 800] : [1440, 900]);
  await electronApp.evaluate(async (_electron, { kind, size, license, catalog, update, background, musicAuth }) => {
    Object.assign(global.usageShots.fixture, { license: license || { state: 'needs_activation' },
      catalog: catalog || { status: 'ready' }, update: update || { status: 'idle' }, musicAuth: musicAuth === true,
      background: background ? { previewUrl: global.usageShots.baseUrl + '/img/overlays/danmaku-previews/cream.png', bytes: 10240, updatedAt: new Date().toISOString() } : null });
    await global.usageShots.open(kind, ...size);
  }, { kind, size, license: shot.license, catalog: shot.catalog, update: shot.update, background: shot.background, musicAuth: shot.musicAuth });
  const page = electronApp.windows().find((candidate) => !candidate.isClosed());
  page.setDefaultTimeout(4500);
  if (kind === 'admin') {
    await page.locator('#queueList .queue-row').first().waitFor();
    await tools.applyCovers(page, [{ selector: shot.keepPending ? '#toast' : '#pendingConfirmPopup, #toast', mode: 'hide' }]);
    await page.locator(`[data-main-page="${shot.main || (shot.feature ? 'otherAssistantPage' : 'songAssistantPage')}"]`).click();
  }
  if (shot.feature) await page.locator(`[data-other-feature="${shot.feature}"]`).click();
  if (shot.tab) await page.locator(`[data-tab="${shot.tab}"]`).click();
  if (shot.main === 'playbackAssistantPage') await page.locator('[data-source="qq"]').click();
  for (const selector of shot.click ? [shot.click].flat() : []) await page.locator(selector).click();
  if (shot.setup) await shot.setup(page);
  if (shot.hover) await page.locator(shot.hover).hover();
  if (shot.wait) await page.locator(shot.wait).first().waitFor();
  await tools.settle(page, 200);
  if (shot.scroll) {
    await page.locator(shot.scroll).first().evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await tools.settle(page, 80);
  }
  if (shot.clip) {
    const height = await page.locator(shot.clip).evaluate((el) => Math.ceil(el.getBoundingClientRect().height));
    if (height > size[1] - 150) {
      await electronApp.evaluate(({ BrowserWindow }, height) => BrowserWindow.getAllWindows()[0].setContentSize(1440, height + 170), height);
    }
    await page.locator(shot.clip).scrollIntoViewIfNeeded();
    await tools.settle(page, 80);
  }
  for (const selector of shot.mustShow || []) {
    const visible = await page.locator(selector).evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) return false;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (!/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue;
        const bounds = parent.getBoundingClientRect();
        if (r.top < bounds.top || r.bottom > bounds.bottom) return false;
      }
      return true;
    });
    if (!visible) throw new Error(`Required control is clipped: ${selector}`);
  }
  await tools.injectAnnotations(page, (shot.annotations || []).map((selector, index) => ({ selector, label: index + 1 })));
  const group = shot.id[0];
  const outFile = path.join(OUT_ROOT, 'png', group, `${shot.file}.png`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (shot.clip) await page.locator(shot.clip).screenshot({ path: outFile, scale: 'css' });
  else await page.screenshot({ path: outFile, scale: 'css' });
  const result = { id: shot.id, group, file: shot.file, title: shot.title, ...tools.pngSize(outFile), runtime: 'Electron 43 + real preload + isolated fixture' };
  const reportPath = path.join(OUT_ROOT, 'supplement-results.json');
  const results = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : [];
  fs.writeFileSync(reportPath, JSON.stringify([...results.filter((item) => item.id !== result.id), result], null, 2));
  return result;
}

async function main() {
  const { _electron } = require('playwright');
  const selectedIds = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
  const app = await _electron.launch({ args: [path.join(__dirname, 'electron-fixture.cjs')], timeout: 30000 });
  try {
    await app.evaluate(async () => {
      for (let attempt = 0; attempt < 150; attempt++) {
        if (global.usageShots) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Screenshot fixture did not start');
    });
    for (const shot of SHOTS.filter((item) => !selectedIds || selectedIds.includes(item.id))) {
      try { console.log('[ok]', JSON.stringify(await capture(app, shot))); }
      catch (error) { console.error('[fail]', shot.id, error.message); process.exitCode = 1; }
    }
  } finally { await app.close(); }
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { SHOTS, capture };
