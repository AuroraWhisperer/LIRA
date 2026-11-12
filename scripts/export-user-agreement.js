'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const destination = process.argv[2];
if (!destination || path.basename(destination) !== 'index.html') {
  throw new Error('Usage: node scripts/export-user-agreement.js <legal/index.html>');
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

const documents = [
  { slug: 'terms', title: '用户协议', file: 'user-agreement.txt', summary: '了解软件许可、账号规则、功能使用须知和双方责任。' },
  { slug: 'privacy', title: '隐私政策', file: 'privacy-policy.txt', summary: '了解个人信息、Cookie 和本地存储的用途、保存期限及您的权利。' },
].map(document => {
  const source = fs.readFileSync(path.join(__dirname, '../public/pages/admin/toolbox', document.file));
  const text = source.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const version = text.match(/^(?:协议|政策)版本：(\d{4}-\d{2}-\d{2})$/m)?.[1];
  const updatedAt = text.match(/^更新日期：(.+)$/m)?.[1];
  const effectiveAt = text.match(/^生效日期：(.+)$/m)?.[1];
  if (!version || !updatedAt || !effectiveAt) throw new Error(`${document.file} must declare its dates.`);
  const sections = [];
  const content = text.split(/\n{2,}/).slice(2).map(block => {
    if (/^[一二三四五六七八九十]+、/u.test(block)) {
      const id = document.slug === 'privacy' && block.includes('Cookie')
        ? 'cookies'
        : `${document.slug}-${sections.length + 1}`;
      sections.push({ id, title: block });
      return `<h2 id="${id}">${escapeHtml(block)}</h2>`;
    }
    const paragraph = escapeHtml(block)
      .replace(/【([^】]+)】/gu, '<strong>【$1】</strong>')
      .replace(/https:\/\/[^\s<>]+/gu, url => `<a href="${url}" rel="noreferrer">${url}</a>`)
      .replace(/\n/g, '<br>');
    return `<p>${paragraph}</p>`;
  }).join('\n');
  return { ...document, content, sections, updatedAt, effectiveAt, hash: createHash('sha256').update(source).digest('hex') };
});

function renderPage({ title, summary, navigation, content, hash }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#f8faf8">
  <meta name="description" content="${escapeHtml(summary)}">
${hash ? `  <meta name="lira-agreement-sha256" content="${hash}">\n` : ''}  <title>${title} · LIRA</title>
  <link rel="icon" type="image/png" href="/site/assets/lira-icon.png?v=20260906-transparent">
  <link rel="stylesheet" href="/site/assets/public-shell.css">
  <link rel="stylesheet" href="/site/assets/legal/legal.css">
  <link rel="stylesheet" href="/site/assets/registration-footer.css">
</head>
<body class="public-site legal-page">
  <a class="skip-link" href="#agreement">跳至正文</a>
  <header class="legal-header">
    <a class="legal-brand" href="/" aria-label="LIRA 官网首页">LIRA</a>
    <a href="/">返回官网</a>
  </header>
  <div class="legal-layout">
    <nav class="legal-contents" aria-label="协议与政策导航">
${navigation}
    </nav>
    <main id="agreement" tabindex="-1">
${content}
    </main>
  </div>
  <footer class="legal-footer registration-footer">
    <div class="registration-meta">
      <span>© 2026 LiraHub</span>
      <a href="/legal/terms">用户协议</a>
      <a href="/legal/privacy">隐私政策</a>
    </div>
    <div class="registration-links">
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">晋ICP备2026012266号</a>
      <a href="https://beian.mps.gov.cn/#/query/webSearch?code=14010602111348" target="_blank" rel="noopener noreferrer"><img src="/site/assets/police-registration.png" width="62" height="67" alt="">晋公网安备14010602111348号</a>
    </div>
  </footer>
</body>
</html>
`;
}

const directory = path.dirname(path.resolve(destination));
fs.mkdirSync(directory, { recursive: true });
for (const document of documents) {
  const navigation = documents.map(other =>
    `      <a href="/legal/${other.slug}"${other.slug === document.slug ? ' aria-current="page"' : ''}>${other.title}</a>`,
  ).concat(document.sections.map(section => `      <a href="#${section.id}">${escapeHtml(section.title)}</a>`)).join('\n');
  const content = `      <div class="legal-title">
        <h1>${document.title}</h1>
        <p class="legal-version">更新日期：${escapeHtml(document.updatedAt)} · 生效日期：${escapeHtml(document.effectiveAt)}</p>
        <p>${document.summary}</p>
      </div>
      <article class="legal-document" aria-label="LIRA ${document.title}全文">
${document.content}
      </article>`;
  fs.writeFileSync(path.join(directory, `${document.slug}.html`), renderPage({ ...document, navigation, content }));
}

fs.writeFileSync(destination, renderPage({
  title: '用户协议与隐私政策',
  summary: '分别查阅 LIRA 用户协议和隐私政策。',
  navigation: documents.map(document => `      <a href="/legal/${document.slug}">${document.title}</a>`).join('\n'),
  content: `      <div class="legal-title">
        <h1>用户协议与隐私政策</h1>
        <p>请分别查阅软件使用规则与个人信息处理说明。</p>
      </div>
      <div class="legal-document">
${documents.map(document => `        <section aria-labelledby="${document.slug}">
          <h2 id="${document.slug}"><a href="/legal/${document.slug}">${document.title}</a></h2>
          <p>${document.summary}</p>
        </section>`).join('\n')}
      </div>`,
}));
console.log(`Exported /legal, /legal/terms and /legal/privacy to ${directory}`);
