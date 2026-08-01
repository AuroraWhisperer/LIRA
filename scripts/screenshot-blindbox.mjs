// Screenshot the blind box mapping section from admin page
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto('http://localhost:3000/admin.html', { waitUntil: 'networkidle', timeout: 10000 });
await page.waitForTimeout(1000);

// Check for login form
const passwordInput = await page.$('#password');
if (passwordInput) {
  console.log('Logging in...');
  await page.fill('#password', 'admin');
  await page.click('#loginBtn');
  await page.waitForTimeout(1500);
}

// Find blind box section
const section = await page.$('.gift-blindbox-section');
if (section) {
  await section.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await section.screenshot({ path: 'd:/Work/Live/blindbox-section.png' });
  console.log('✅ Blind box section screenshot saved to blindbox-section.png');
} else {
  console.log('⚠️ .gift-blindbox-section not found, taking full page...');
  await page.screenshot({ path: 'd:/Work/Live/blindbox-section.png', fullPage: true });
}

await browser.close();
