# QQ音乐客户端API分析工具 - 使用总结

## 📁 工具说明

这是一套完整的工具，用于抓包分析QQ音乐Windows客户端的网络请求，找到客户端使用的动态推荐歌单API。

## 🎯 目标

找到QQ音乐客户端用于获取**每次刷新都不同的推荐歌单**的API接口，替代网页版固定的推荐列表。

## 📋 文件列表

```
tools/qq-music-analyzer/
├── README.md              - 完整说明文档
├── FIDDLER-GUIDE.md       - Fiddler抓包详细指南 ⭐
├── start.bat              - Windows快速启动脚本
├── start.sh               - Linux/Mac快速启动脚本
├── package.json           - Node.js项目配置
├── proxy-server.js        - HTTP代理服务器（不推荐，无法解密HTTPS）
├── parse-har.js           - HAR文件解析器 ⭐
├── analyze-requests.js    - 请求分析器 ⭐
└── replay-api.js          - API重放测试器
```

## 🚀 推荐使用流程

### 方法1：使用Fiddler（推荐）⭐

**第1步：安装Fiddler**
```
下载地址: https://www.telerik.com/download/fiddler
安装后配置HTTPS解密（详见 FIDDLER-GUIDE.md）
```

**第2步：抓包**
1. 启动Fiddler
2. 清空会话列表
3. 启动QQ音乐客户端
4. 在客户端中操作：
   - 点击"推荐"/"发现音乐"页面
   - 多次刷新推荐歌单
   - 浏览不同分类
5. 过滤显示：`host:y.qq.com`

**第3步：导出数据**
- 选择QQ音乐相关的请求
- File → Export Sessions → Selected Sessions
- 格式选择：**HTTPArchive v1.2**
- 保存为：`qq-music.har`

**第4步：解析和分析**
```bash
cd tools/qq-music-analyzer

# 解析HAR文件
node parse-har.js qq-music.har

# 分析请求（自动读取 captured-requests.jsonl）
node analyze-requests.js

# 测试重放某个API
node replay-api.js 0
```

### 方法2：使用内置代理（仅支持HTTP）

```bash
cd tools/qq-music-analyzer

# 启动代理
node proxy-server.js

# 然后配置系统代理为 127.0.0.1:8888
# 启动QQ音乐，浏览推荐页面
# Ctrl+C 停止代理

# 分析捕获的请求
node analyze-requests.js
```

## 🔍 重点关注的API特征

查找包含以下特征的请求：

### URL特征
- `u.y.qq.com/cgi-bin/musicu.fcg`
- `c.y.qq.com/splcloud/fcgi-bin/`
- URL或参数包含：`recommend`、`playlist`、`hot`、`diss`

### 响应特征
响应JSON包含：
- `disslist` 或 `v_hot`（歌单列表）
- `content_id` + `title`（歌单信息）
- 多个歌单对象

### Module/Method（musicu.fcg接口）
关注 `data` 参数中的：
```json
{
  "module": "playlist.XxxServer",
  "method": "get_xxx_recommend",
  "param": { ... }
}
```

## 📊 预期发现

可能找到类似这样的接口：

```javascript
// URL
https://u.y.qq.com/cgi-bin/musicu.fcg?data={...}

// data参数（URL编码）
{
  "req": {
    "module": "playlist.XXX",  // 可能不同于 HotRecommendServer
    "method": "GetDynamicRecommend",
    "param": {
      "refresh": 1,  // 刷新标志
      "timestamp": 1234567890,
      // 其他参数
    }
  },
  "comm": {
    "uin": "12345678",  // 从Cookie提取
    "format": "json",
    "ct": 24,
    "cv": 0
  }
}

// 关键Cookie
Cookie: uin=o12345678; qqmusic_key=...; psrf_access_token_expiresAt=...
```

## 🛠️ 故障排除

### 问题1：Fiddler无法解密HTTPS
**原因**：QQ音乐使用证书固定
**解决**：
1. Fiddler → Tools → Options → HTTPS → Actions → Reset All Certificates
2. 重新信任根证书
3. 重启QQ音乐客户端

### 问题2：找不到推荐相关的请求
**检查**：
- 确实在客户端中刷新了推荐页面
- 使用过滤器：`host:y.qq.com`
- 查找 `musicu.fcg` 请求
- 按响应大小排序

### 问题3：解析HAR文件出错
**确认**：
- 导出格式是 HTTPArchive v1.2（不是 SAZ）
- 文件路径正确
- 文件不为空

## 🎓 下一步

找到可用的API后：

1. **验证API**
   ```bash
   node replay-api.js 0  # 测试第一个候选API
   ```

2. **提取认证信息**
   - Cookie中的 `uin`、`qqmusic_key` 等
   - 必需的请求头

3. **集成到项目**
   - 更新 `src/music/providers/qq-provider.js`
   - 修改 `getPersonalizedPlaylists` 方法
   - 使用新发现的 module/method

4. **测试**
   ```bash
   # 在主项目中测试
   npm test
   ```

## 💡 提示

- QQ音乐客户端可能每个版本使用的API不同
- 某些API可能需要VIP账号
- Cookie有效期限制，需要定期更新
- 建议同时保留网易云音乐作为备选

## 📞 需要帮助？

如果发现了有用的API端点，可以：
1. 运行 `replay-api.js` 验证
2. 查看 `analysis-report.json` 获取完整信息
3. 我可以帮你集成到主项目中

---

**开始使用：**
```bash
cd tools/qq-music-analyzer
./start.bat  # Windows
# 或
./start.sh   # Linux/Mac
```
