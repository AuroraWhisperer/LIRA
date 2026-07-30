// 从 HAR 里抽出客户端真正用的歌单详情请求（uniform_get_Dissinfo）的完整参数
const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'qq-music.har'), 'utf8').replace(/^﻿/, '');
const har = JSON.parse(raw);
const entries = (har.log && har.log.entries) || [];
console.log(`HAR 共 ${entries.length} 条`);

const hits = [];
entries.forEach((entry, i) => {
  const req = entry.request || {};
  const post = req.postData || {};
  // Fiddler 把 form-urlencoded 的 body 放在 params[].name 里，text 里可能是 TLS 握手噪音。
  const candidates = [post.text || ''];
  (post.params || []).forEach((p) => {
    candidates.push(p.name || '');
    candidates.push(p.value || '');
  });
  const postText = candidates.find((t) => String(t).trim().startsWith('{')) || '';
  if (!postText) return;
  const resText = (entry.response && entry.response.content && entry.response.content.text) || '';
  if (/Dissinfo|RecommendFeed|radio_track|daily|Daily|recommend/i.test(postText)) {
    hits.push({ i, url: req.url, method: req.method, postText, resText });
  }
});

console.log(`命中 ${hits.length} 条\n`);

hits.forEach((h) => {
  console.log('='.repeat(70));
  console.log(`[${h.i}] ${h.method} ${h.url.slice(0, 100)}`);
  if (h.postText) {
    try {
      const j = JSON.parse(h.postText);
      // comm 是客户端标识，param 是业务参数，两个都要看。
      // uin/uid/guid/g_tk 是账号凭据，打印时打码，避免抓包内容泄漏到日志里。
      if (j.comm) {
        const safe = { ...j.comm };
        ['uin', 'uid', 'guid', 'g_tk', 'g_tk_new_20200303', 'authst', 'tmeLoginType'].forEach((k) => {
          if (safe[k] !== undefined) safe[k] = '<redacted>';
        });
        console.log('comm:', JSON.stringify(safe));
      }
      Object.entries(j).forEach(([key, val]) => {
        if (key === 'comm' || !val || typeof val !== 'object') return;
        console.log(`${key}: module=${val.module} method=${val.method}`);
        const param = { ...(val.param || {}) };
        ['guid', 'uin', 'uid'].forEach((k) => {
          if (param[k] !== undefined) param[k] = '<redacted>';
        });
        console.log(`  param=${JSON.stringify(param)}`);
      });
    } catch (_) {
      console.log('postData(raw):', h.postText.slice(0, 600));
    }
  }
  if (h.resText) {
    try {
      const j = JSON.parse(h.resText);
      Object.entries(j).forEach(([key, val]) => {
        if (key === 'comm' || !val || typeof val !== 'object') return;
        const d = val.data || {};
        const arrays = Object.keys(d).filter((k) => Array.isArray(d[k])).map((k) => `${k}[${d[k].length}]`);
        console.log(`  <- ${key} code=${val.code} arrays=[${arrays.join(',')}] keys=[${Object.keys(d).slice(0, 12).join(',')}]`);
        if (Array.isArray(d.songlist) && d.songlist[0]) {
          const s = d.songlist[0];
          console.log(`     songlist[0]: mid=${s.mid} name=${s.name || s.title}`);
        }
        if (d.dirinfo) {
          console.log(`     dirinfo.title="${d.dirinfo.title}" id=${d.dirinfo.id} songnum=${d.dirinfo.songnum}`);
        }
      });
    } catch (_) {
      console.log('  <- response(raw):', h.resText.slice(0, 300));
    }
  }
});
