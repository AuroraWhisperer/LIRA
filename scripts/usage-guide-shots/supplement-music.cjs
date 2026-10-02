'use strict';

async function openLyricGroup(page, control) {
  const group = page.locator('.desktop-lyric-settings-group').filter({ has: page.locator(control) });
  if (!(await group.evaluate((el) => el.open))) await group.locator('summary').click();
  await group.evaluate((el) => el.scrollIntoView({ block: 'start' }));
}

const SHOTS = [
  { id: 'B1', file: 'song-queue-overview', title: '点歌与 SC 队列总览' },
  {
    id: 'B2',
    file: 'song-queue-item-actions',
    title: '队列条目：置顶、复制歌名和删除',
    annotations: [
      '#queueList .queue-row:nth-child(2) .queue-actions button:nth-child(1)',
      '#queueList .queue-row:nth-child(2) .queue-actions button:nth-child(2)',
      '#queueList .queue-row:nth-child(2) .queue-actions button:nth-child(3)',
    ],
  },
  { id: 'B3', file: 'song-library-list', title: '歌库列表、搜索与筛选', scroll: '#songSearch' },
  { id: 'B4', file: 'song-library-edit', title: '新增歌曲表单与可点开关', clip: '#songForm' },
  {
    id: 'B5',
    file: 'song-settings-account',
    title: '直播账号登录入口（未登录）',
    tab: 'settingsPage',
    scroll: '#bilibiliLoginBtn',
  },
  {
    id: 'B6',
    file: 'song-settings-room',
    title: '连接直播间设置（未配置）',
    tab: 'settingsPage',
    clip: '#settingsForm',
  },
  {
    id: 'B7',
    file: 'song-settings-rules',
    title: '接收消息与点歌规则',
    tab: 'settingsPage',
    scroll: '#enableBilibili',
  },
  { id: 'B8', file: 'song-theme-styles', title: '点歌板六种风格', tab: 'themePage', scroll: '#themePage' },
  { id: 'B9', file: 'song-theme-detail', title: '点歌板文字与滚动设置', tab: 'themePage', clip: '#classicThemeArea' },
  {
    id: 'B10',
    file: 'song-board-settings',
    title: '展示板排序、滚动与主题设置',
    tab: 'displayPage',
    clip: '#displayPage',
  },
  {
    id: 'B11',
    file: 'song-overlay-addresses',
    title: '浏览器源上半页：点歌与音乐',
    tab: 'overlayPage',
    setup: async (page) => {
      await page.locator('#overlayPage').evaluate((el) => {
        const scroller = el.closest('.song-workspace');
        scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 60;
      });
    },
    mustShow: ['#queueUrl', '#songsUrl', '#lyricsUrl', '[data-tab="overlayPage"]'],
  },
  {
    id: 'B11b',
    file: 'song-overlay-addresses-scene',
    title: '浏览器源下半页：场景与氛围',
    tab: 'overlayPage',
    scroll: '#sceneOverlayGroupTitle',
    mustShow: ['#liveOvertimeUrl', '#liveClockUrl', '[data-copy-url="liveClockUrl"]'],
  },
  {
    id: 'B12',
    file: 'song-import-export',
    title: '下载模板、导入与导出歌库',
    tab: 'importPage',
    scroll: '#importPage',
  },
  {
    id: 'B12b',
    file: 'song-import-result',
    title: '粘贴表格后的实际导入结果（隔离歌库）',
    tab: 'importPage',
    setup: async (page) => {
      await page
        .locator('#importText')
        .fill(
          '歌曲名字\t原唱/首发歌手\t歌曲分类\t歌曲标签\t是否可点\t语言\t点歌价格\n说明用示例歌曲\t示例歌手\t示例\t文档\t是\t华语\t免费',
        );
      await page.locator('#importBtn').click();
      await page
        .locator('#importResult')
        .filter({ hasText: /成功|导入|跳过/ })
        .waitFor();
    },
    scroll: '#importBtn',
    mustShow: ['#importResult'],
  },
  {
    id: 'B14',
    file: 'song-request-confirmation',
    title: '点歌匹配后的下一首播放与跳过通知（示例请求）',
    keepPending: true,
    wait: '#pendingConfirmPopup.visible',
    annotations: ['#pendingConfirmAcceptBtn', '#pendingConfirmRejectBtn'],
  },
  {
    id: 'B13',
    file: 'desktop-lyric-appearance',
    title: '桌面歌词基础字体设置',
    tab: 'desktopLyricPage',
    size: [1440, 1040],
    scroll: '.desktop-lyric-settings-group.is-basic',
  },
  {
    id: 'B13b',
    file: 'desktop-lyric-stroke',
    title: '桌面歌词描边与阴影',
    tab: 'desktopLyricPage',
    setup: (page) => openLyricGroup(page, '#desktopLyricStrokeEnabled'),
  },
  {
    id: 'B13c',
    file: 'desktop-lyric-karaoke',
    title: '桌面歌词逐字高亮与翻译',
    tab: 'desktopLyricPage',
    setup: (page) => openLyricGroup(page, '#desktopLyricKaraokeMode'),
  },
  {
    id: 'B13d',
    file: 'desktop-lyric-opacity',
    title: '桌面歌词可见性与时间偏移',
    tab: 'desktopLyricPage',
    setup: (page) => openLyricGroup(page, '#desktopLyricTimeOffsetMs'),
    size: [1440, 1040],
  },
  {
    id: 'B13e',
    file: 'desktop-lyric-rendering',
    title: '桌面歌词背景与整体透明度',
    tab: 'desktopLyricPage',
    setup: (page) => openLyricGroup(page, '#desktopLyricGlobalOpacity'),
  },
  {
    id: 'C1',
    file: 'playback-platform-tabs',
    title: '三个音乐平台与登录入口（未登录）',
    main: 'playbackAssistantPage',
  },
  {
    id: 'C2',
    file: 'playback-search',
    title: '在线搜索与结果条数',
    main: 'playbackAssistantPage',
    clip: 'section.panel:has(#playbackSearchKeyword)',
  },
  {
    id: 'C3',
    file: 'playback-wesing-cache',
    title: '全民 K 歌缓存目录与歌词时间调整',
    main: 'playbackAssistantPage',
    click: '[data-source="wesing"]',
    scroll: '#weSingCachePath',
  },
  {
    id: 'C4',
    file: 'playback-player-bar',
    title: '播放器控制栏（示例曲目，未播放）',
    main: 'playbackAssistantPage',
    click: '#playerDockToggle',
    clip: '#playbackPlayerBody',
  },
  {
    id: 'C6',
    file: 'playback-queue-drawer',
    title: '播放队列、导入点歌与清空',
    main: 'playbackAssistantPage',
    click: ['#playerDockToggle', '#playbackQueueBtn'],
    annotations: ['#playbackImportSongQueue', '#playbackClearQueue'],
  },
  {
    id: 'C7',
    file: 'playback-desktop-lyric-preview',
    title: '桌面歌词预览与浏览器源（等待播放）',
    tab: 'desktopLyricPage',
    clip: '#desktopLyricLivePreview',
  },
  {
    id: 'C8',
    file: 'playback-content-drawer',
    title: '最近播放的内容抽屉（登录状态与历史演示）',
    main: 'playbackAssistantPage',
    musicAuth: true,
    click: '[data-playback-home-action="recent"]',
    wait: '#playbackDrawer.open',
    mustShow: ['#playbackDrawerTitle', '#playbackDrawerClose', '#playbackDrawerPlayAll'],
  },
  {
    id: 'C9',
    file: 'playback-match-diagnostic',
    title: '点歌匹配诊断（未找到候选的示例）',
    main: 'playbackAssistantPage',
    click: '.playback-match-panel summary',
    setup: async (page) => {
      await page.locator('#playbackMatchSong').fill('晴天');
      await page.locator('#playbackMatchArtist').fill('周杰伦');
      await page.locator('#playbackMatchBtn').click();
    },
    scroll: '.playback-match-panel',
    mustShow: ['#playbackMatchBtn', '#playbackMatchResults'],
  },
];

module.exports = { SHOTS };
