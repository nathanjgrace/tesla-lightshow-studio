// Song search against the real catalogs, in Chromium and WebKit, with Apple
// working, blocked (like an ad blocker), rate-limited (HTTP 403), and with
// both catalogs blocked. Runs against a local build at http://localhost:4173/.
import { chromium, webkit } from 'playwright';
const SITE = process.env.SITE ?? 'http://localhost:4173/';
const scenarios = {
  normal: async () => {},
  appleBlocked: async (page) => page.route(/itunes\.apple\.com/, (r) => r.abort('blockedbyclient')),
  appleRateLimited: async (page) => page.route(/itunes\.apple\.com\/search/, (r) => r.fulfill({ status: 403, body: 'Forbidden' })),
  bothBlocked: async (page) => {
    await page.route(/itunes\.apple\.com/, (r) => r.abort('blockedbyclient'));
    await page.route(/api\.deezer\.com/, (r) => r.abort('blockedbyclient'));
  },
};
for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch();
  for (const [name, setup] of Object.entries(scenarios)) {
    console.log(`\n===== ${engineName} / ${name} =====`);
    const page = await browser.newPage();
    page.on('console', (m) => /Song search|error/i.test(m.text()) && console.log(`[console.${m.type()}]`, m.text().slice(0, 300)));
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await setup(page);
    await page.goto(SITE);
    await page.waitForTimeout(3000);
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);
    await page.keyboard.type('one more time daft punk', { delay: 60 });
    await page.waitForTimeout(5000);
    const text = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '(no dialog)');
    console.log('[dialog]', text.slice(0, 700).replace(/\n+/g, ' | '));
    if (name !== 'bothBlocked') {
      // Play the first preview and check the clip actually advances.
      await page.locator('[role="option"] button').first().click().catch((e) => console.log('[play click failed]', e.message));
      await page.waitForTimeout(3000);
      const audio = await page.evaluate(() => {
        const a = document.querySelector('audio');
        return a && { src: a.currentSrc.slice(0, 60), time: a.currentTime.toFixed(2), paused: a.paused, error: a.error?.message ?? a.error?.code ?? null };
      });
      console.log('[preview]', JSON.stringify(audio));
    }
    await page.screenshot({ path: `diag/out/${engineName}-${name}.png` });
    await page.close();
  }
  await browser.close();
}
