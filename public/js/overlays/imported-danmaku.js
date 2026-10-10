import { createComponentPreviewClient, isSceneComponent } from './component-preview-client.js';
import { styleParametersFor } from '../shared/component-style-parameters.js';
import { createSceneDanmakuDisplay } from './scene-danmaku-display.js';
import { createDanmakuPreviewItems, DANMAKU_PREVIEW_ENTRY } from './danmaku-preview-samples.js';

const host = document.getElementById('app');
let engine = '';
let currentConfig = {};
let items;
let previewTimer;
let previewIndex = 0;
const previewMessages = createDanmakuPreviewItems();
function node(tag, className = '', id = '', text = '') {
  const element = document.createElement(tag);
  element.className = className;
  if (id) element.id = id;
  if (text) element.textContent = text;
  return element;
}
function image(url, className = '') {
  if (typeof url !== 'string' || !/^(?:https?:\/\/|\/(?!\/))/.test(url)) return null;
  const element = node('img', className); element.src = url; element.alt = ''; element.referrerPolicy = 'no-referrer';
  return element;
}
function messageContent(element, item) {
  const text = String(item.message || '');
  const emotes = (item.emotes || []).filter(emote => emote?.text && emote?.url);
  let offset = 0;
  while (offset < text.length) {
    const match = emotes.map(emote => ({ emote, index: text.indexOf(emote.text, offset) }))
      .filter(entry => entry.index >= 0).sort((a, b) => a.index - b.index)[0];
    if (!match) { element.append(document.createTextNode(text.slice(offset))); break; }
    element.append(document.createTextNode(text.slice(offset, match.index)));
    const art = image(match.emote.url, 'emoji yt-formatted-string style-scope yt-live-chat-text-message-renderer');
    if (art) { art.alt = match.emote.text; element.append(art); }
    else element.append(document.createTextNode(match.emote.text));
    offset = match.index + match.emote.text.length;
  }
}
function append(item) {
  if (!items) return;
  const name = String(item.name || '观众');
  const authorType = item.isStreamer ? 'owner' : item.isAdmin ? 'moderator' : item.guardLevel > 0 ? 'member' : '';
  let row;
  if (engine === 'blc') {
    row = node('div', 'danmaku-item');
    const avatar = image(item.avatarUrl, 'danmaku-author-face'); if (avatar) row.append(avatar);
    const content = node('div', 'danmaku-content');
    content.append(node('span', `danmaku-author-name with-colon${item.isStreamer ? ' anchor' : ''}${item.isAdmin ? ' owner' : ''}`, '', name));
    const message = node('span', 'danmaku-message'); messageContent(message, item); content.append(message); row.append(content);
  } else {
    const tag = item.kind === 'superchat' ? 'yt-live-chat-paid-message-renderer' : 'yt-live-chat-text-message-renderer';
    const scope = `style-scope ${tag}`;
    row = node(tag, 'style-scope yt-live-chat-item-list-renderer');
    row.setAttribute('author-type', authorType); row.setAttribute('blc-guard-level', String(item.guardLevel || 0));
    const photo = node('yt-img-shadow', scope, 'author-photo');
    const avatar = image(item.avatarUrl, 'style-scope yt-img-shadow'); if (avatar) { avatar.id = 'img'; photo.append(avatar); }
    const content = node('div', scope, 'content');
    content.append(node('span', scope, 'timestamp', new Date(item.timestamp || Date.now()).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })));
    const chip = node('yt-live-chat-author-chip', scope);
    const author = node('span', 'style-scope yt-live-chat-author-chip', 'author-name', name);
    author.setAttribute('type', authorType); chip.append(author, node('span', 'style-scope yt-live-chat-author-chip', 'chat-badges'));
    const message = node('span', scope, 'message'); messageContent(message, item);
    if (item.kind === 'superchat') {
      const header = node('div', scope, 'header'); const details = node('div', scope, 'header-content');
      details.append(chip, node('span', scope, 'purchase-amount', `¥${item.price || item.amount || 0}`)); header.append(photo, details);
      row.append(header, message);
    } else { content.append(chip, message); row.append(photo, content); }
  }
  if (item.kind === 'superchat' && item.messageId) row.dataset.superchatMessageId = item.messageId;
  items.append(row);
  while (items.children.length > 100) items.firstElementChild.remove();
  items.parentElement.scrollTop = items.parentElement.scrollHeight;
}
function removeSuperChats(messageIds) {
  const deleted = new Set(messageIds);
  for (const row of Array.from(items?.children || [])) {
    if (deleted.has(row.dataset.superchatMessageId)) row.remove();
  }
}
const display = createSceneDanmakuDisplay({ clear: () => items?.replaceChildren(), append, remove: removeSuperChats, status() {}, getStyle: () => 'transparent', showEntryMessages: () => styleParametersFor(currentConfig).showEntryMessages === true });
function samples() {
  return styleParametersFor(currentConfig).showEntryMessages
    ? [...previewMessages, { ...DANMAKU_PREVIEW_ENTRY }] : previewMessages;
}
function playSample() {
  clearTimeout(previewTimer);
  if (isSceneComponent() || document.hidden || !items) return;
  const messages = samples();
  append(messages[previewIndex++ % messages.length]);
  previewTimer = setTimeout(playSample, 1500);
}
function renderSamples() {
  if (isSceneComponent()) return;
  clearTimeout(previewTimer);
  items.replaceChildren();
  previewIndex = 0;
  for (const item of samples()) append(item);
  if (!document.hidden) previewTimer = setTimeout(playSample, 1500);
}
if (!isSceneComponent()) document.addEventListener('visibilitychange', playSample);
createComponentPreviewClient({
  onConfig(config) {
    const next = config.cssStyle?.engine;
    if (!['blivechat', 'blc'].includes(next)) return false;
    currentConfig = config;
    if (engine === next) { renderSamples(); return; }
    engine = next; host.replaceChildren();
    if (engine === 'blc') {
      const live = node('div', '', 'live'); items = node('div', 'danmaku-list'); live.append(items); host.append(live);
    } else {
      const chat = node('yt-live-chat-renderer'); const list = node('yt-live-chat-item-list-renderer', 'style-scope yt-live-chat-renderer');
      const scroller = node('div', 'style-scope yt-live-chat-item-list-renderer', 'item-scroller');
      items = node('div', 'style-scope yt-live-chat-item-list-renderer', 'items');
      scroller.append(items); list.append(scroller); chat.append(list); host.append(chat);
    }
    renderSamples();
  },
  onData: display.update,
  onDispose() {
    clearTimeout(previewTimer);
    document.removeEventListener('visibilitychange', playSample);
    host.replaceChildren();
  },
});
