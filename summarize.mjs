import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const log = JSON.parse(readFileSync('/tmp/out/log.json', 'utf8'));
writeFileSync(`${out}/requests.txt`, log.map((e) => `${e.status} ${e.method} ${e.ct.split(';')[0]} ${e.url.slice(0, 300)}${e.post ? '\n    POST ' + e.post.slice(0, 400) : ''}`).join('\n'));
for (const f of ['text1.txt', 'text2.txt', 'controls.txt']) if (existsSync(`/tmp/out/${f}`)) writeFileSync(`${out}/${f}`, readFileSync(`/tmp/out/${f}`, 'utf8').slice(0, 20000));
// JSON API responses (third-party data), trimmed.
const api = [];
for (const e of log) if (e.file && /json/.test(e.ct)) api.push(`== ${e.url.slice(0, 300)}\n${readFileSync('/tmp/out/' + e.file, 'utf8').split('\n\n').slice(1).join('\n\n').slice(0, 3000)}`);
writeFileSync(`${out}/api.txt`, api.join('\n\n'));
// Where scripts mention music services or search: short excerpts only.
const words = /itunes|apple\.com\/search|deezer|spotify|musicbrainz|youtube|soundcloud|lastfm|audiodb|genius|shazam|jsonp|callback=|preview|lookup|search\?|\/api\//gi;
const hits = [];
for (const e of log) {
  if (!e.file || !/javascript/.test(e.ct)) continue;
  const text = readFileSync('/tmp/out/' + e.file, 'utf8');
  const seen = new Set();
  for (const m of text.matchAll(words)) {
    const at = Math.floor(m.index / 150);
    if (seen.has(at) || seen.size > 40) continue;
    seen.add(at);
    hits.push(`-- ${e.url.split('/').pop().slice(0, 80)} @${m.index}: ${text.slice(Math.max(0, m.index - 160), m.index + 200).replace(/\s+/g, ' ')}`);
  }
}
writeFileSync(`${out}/mentions.txt`, hits.join('\n'));
