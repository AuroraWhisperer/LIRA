// HTTP/HTTPS代理服务器，用于拦截QQ音乐客户端的网络请求
// 使用方法：node proxy-server.js
// 然后配置系统代理为 127.0.0.1:8888

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PROXY_PORT = 8888;
const LOG_FILE = path.join(__dirname, 'captured-requests.jsonl');
const FILTER_DOMAINS = ['y.qq.com', 'qqmusic.qq.com', 'music.qq.com'];

// 确保日志文件存在
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, '');
}

console.log(`QQ音乐代理服务器启动在端口 ${PROXY_PORT}`);
console.log(`日志保存到: ${LOG_FILE}`);
console.log(`\n过滤域名: ${FILTER_DOMAINS.join(', ')}`);
console.log(`\n请配置系统代理: 127.0.0.1:${PROXY_PORT}\n`);

const server = http.createServer((clientReq, clientRes) => {
  const reqUrl = url.parse(clientReq.url);
  const targetHost = clientReq.headers.host;

  // 过滤：只记录QQ音乐相关的请求
  const shouldLog = FILTER_DOMAINS.some(domain => targetHost && targetHost.includes(domain));

  const options = {
    hostname: targetHost,
    port: reqUrl.port || 80,
    path: reqUrl.path,
    method: clientReq.method,
    headers: clientReq.headers
  };

  const proxyReq = http.request(options, (proxyRes) => {
    let body = [];

    proxyRes.on('data', (chunk) => {
      body.push(chunk);
    });

    proxyRes.on('end', () => {
      const responseBody = Buffer.concat(body);

      if (shouldLog) {
        logRequest({
          timestamp: new Date().toISOString(),
          method: clientReq.method,
          url: `http://${targetHost}${reqUrl.path}`,
          requestHeaders: clientReq.headers,
          statusCode: proxyRes.statusCode,
          responseHeaders: proxyRes.headers,
          responseBody: responseBody.toString('utf8').substring(0, 10000) // 限制大小
        });

        console.log(`[${clientReq.method}] ${targetHost}${reqUrl.path} - ${proxyRes.statusCode}`);
      }

      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
      clientRes.end(responseBody);
    });
  });

  proxyReq.on('error', (err) => {
    console.error(`代理请求错误: ${err.message}`);
    clientRes.writeHead(500);
    clientRes.end('Proxy Error');
  });

  clientReq.on('data', (chunk) => {
    proxyReq.write(chunk);
  });

  clientReq.on('end', () => {
    proxyReq.end();
  });
});

// 处理HTTPS CONNECT请求（简单透传，不解密）
server.on('connect', (req, clientSocket, head) => {
  const { port, hostname } = url.parse(`//${req.url}`, false, true);

  console.log(`[CONNECT] ${hostname}:${port}`);

  const serverSocket = http.request({
    host: hostname,
    port: port || 443,
    method: 'CONNECT'
  });

  serverSocket.on('connect', (res, socket) => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.write(head);
    socket.pipe(clientSocket);
    clientSocket.pipe(socket);
  });

  serverSocket.on('error', (err) => {
    console.error(`CONNECT错误: ${err.message}`);
    clientSocket.end();
  });

  serverSocket.end();
});

server.listen(PROXY_PORT, () => {
  console.log(`代理服务器运行中... (Ctrl+C 退出)\n`);
});

function logRequest(data) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(data) + '\n');
  } catch (err) {
    console.error(`写入日志失败: ${err.message}`);
  }
}

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n\n代理服务器已停止');
  console.log(`捕获的请求已保存到: ${LOG_FILE}`);
  process.exit(0);
});
