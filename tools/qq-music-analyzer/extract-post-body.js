// 提取musics.fcg的POST body
const fs = require('fs');

const content = fs.readFileSync('captured-requests.jsonl', 'utf8');
const lines = content.trim().split('\n');

console.log('=== 查找 musics.fcg 的 POST 请求 ===\n');

lines.forEach((line, index) => {
  try {
    const req = JSON.parse(line);
    if (req.url.includes('musics.fcg') && req.method === 'POST') {
      console.log(`\n[${index + 1}] ${req.url.substring(0, 80)}...`);
      console.log(`时间: ${req.timestamp}`);
      console.log(`Referer: ${req.requestHeaders.referer}`);

      // 查找POST body - 可能在responseBody中（HAR格式问题）
      // 实际上POST body应该在request中，但Fiddler的HAR导出可能有问题

      // 尝试从响应中提取信息
      if (req.responseBody) {
        const body = req.responseBody.substring(0, 2000);
        console.log('\n响应预览:');
        console.log(body);

        // 尝试解析JSON响应
        try {
          const json = JSON.parse(body);
          if (json.req_1 && json.req_1.data) {
            console.log('\n✓ 找到推荐数据结构:');
            console.log(JSON.stringify(json.req_1.data, null, 2).substring(0, 1000));
          }
        } catch (e) {}
      }

      console.log('\n' + '='.repeat(80));
    }
  } catch (e) {}
});
