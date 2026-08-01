// 测试 Cookie 提取逻辑
'use strict';

function extractUin(cookieHeader) {
  const text = String(cookieHeader || '');
  const match = text.match(/(?:^|;\s*)(?:qqmusic_uin|wxuin|uin|o_cookie|qm_hideuin)=o?(\d+)/);
  return match ? match[1] : '';
}

// 测试各种 Cookie 格式
const testCases = [
  { name: 'qqmusic_uin 标准格式', cookie: 'qqmusic_uin=123456', expected: '123456' },
  { name: 'qqmusic_uin 带 o 前缀', cookie: 'qqmusic_uin=o123456', expected: '123456' },
  { name: 'uin 标准格式', cookie: 'uin=123456', expected: '123456' },
  { name: 'uin 带 o 前缀', cookie: 'uin=o123456', expected: '123456' },
  { name: 'wxuin 微信登录', cookie: 'wxuin=789012', expected: '789012' },
  { name: '多个 Cookie', cookie: 'qqmusic_key=abc123; uin=456789; p_skey=xyz', expected: '456789' },
  { name: '空 Cookie', cookie: '', expected: '' },
  { name: 'uin 非数字值', cookie: 'uin=abc123', expected: '' },
  { name: 'uin 为 0', cookie: 'uin=0', expected: '0' }
];

console.log('=== Cookie 提取测试 ===\n');

let passCount = 0;
let failCount = 0;

testCases.forEach((test) => {
  const result = extractUin(test.cookie);
  const passed = result === test.expected;

  if (passed) {
    passCount++;
    console.log(`✓ ${test.name}`);
    console.log(`  Cookie: ${test.cookie}`);
    console.log(`  提取结果: ${result || '(空)'}\n`);
  } else {
    failCount++;
    console.log(`✗ ${test.name}`);
    console.log(`  Cookie: ${test.cookie}`);
    console.log(`  期望: ${test.expected || '(空)'}`);
    console.log(`  实际: ${result || '(空)'}\n`);
  }
});

console.log(`=== 测试结果 ===`);
console.log(`通过: ${passCount}/${testCases.length}`);
console.log(`失败: ${failCount}/${testCases.length}`);

// 额外测试：显示 Cookie 名称诊断
console.log('\n=== Cookie 名称诊断测试 ===\n');

function diagnoseCookies(cookieHeader) {
  const cookieNames = cookieHeader
    .split(';')
    .map(pair => pair.trim().split('=')[0])
    .filter(name => name)
    .join(', ');
  return cookieNames || '未找到任何 Cookie';
}

const diagTests = [
  'qqmusic_key=abc; uin=123; p_skey=xyz',
  'qqmusic_key=abc; p_skey=xyz; skey=def',
  ''
];

diagTests.forEach((cookie, i) => {
  console.log(`测试 ${i + 1}:`);
  console.log(`  Cookie: ${cookie || '(空)'}`);
  console.log(`  诊断: ${diagnoseCookies(cookie)}`);
  console.log(`  提取 QQ 号: ${extractUin(cookie) || '(失败)'}\n`);
});
