// 分析捕获的请求日志，找出推荐歌单相关的API
// 使用方法：node analyze-requests.js

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'captured-requests.jsonl');
const OUTPUT_FILE = path.join(__dirname, 'analysis-report.json');

// 关键词匹配
const KEYWORDS = {
  recommend: ['recommend', 'recom', '推荐'],
  playlist: ['playlist', 'diss', '歌单'],
  hot: ['hot', '热门', 'popular'],
  personalized: ['personal', '个性化', 'custom'],
  daily: ['daily', '每日', 'today'],
  discover: ['discover', '发现', 'explore']
};

function analyzeRequests() {
  if (!fs.existsSync(LOG_FILE)) {
    console.error(`日志文件不存在: ${LOG_FILE}`);
    console.log('请先运行 proxy-server.js 并使用QQ音乐客户端浏览推荐歌单');
    return;
  }

  const content = fs.readFileSync(LOG_FILE, 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);

  if (lines.length === 0) {
    console.log('日志文件为空，请确保：');
    console.log('1. proxy-server.js 正在运行');
    console.log('2. 系统代理已设置为 127.0.0.1:8888');
    console.log('3. 已在QQ音乐客户端中浏览推荐歌单');
    return;
  }

  console.log(`\n总共捕获 ${lines.length} 个请求\n`);

  const requests = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      console.warn(`解析第 ${index + 1} 行失败`);
      return null;
    }
  }).filter(Boolean);

  // 按URL分组统计
  const urlCounts = {};
  requests.forEach(req => {
    const cleanUrl = req.url.split('?')[0];
    urlCounts[cleanUrl] = (urlCounts[cleanUrl] || 0) + 1;
  });

  console.log('=== URL统计 (前20个最频繁的请求) ===');
  Object.entries(urlCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([url, count]) => {
      console.log(`${count}x - ${url}`);
    });

  // 查找推荐相关的请求
  const candidates = [];

  requests.forEach(req => {
    const urlLower = req.url.toLowerCase();
    const bodyLower = (req.responseBody || '').toLowerCase();
    const fullText = urlLower + ' ' + bodyLower;

    let score = 0;
    let matchedKeywords = [];

    // 评分系统
    Object.entries(KEYWORDS).forEach(([category, keywords]) => {
      keywords.forEach(keyword => {
        if (fullText.includes(keyword)) {
          score += 10;
          matchedKeywords.push(`${category}:${keyword}`);
        }
      });
    });

    // URL路径中包含关键词加分
    if (urlLower.includes('musicu.fcg')) score += 5;
    if (urlLower.includes('splcloud')) score += 3;

    // 响应包含歌单结构
    if (bodyLower.includes('disslist') || bodyLower.includes('v_hot')) score += 15;
    if (bodyLower.includes('content_id') && bodyLower.includes('title')) score += 10;

    // 响应是JSON
    try {
      const json = JSON.parse(req.responseBody || '{}');
      if (json.code === 0 || json.code === '0') score += 5;
    } catch (e) {}

    if (score > 0) {
      candidates.push({
        score,
        matchedKeywords,
        method: req.method,
        url: req.url,
        statusCode: req.statusCode,
        timestamp: req.timestamp,
        requestHeaders: req.requestHeaders,
        responsePreview: (req.responseBody || '').substring(0, 500)
      });
    }
  });

  // 按分数排序
  candidates.sort((a, b) => b.score - a.score);

  console.log(`\n=== 推荐API候选 (找到 ${candidates.length} 个相关请求) ===\n`);

  candidates.slice(0, 10).forEach((candidate, index) => {
    console.log(`\n[${index + 1}] 分数: ${candidate.score}`);
    console.log(`URL: ${candidate.url}`);
    console.log(`匹配关键词: ${candidate.matchedKeywords.join(', ')}`);
    console.log(`状态码: ${candidate.statusCode}`);
    console.log(`时间: ${candidate.timestamp}`);

    // 尝试提取musicu的module/method
    if (candidate.url.includes('musicu.fcg')) {
      try {
        const urlObj = new URL(candidate.url);
        const dataParam = urlObj.searchParams.get('data');
        if (dataParam) {
          const data = JSON.parse(dataParam);
          console.log(`Module/Method:`);
          Object.keys(data).forEach(key => {
            if (key !== 'comm' && data[key].module) {
              console.log(`  ${key}: ${data[key].module}.${data[key].method}`);
            }
          });
        }
      } catch (e) {}
    }

    console.log('---');
  });

  // 保存完整报告
  const report = {
    analyzedAt: new Date().toISOString(),
    totalRequests: requests.length,
    urlCounts,
    topCandidates: candidates.slice(0, 20)
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
  console.log(`\n完整报告已保存到: ${OUTPUT_FILE}`);

  // 提取Cookie和认证信息
  console.log('\n=== 认证信息提取 ===');
  const authHeaders = new Set();
  const cookies = new Set();

  candidates.slice(0, 5).forEach(candidate => {
    if (candidate.requestHeaders) {
      if (candidate.requestHeaders.cookie) {
        candidate.requestHeaders.cookie.split(';').forEach(c => {
          cookies.add(c.trim().split('=')[0]);
        });
      }
      Object.keys(candidate.requestHeaders).forEach(header => {
        if (header.toLowerCase().includes('auth') ||
            header.toLowerCase().includes('token') ||
            header.toLowerCase() === 'qm-token') {
          authHeaders.add(header);
        }
      });
    }
  });

  console.log('Cookie字段:', Array.from(cookies).join(', ') || '(无)');
  console.log('认证头:', Array.from(authHeaders).join(', ') || '(无)');
}

analyzeRequests();
