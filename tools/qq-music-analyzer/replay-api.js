// API重放器 - 重放捕获的请求来验证参数和认证方式
// 使用方法：node replay-api.js <request-index>

const fs = require('fs');
const path = require('path');

const REPORT_FILE = path.join(__dirname, 'analysis-report.json');

async function replayRequest(index) {
  if (!fs.existsSync(REPORT_FILE)) {
    console.error('分析报告不存在，请先运行: node analyze-requests.js');
    return;
  }

  const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
  const candidates = report.topCandidates || [];

  if (index < 0 || index >= candidates.length) {
    console.error(`无效的索引。可用范围: 0-${candidates.length - 1}`);
    console.log('\n可用的候选API:');
    candidates.slice(0, 10).forEach((c, i) => {
      console.log(`[${i}] ${c.url.substring(0, 80)}... (分数: ${c.score})`);
    });
    return;
  }

  const candidate = candidates[index];
  console.log(`\n重放请求 [${index}]:`);
  console.log(`URL: ${candidate.url}`);
  console.log(`方法: ${candidate.method}`);
  console.log(`原始状态码: ${candidate.statusCode}`);

  try {
    const response = await fetch(candidate.url, {
      method: candidate.method,
      headers: candidate.requestHeaders || {}
    });

    const text = await response.text();

    console.log(`\n新请求状态码: ${response.status}`);
    console.log(`响应长度: ${text.length} 字符`);

    // 尝试解析JSON
    try {
      const json = JSON.parse(text);
      console.log('\n响应数据结构:');
      console.log(JSON.stringify(json, null, 2).substring(0, 1000));

      // 检查是否包含歌单数据
      const str = JSON.stringify(json);
      if (str.includes('disslist') || str.includes('v_hot') || str.includes('content_id')) {
        console.log('\n✓ 响应包含歌单数据！');
      }
    } catch (e) {
      console.log('\n响应不是JSON格式');
      console.log(text.substring(0, 500));
    }

  } catch (error) {
    console.error(`\n重放失败: ${error.message}`);
  }
}

const index = parseInt(process.argv[2]);
if (isNaN(index)) {
  console.log('使用方法: node replay-api.js <request-index>');
  console.log('例如: node replay-api.js 0');
  process.exit(1);
}

replayRequest(index);
