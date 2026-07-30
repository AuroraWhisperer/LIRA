// 从 HAR 中提取 get_recommend_feed 的完整响应并打印结构
// 用法: node dump-feed.js
const fs = require('fs');

let raw = fs.readFileSync('qq-music.har', 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
const har = JSON.parse(raw);

function bodyOf(entry) {
  const pd = entry.request.postData || {};
  return pd.text || (pd.params || []).map(p => p.value || '').join('');
}

const entry = har.log.entries.find(e => bodyOf(e).indexOf('get_recommend_feed') !== -1);
if (!entry) {
  console.log('未找到 get_recommend_feed 请求');
  process.exit(0);
}

console.log('=== 请求 ===');
console.log(entry.request.method, entry.request.url);
console.log(bodyOf(entry));

let text = entry.response.content.text || '';
if (entry.response.content.encoding === 'base64') {
  text = Buffer.from(text, 'base64').toString('utf8');
}
console.log('\n=== 响应 ===');
console.log('长度:', text.length);

const json = JSON.parse(text);
const data = json.req_1.data;
console.log('req_1.code:', json.req_1.code);
console.log('data 字段:', Object.keys(data).join(', '));

const shelves = data.v_shelf || [];
console.log('v_shelf 数量:', shelves.length);

shelves.forEach((shelf, i) => {
  console.log(`\n--- shelf[${i}] id=${shelf.id} title=${JSON.stringify(shelf.title_template)}`);
  console.log('    字段:', Object.keys(shelf).join(', '));
  (shelf.v_niche || []).forEach((niche, k) => {
    const cards = niche.v_card || [];
    console.log(`    niche[${k}] id=${niche.id} cards=${cards.length}`);
    if (cards[0]) {
      console.log('      card[0] 字段:', Object.keys(cards[0]).join(', '));
      console.log('      card[0]:', JSON.stringify(cards[0]).substring(0, 600));
    }
  });
});

fs.writeFileSync('recommend-feed-response.json', JSON.stringify(json, null, 2));
console.log('\n完整响应已写入 recommend-feed-response.json');
