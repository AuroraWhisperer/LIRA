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

  // 读取并移除BOM
  let rawContent = fs.readFileSync(harPath, 'utf8');
  if (rawContent.charCodeAt(0) === 0xFEFF) {
    rawContent = rawContent.slice(1);
  }

  const harContent = JSON.parse(rawContent);
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

    // 提取请求体
    // 注意：Fiddler 导出 HAR 时，如果 content-type 是 x-www-form-urlencoded，
    // 会把整个 body 塞进 postData.params[0].value 而留空 postData.text。
    // QQ音乐客户端发的其实是 JSON（却标了 urlencoded），所以必须两处都读。
    let requestBody = '';
    if (request.postData) {
      if (request.postData.text) {
        requestBody = request.postData.text;
      } else if (Array.isArray(request.postData.params)) {
        requestBody = request.postData.params
          .map(p => (p.name ? `${p.name}=${p.value || ''}` : (p.value || '')))
          .join('&');
      }
    }

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
      requestBody,
      statusCode: response.status,
      responseHeaders,
      responseBody: responseBody.substring(0, 200000) // 限制大小
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

  // 分析 musicu.fcg / musics.fcg 请求（GET 走 ?data=，POST 走 body）
  console.log('\n=== fcg 统一接口调用的模块列表 ===');
  const fcgRequests = qqMusicRequests.filter(e =>
    /musicu\.fcg|musics\.fcg/.test(e.request.url)
  );

  fcgRequests.forEach((entry, i) => {
    const req = entry.request;
    console.log(`\n[${i + 1}] ${req.method} ${req.url.split('?')[0]}`);

    // 拿到调用描述 JSON：优先 POST body，其次 URL 的 data 参数
    let payload = '';
    if (req.postData) {
      payload = req.postData.text ||
        (req.postData.params || []).map(p => p.value || '').join('');
    }
    if (!payload) {
      try {
        payload = new URL(req.url).searchParams.get('data') || '';
        payload = decodeURIComponent(payload);
      } catch (e) { /* ignore */ }
    }
    if (!payload) {
      console.log('  (无调用描述)');
      return;
    }

    try {
      const data = JSON.parse(payload);
      Object.keys(data).forEach(key => {
        if (key === 'comm' || !data[key]?.module) return;
        console.log(`  ${key}: ${data[key].module}.${data[key].method}`);
        console.log(`     param: ${JSON.stringify(data[key].param)}`);
      });
    } catch (e) {
      console.log(`  解析失败，原始内容: ${payload.substring(0, 200)}`);
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
