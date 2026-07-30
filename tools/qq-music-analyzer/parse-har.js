// HAR文件解析器 - 从Fiddler导出的HAR文件中提取请求
// 使用方法：node parse-har.js <har-file-path>

const fs = require('fs');
const path = require('path');

function parseHarFile(harPath) {
  if (!fs.existsSync(harPath)) {
    console.error(`文件不存在: ${harPath}`);
    return;
  }

  console.log(`正在解析: ${harPath}\n`);

  const harContent = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const entries = harContent.log?.entries || [];

  console.log(`总共找到 ${entries.length} 个请求\n`);

  // 过滤QQ音乐相关的请求
  const qqMusicRequests = entries.filter(entry => {
    const url = entry.request?.url || '';
    return url.includes('y.qq.com') ||
           url.includes('qqmusic.qq.com') ||
           url.includes('music.qq.com');
  });

  console.log(`QQ音乐相关请求: ${qqMusicRequests.length} 个\n`);

  // 转换为我们的格式
  const outputFile = path.join(__dirname, 'captured-requests.jsonl');
  const outputStream = fs.createWriteStream(outputFile);

  let count = 0;
  qqMusicRequests.forEach(entry => {
    const request = entry.request;
    const response = entry.response;

    // 提取请求头
    const requestHeaders = {};
    (request.headers || []).forEach(h => {
      requestHeaders[h.name.toLowerCase()] = h.value;
    });

    // 提取响应头
    const responseHeaders = {};
    (response.headers || []).forEach(h => {
      responseHeaders[h.name.toLowerCase()] = h.value;
    });

    // 提取响应体
    let responseBody = '';
    if (response.content && response.content.text) {
      responseBody = response.content.text;
      // 如果是base64编码，解码
      if (response.content.encoding === 'base64') {
        try {
          responseBody = Buffer.from(responseBody, 'base64').toString('utf8');
        } catch (e) {
          console.warn('base64解码失败');
        }
      }
    }

    const record = {
      timestamp: entry.startedDateTime,
      method: request.method,
      url: request.url,
      requestHeaders,
      statusCode: response.status,
      responseHeaders,
      responseBody: responseBody.substring(0, 50000) // 限制大小
    };

    outputStream.write(JSON.stringify(record) + '\n');
    count++;
  });

  outputStream.end();

  console.log(`已将 ${count} 个请求写入: ${outputFile}`);
  console.log('\n现在运行: node analyze-requests.js');

  // 快速预览
  console.log('\n=== 请求URL预览 (前20个) ===');
  qqMusicRequests.slice(0, 20).forEach((entry, i) => {
    const url = entry.request.url;
    const status = entry.response.status;
    const size = entry.response.content?.size || 0;
    console.log(`[${i + 1}] ${status} - ${size}B - ${url.substring(0, 100)}${url.length > 100 ? '...' : ''}`);
  });

  // 分析musicu.fcg请求
  console.log('\n=== musicu.fcg 请求详情 ===');
  const musicuRequests = qqMusicRequests.filter(e =>
    e.request.url.includes('musicu.fcg')
  );

  musicuRequests.slice(0, 5).forEach((entry, i) => {
    console.log(`\n[${i + 1}] ${entry.request.url}`);

    try {
      const url = new URL(entry.request.url);
      const dataParam = url.searchParams.get('data');

      if (dataParam) {
        const data = JSON.parse(decodeURIComponent(dataParam));
        console.log('模块:');
        Object.keys(data).forEach(key => {
          if (key !== 'comm' && data[key]?.module) {
            console.log(`  ${key}: ${data[key].module}.${data[key].method}`);
            console.log(`  参数:`, JSON.stringify(data[key].param).substring(0, 100));
          }
        });
      }
    } catch (e) {
      console.log('无法解析data参数');
    }
  });
}

const harPath = process.argv[2];

if (!harPath) {
  console.log('使用方法: node parse-har.js <har-file-path>');
  console.log('\n从Fiddler导出HAR文件:');
  console.log('1. 在Fiddler中选择QQ音乐相关的请求');
  console.log('2. File → Export Sessions → Selected Sessions');
  console.log('3. 选择 "HTTPArchive v1.2" 格式');
  console.log('4. 保存为 qq-music.har');
  console.log('5. 运行: node parse-har.js qq-music.har');
  process.exit(1);
}

parseHarFile(harPath);
