'use strict';

const { parseCustomReplyRules } = require('../bilibili/custom-reply-service');

function buildDesktopMenuCommands({ settings = {}, ai = {}, game = null, interaction = null } = {}) {
  if ((settings.danmakuMonitoringEnabled ?? settings.enableBilibili) !== 'true') return [];
  const commands = [];
  if (settings.paused !== 'true') commands.push('点歌 歌名', '随机点歌 [条件]');
  if (settings.enableCustomReplyBot === 'true' && parseCustomReplyRules(settings.customReplyRules).some((rule) => rule.enabled)) {
    commands.push('关键词回复（发送已设置关键词）');
  }
  if (ai.ready === true && ai.trigger) commands.push(`${ai.trigger} 问题（AI 互动）`);
  if (interaction?.phase === 'collecting' && interaction.connected) {
    commands.push(interaction.kind === 'poll'
      ? '投票（进行中）：完整发送当前选项'
      : '评分（进行中）：发送 1—10');
  }
  if (game?.game === 'draw-guess' && game.state?.phase === 'drawing') {
    commands.push('你画我猜（进行中）：发送答案');
  } else if (game?.state && !game.state.winner && game.state.turn === 'viewer') {
    if (game.game === 'gomoku') commands.push('五子棋（进行中）：发送坐标 A1—O15');
    if (game.game === 'number-bomb') commands.push('数字炸弹（进行中）：发送当前范围内数字');
  }
  return commands;
}

module.exports = { buildDesktopMenuCommands };
