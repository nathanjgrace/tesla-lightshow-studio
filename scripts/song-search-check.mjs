// Checks song search against the real catalogs in Chromium and WebKit
// (Safari's engine): Apple working, Apple blocked (as by an ad blocker),
// Apple rate-limited, and both catalogs blocked. Run by
// .github/workflows/song-search-check.yml against a local build at
// http://localhost:4173/ (override with SITE). Needs network access to
// itunes.apple.com and api.deezer.com, so it doesn't run in `npm test`.
import { chromium, webkit } from 'playwright';

const SITE = process.env.SITE ?? 'http://localhost:4173/';
const QUERY = 'one more time daft punk';

const scenarios = [
  { name: 'Apple working', expect: 'Apple Music', setup: async () => {} },
  {
    name: 'Apple blocked',
    expect: 'Deezer',
    setup: (page) => page.route(/itunes\.apple\.com/, (r) => r.abort('blockedbyclient')),
  },
  {
    name: 'Apple rate-limited',
    expect: 'Deezer',
    setup: (page) => page.route(/itunes\.apple\.com\/search/, (r) => r.fulfill({ status: 403, body: 'Forbidden' })),
  },
  {
    name: 'both blocked',
    expect: 'error',
    setup: async (page) => {
      await page.route(/itunes\.apple\.com/, (r) => r.abort('blockedbyclient'));
      await page.route(/api\.deezer\.com/, (r) => r.abort('blockedbyclient'));
    },
  },
];

let failed = 0;
const check = (ok, message) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${message}`);
  if (!ok) failed++;
};

for (const [engineName, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const browser = await engine.launch();
  for (const s of scenarios) {
    console.log(`${engineName}: ${s.name}`);
    const page = await browser.newPage();
    page.on('pageerror', (e) => check(false, `page error: ${e.message}`));
    await s.setup(page);
    await page.goto(SITE);
    await page.waitForSelector('.topbar');
    await page.keyboard.press('Control+k');
    await page.waitForSelector('[role="combobox"]');
    const start = Date.now();
    await page.keyboard.type(QUERY);
    if (s.expect === 'error') {
      const shown = await page
        .getByText("Couldn't reach the music catalogs")
        .waitFor({ timeout: 20000 })
        .then(() => true, () => false);
      check(shown, `explains the failure (${Date.now() - start} ms)`);
      check(await page.isVisible('button:has-text("Try again")'), 'offers Try again');
    } else {
      const row = await page.waitForSelector('[role="option"]', { timeout: 20000 }).catch(() => null);
      check(!!row, `shows results (${Date.now() - start} ms after typing started)`);
      if (row) {
        const link = await page.textContent('[role="option"] .song-apple');
        // Apple sometimes rate-limits shared CI machines; Deezer then answers, which is fine.
        const okSource = s.expect === 'Apple Music' ? /Apple Music|Deezer/.test(link ?? '') : link?.includes(s.expect);
        check(!!okSource, `results come from ${s.expect} (“${link?.trim()}”)`);
        await page.locator('[role="option"] button').first().click();
        await page.waitForTimeout(2500);
        const t = await page.evaluate(() => document.querySelector('audio')?.currentTime ?? 0);
        check(t > 0.5, `preview plays (${t.toFixed(1)} s in)`);
      }
    }
    await page.close();
  }
  await browser.close();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll song search checks passed');
process.exit(failed ? 1 : 0);
