import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = '/tmp/out'; mkdirSync(out + '/bodies', { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const log = []; let n = 0;
p.on('response', async (r) => {
  const u = r.url(); const ct = r.headers()['content-type'] ?? '';
  const e = { url: u, status: r.status(), ct, method: r.request().method(), post: r.request().postData()?.slice(0, 2000) };
  log.push(e);
  if (/json|javascript|html|text/.test(ct)) { try { const t = await r.text(); const f = `bodies/${String(n++).padStart(3,'0')}.txt`; writeFileSync(`${out}/${f}`, u + '\n\n' + t); e.file = f; } catch {} }
});
const save = async (tag) => { await p.screenshot({ path: `${out}/${tag}.png`, fullPage: true }).catch(() => {}); writeFileSync(`${out}/${tag}.html`, await p.content()); writeFileSync(`${out}/log.json`, JSON.stringify(log, null, 1)); };
await p.goto('https://thatteslalightshow.com/builder', { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => console.log('goto', e.message));
await p.waitForTimeout(4000); await save('1-load');
writeFileSync(`${out}/text1.txt`, await p.innerText('body').catch(() => ''));
const inputs = await p.$$eval('input,button,[role=button]', (els) => els.map((e) => `${e.tagName} type=${e.type} ph=${e.placeholder} aria=${e.getAttribute('aria-label')} txt=${(e.innerText||'').slice(0,60)}`));
writeFileSync(`${out}/controls.txt`, inputs.join('\n'));
const box = await p.$('input[type=search], input[placeholder*="earch" i], input[placeholder*="ong" i], input[type=text]');
if (box) { await box.fill('Blinding Lights'); await box.press('Enter'); await p.waitForTimeout(6000); await save('2-search'); writeFileSync(`${out}/text2.txt`, await p.innerText('body').catch(() => '')); }
else console.log('no search box');
await b.close();
