// Downloads the source models named in configs/*.mjs from Sketchfab into
// .cache/ (not committed). Sketchfab only serves downloads to signed-in
// accounts, so this needs an API token (sketchfab.com → Settings → Password & API):
//
//   SKETCHFAB_TOKEN=... node fetch.mjs [config id ...]

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const token = process.env.SKETCHFAB_TOKEN;
if (!token) throw new Error('Set SKETCHFAB_TOKEN to a Sketchfab API token');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(resolve(here, 'configs')).map((f) => f.replace(/\.mjs$/, ''));
mkdirSync(resolve(here, '.cache'), { recursive: true });
for (const id of ids) {
  const { source } = (await import(resolve(here, 'configs', `${id}.mjs`))).default;
  const out = resolve(here, '.cache', `${source.uid}.glb`);
  if (existsSync(out)) {
    console.log(`${id}: already downloaded`);
    continue;
  }
  const links = await (await fetch(`https://api.sketchfab.com/v3/models/${source.uid}/download`, { headers: { Authorization: `Token ${token}` } })).json();
  if (!links.glb?.url) throw new Error(`${id}: no GLB download (${JSON.stringify(links).slice(0, 200)})`);
  writeFileSync(out, Buffer.from(await (await fetch(links.glb.url)).arrayBuffer()));
  console.log(`${id}: ${source.title} by ${source.author} (${source.license})`);
}
