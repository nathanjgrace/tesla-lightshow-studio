// Opens the live site in Chromium (and WebKit, which is Safari's engine),
// searches for a song, and reports every request to Apple and every console
// message.
import { chromium, webkit } from 'playwright';
const SITE = 'https://nathanjgrace.github.io/tesla-lightshow-studio/';
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  console.log(`\n===== ${name} =====`);
  const browser = await engine.launch();
  const page = await browser.newPage();
  page.on('console', (m) => console.log(`[console.${m.type()}]`, m.text().slice(0, 400)));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('requestfailed', (r) => /apple|mzstatic|deezer/.test(r.url()) && console.log('[requestfailed]', r.url().slice(0, 200), r.failure()?.errorText));
  page.on('response', async (r) => {
    if (!/apple|deezer/.test(r.url())) return;
    const h = r.headers();
    console.log('[response]', r.status(), r.url().slice(0, 200));
    console.log('   content-type:', h['content-type'], '| acao:', h['access-control-allow-origin'], '| vary:', h['vary'], '| nosniff:', h['x-content-type-options']);
  });
  await page.goto(SITE);
  await page.waitForTimeout(4000);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(800);
  await page.keyboard.type('one more time daft punk', { delay: 40 });
  await page.waitForTimeout(6000);
  const text = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '(no dialog)');
  console.log('[dialog text]', text.slice(0, 600).replace(/\n+/g, ' | '));
  await page.screenshot({ path: `diag/${name}.png` });
  await browser.close();
}
