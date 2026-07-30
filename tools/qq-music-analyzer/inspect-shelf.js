// 检查 shelf 的刷新参数与 card 的有效字段
const fs = require('fs');
const json = JSON.parse(fs.readFileSync('recommend-feed-response.json', 'utf8'));
const data = json.req_1.data;

console.log('load_mark:', JSON.stringify(data.load_mark));
console.log('d_num:', JSON.stringify(data.d_num));
console.log('ext:', JSON.stringify(data.ext).substring(0, 300));

data.v_shelf.forEach((shelf, i) => {
  console.log(`\n======== shelf[${i}] id=${shelf.id} ${shelf.title_template}`);
  console.log('refresh_param:', JSON.stringify(shelf.refresh_param));
  console.log('more:', JSON.stringify(shelf.more));
  console.log('content_refresh:', JSON.stringify(shelf.content_refresh));
  console.log('replaceOpt:', JSON.stringify(shelf.replaceOpt));
  console.log('style:', JSON.stringify(shelf.style), '| group:', JSON.stringify(shelf.group));
  console.log('title_content:', JSON.stringify(shelf.title_content));
  console.log('extra_info:', JSON.stringify(shelf.extra_info).substring(0, 300));

  (shelf.v_niche || []).forEach((niche, k) => {
    console.log(`  -- niche[${k}] id=${niche.id} 字段: ${Object.keys(niche).join(', ')}`);
    console.log('     more:', JSON.stringify(niche.more));
    (niche.v_card || []).slice(0, 3).forEach((c, ci) => {
      console.log(`     card[${ci}] id=${c.id} subid=${c.subid} type=${c.type} subtype=${c.subtype} jumptype=${c.jumptype}`);
      console.log(`        title=${JSON.stringify(c.title)} subtitle=${JSON.stringify(c.subtitle)}`);
      console.log(`        cnt=${c.cnt} cover=${c.cover}`);
      console.log(`        scheme=${JSON.stringify(c.scheme)}`);
    });
  });
});
