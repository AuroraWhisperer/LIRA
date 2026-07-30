# QQ音乐客户端API分析工具

本工具用于抓包分析QQ音乐Windows客户端的网络请求，找到客户端实际使用的推荐歌单API。

## 目标

找到QQ音乐客户端用于获取**动态刷新的推荐歌单**的API接口，以替代网页版固定的推荐列表。

## 工具清单

### 1. 本地代理服务器 (`proxy-server.js`)
在本地启动HTTP/HTTPS代理，拦截QQ音乐客户端的网络请求。

### 2. 请求分析器 (`analyze-requests.js`)
分析捕获的请求日志，找出推荐相关的API。

### 3. API重放器 (`replay-api.js`)
重放捕获的请求，验证参数和认证方式。

## 使用步骤

### 步骤1：启动代理服务器

```bash
cd tools/qq-music-analyzer
npm install
node proxy-server.js
```

代理将在 `http://localhost:8888` 启动。

### 步骤2：配置QQ音乐客户端代理

**方法A：系统代理（推荐）**
1. Windows设置 → 网络和Internet → 代理
2. 手动设置代理：`127.0.0.1:8888`
3. 启动QQ音乐客户端
4. 在客户端中浏览推荐歌单、刷新页面

**方法B：使用Fiddler**
1. 安装 [Fiddler Classic](https://www.telerik.com/fiddler/fiddler-classic)
2. Tools → Options → HTTPS → 勾选 "Capture HTTPS CONNECTs" 和 "Decrypt HTTPS traffic"
3. 启动Fiddler，启动QQ音乐
4. 在Fiddler中过滤 `y.qq.com` 相关的请求
5. 手动导出请求到 `captured-requests.json`

### 步骤3：分析请求

```bash
node analyze-requests.js
```

这会分析 `captured-requests.json`，找出推荐API。

### 步骤4：测试重放API

```bash
node replay-api.js <api-endpoint>
```

### 步骤5：集成到项目

找到可用的API后，更新 `src/music/providers/qq-provider.js` 中的 `getPersonalizedPlaylists` 方法。

## 注意事项

- **HTTPS解密**：某些客户端可能使用证书固定（Certificate Pinning），导致代理无法解密HTTPS。如果遇到此问题，建议使用Fiddler的高级功能。
- **请求签名**：QQ音乐可能对请求进行签名验证，需要分析签名算法。
- **Cookie/Token**：需要从客户端提取有效的认证信息。

## 关键API候选

根据初步调查，客户端可能使用以下接口：

- `u.y.qq.com/cgi-bin/musicu.fcg` - 统一音乐接口
- `c.y.qq.com` 下的各种 fcgi 接口
- 可能需要特殊的 `module` 和 `method` 参数

重点关注：
- 包含 "recommend"、"playlist"、"hot"、"personalized" 等关键词的请求
- 响应包含歌单列表的接口
- 每次刷新都会触发的请求

## 预期结果

找到类似这样的接口：

```javascript
{
  url: 'https://u.y.qq.com/cgi-bin/musicu.fcg',
  method: 'GET',
  params: {
    data: {
      req: {
        module: 'playlist.SomeNewModule',
        method: 'GetDynamicRecommend',
        param: { ... }
      }
    }
  },
  headers: {
    Cookie: '...',  // 从客户端提取
    // 其他认证头
  }
}
```
