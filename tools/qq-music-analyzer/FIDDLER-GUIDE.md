# Fiddler抓包指南 - QQ音乐推荐API分析

由于QQ音乐使用HTTPS加密，推荐使用Fiddler进行抓包分析。

## 快速开始

### 1. 安装Fiddler

下载并安装 [Fiddler Classic](https://www.telerik.com/download/fiddler)（免费）

### 2. 配置Fiddler

1. 启动Fiddler
2. **Tools** → **Options** → **HTTPS**
   - ✓ 勾选 **Capture HTTPS CONNECTs**
   - ✓ 勾选 **Decrypt HTTPS traffic**
   - 点击 **Actions** → **Trust Root Certificate** (信任根证书)
3. **Tools** → **Options** → **Connections**
   - 确认端口是 **8888**（默认）

### 3. 开始抓包

1. **启动Fiddler** (自动设置系统代理)
2. **清空会话列表**: 点击左下角 ❌ 图标
3. **启动QQ音乐客户端**
4. **操作客户端**:
   - 点击"推荐"/"发现音乐"页面
   - 刷新推荐歌单
   - 浏览不同的推荐分类
   - 多刷新几次，观察哪些请求会重复出现

### 4. 过滤请求

在Fiddler左侧会话列表上方，输入过滤规则：

```
host:y.qq.com OR host:qqmusic.qq.com
```

或者右键点击一个QQ音乐的请求 → **Filter Now** → **Show only y.qq.com**

### 5. 重点关注的请求

查找这些特征的请求：

#### 特征1：URL包含关键词
- `musicu.fcg` - QQ音乐统一接口
- `recommend` - 推荐
- `playlist` - 歌单
- `hot` - 热门

#### 特征2：响应数据包含
- 右键点击请求 → **Inspectors** → **JSON/TextView**
- 查看响应中是否有：
  - `disslist` (歌单列表)
  - `v_hot` (热门推荐)
  - `content_id` + `title` (歌单信息)
  - 多个歌单数据

#### 特征3：每次刷新都触发
- 在客户端刷新推荐页面
- 观察Fiddler中哪些请求重复出现

### 6. 分析关键请求

找到可疑的请求后：

1. **查看请求详情**
   - 选中请求
   - 右侧 **Inspectors** 标签
   - **Raw** 查看原始请求
   - **Headers** 查看请求头
   - **WebForms** / **TextView** 查看参数

2. **关注这些信息**
   - **URL**: 完整的请求地址
   - **Cookie**: 特别是 `uin`、`qqmusic_key`、`psrf_access_token_expiresAt` 等
   - **Query参数**: 特别是 `data` 参数（通常是JSON）
   - **User-Agent**: 客户端标识

3. **查看响应**
   - **JSON** 标签查看结构化数据
   - 确认包含歌单列表

### 7. 导出数据

**方法1：单个请求**
- 右键点击请求 → **Save** → **Request and Response**
- 保存为 `.saz` 文件，或复制关键信息

**方法2：批量导出**
- 选中多个请求（Ctrl + 点击）
- **File** → **Export Sessions** → **Selected Sessions...**
- 选择 **HTTPArchive v1.2** 格式
- 保存为 `qq-music-captures.har`

### 8. 使用我们的分析工具

将Fiddler数据转换为我们的工具格式：

```bash
# 手动创建 captured-requests.jsonl，每行一个JSON对象：
```

```json
{"timestamp":"2026-07-30T12:00:00Z","method":"GET","url":"https://u.y.qq.com/cgi-bin/musicu.fcg?data=...","requestHeaders":{"cookie":"..."},"statusCode":200,"responseBody":"..."}
```

然后运行分析：

```bash
node analyze-requests.js
```

## 常见问题

### Q1: Fiddler显示"Tunnel to..."无法解密
**A**: QQ音乐可能使用了证书固定。尝试：
1. 关闭QQ音乐
2. Fiddler → **Tools** → **Options** → **HTTPS** → **Actions** → **Reset All Certificates**
3. 重新信任根证书
4. 重启QQ音乐

### Q2: 找不到推荐相关的请求
**A**: 
- 确保在客户端中真的刷新了推荐页面
- 尝试点击不同的推荐分类
- 检查是否有 `u.y.qq.com/cgi-bin/musicu.fcg` 的请求
- 查看请求的 `data` 参数中的 `module` 字段

### Q3: 请求太多，难以分析
**A**:
- 使用过滤器: `host:y.qq.com`
- 只关注状态码 200 的请求
- 按大小排序，找响应体较大的（可能包含歌单数据）
- 右键 → **Mark** 标记重要的请求

## 预期结果示例

找到类似这样的请求：

```
GET https://u.y.qq.com/cgi-bin/musicu.fcg?data=%7B%22recomPlaylist%22%3A%7B...

解码后的data参数：
{
  "recomPlaylist": {
    "module": "playlist.HotRecommendServer",
    "method": "get_hot_recommend",
    "param": { "async": 1, "cmd": 2 }
  },
  "comm": {
    "uin": "123456789",
    "format": "json",
    "ct": 24,
    "cv": 0
  }
}

响应包含：
{
  "code": 0,
  "recomPlaylist": {
    "data": {
      "v_hot": [
        { "content_id": "...", "title": "...", ... }
      ]
    }
  }
}
```

## 下一步

找到关键API后：
1. 使用 `replay-api.js` 验证是否可以重放
2. 测试不同的参数组合
3. 更新 `src/music/providers/qq-provider.js`
