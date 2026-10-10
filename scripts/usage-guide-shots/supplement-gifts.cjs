'use strict';

const SHOTS = [
  { id: 'D1', file: 'gift-page-overview', title: '礼物统计与最近礼物', main: 'giftAssistantPage' },
  {
    id: 'D2',
    file: 'gift-auto-thanks',
    title: '自动答谢、礼物查询与服务器运行说明（演示设置）',
    main: 'giftAssistantPage',
    clip: '.gift-controls-grid',
  },
  {
    id: 'D3',
    file: 'gift-danmaku-query',
    title: '弹幕查询礼物统计开关（演示设置）',
    main: 'giftAssistantPage',
    clip: '.gift-controls-grid',
    annotations: ['#giftStatsQueryDescription'],
  },
  {
    id: 'D4',
    file: 'gift-recent-and-all',
    title: '最近礼物和查看全部入口',
    main: 'giftAssistantPage',
    clip: '.gift-recent-panel',
  },
  {
    id: 'D5',
    file: 'gift-history-drawer',
    title: '礼物历史筛选、已选记录与导出入口',
    main: 'giftAssistantPage',
    click: '#giftHistoryOpenBtn',
    setup: async (page) => {
      await page.locator('#giftHistoryBody input').first().check();
      await page.locator('#giftHistoryBody input').nth(1).check();
    },
    mustShow: ['#giftHistoryExport'],
  },
  {
    id: 'D6',
    file: 'gift-export-workspace',
    title: '礼物 PNG 导出预览与保存设置（界面演示）',
    main: 'giftAssistantPage',
    click: '#giftHistoryOpenBtn',
    setup: async (page) => {
      await page.locator('#giftHistoryBody input').first().check();
      await page.locator('#giftHistoryBody input').nth(1).check();
      await page.locator('#giftHistoryExport').click();
      await page.locator('#giftExportPanel').waitFor({ timeout: 5000 });
    },
  },
  {
    id: 'D7',
    file: 'gift-wishes',
    title: '礼物许愿三个周期与目标进度',
    feature: 'otherGiftFeature',
    click: '#giftAssistantWishesTab',
  },
  {
    id: 'D7b',
    file: 'gift-wishes-text',
    title: '礼物许愿纯文字样式与动态占位符',
    feature: 'otherGiftFeature',
    click: '#giftAssistantWishesTab',
    clip: '#giftWishesPanel',
    setup: async (page) => {
      await page.getByRole('radio', { name: '文字版', exact: true }).check();
      await page.locator('#giftWishTextEditor').press('Control+End');
      await page.keyboard.insertText('，谢谢大家的支持！');
    },
  },
  {
    id: 'D8',
    file: 'gift-blindbox-analysis',
    title: '盲盒盈亏分析工作区',
    main: 'giftAssistantPage',
    click: '#blindBoxAnalysisOpenBtn',
  },
  {
    id: 'D8b',
    file: 'gift-blindbox-boxes',
    title: '盲盒盈亏分析：按盲盒看',
    main: 'giftAssistantPage',
    click: ['#blindBoxAnalysisOpenBtn', '[data-blind-analysis-view="boxes"]'],
  },
  {
    id: 'D8c',
    file: 'gift-blindbox-records',
    title: '盲盒盈亏分析：开盒记录',
    main: 'giftAssistantPage',
    click: ['#blindBoxAnalysisOpenBtn', '[data-blind-analysis-view="records"]'],
  },
  {
    id: 'D9',
    file: 'gift-blindbox-leaderboard-settings',
    title: '盲盒盈亏榜标题、人数与筛选',
    main: 'liveComponentsPage',
    click: ['#giftAssistantBlindboxTab'],
    scroll: '#blindboxOverlayTitle',
  },
  {
    id: 'D10',
    file: 'gift-sprint',
    title: '月底冲刺目标、进度与重置本轮',
    main: 'liveComponentsPage',
    click: ['#giftAssistantSprintTab'],
    scroll: '#giftSprintTargetRmb',
  },
];

module.exports = { SHOTS };
