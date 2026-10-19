// Searches Sketchfab for downloadable Tesla models and records license, size and thumbnails.
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('models/thumbs', { recursive: true });
const queries = ['tesla model y', 'model y juniper', 'tesla model y 2025', 'tesla model 3', 'model 3 highland', 'tesla model 3 2024', 'tesla model x', 'tesla model x plaid', 'tesla model s plaid', 'tesla model s 2021', 'cybertruck', 'tesla'];
const seen = new Map();
const lines = [];
for (const q of queries) {
  for (const license of ['', 'by', 'cc0', 'by-sa']) {
    const url = `https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(q)}&downloadable=true&count=24${license ? `&license=${license}` : ''}&sort_by=-likeCount`;
    const r = await fetch(url).catch((e) => ({ ok: false, status: String(e) }));
    lines.push(`${r.status} ${url}`);
    if (!r.ok) continue;
    const j = await r.json();
    for (const m of j.results ?? []) if (!seen.has(m.uid)) seen.set(m.uid, { ...m, query: q });
  }
}
const rows = [];
for (const m of seen.values()) {
  const d = await (await fetch(`https://api.sketchfab.com/v3/models/${m.uid}`)).json().catch(() => ({}));
  const thumb = (m.thumbnails?.images ?? []).sort((a, b) => Math.abs(a.width - 640) - Math.abs(b.width - 640))[0]?.url;
  if (thumb) { try { const buf = Buffer.from(await (await fetch(thumb)).arrayBuffer()); writeFileSync(`models/thumbs/${m.uid}.jpg`, buf); } catch {} }
  const arch = d.archives ?? {};
  rows.push({
    uid: m.uid, name: m.name, user: m.user?.username, license: d.license?.label ?? m.license?.label, faces: m.faceCount, verts: m.vertexCount,
    likes: m.likeCount, views: m.viewCount, published: m.publishedAt?.slice(0, 10), animated: m.animationCount, query: m.query,
    glb: arch.glb ? `${(arch.glb.size / 1e6).toFixed(1)} MB, ${arch.glb.textureCount} tex, ${arch.glb.faceCount} faces` : '', gltf: arch.gltf ? `${(arch.gltf.size / 1e6).toFixed(1)} MB` : '',
    tags: (d.tags ?? []).map((t) => t.name).join(' '), desc: (d.description ?? '').replace(/\s+/g, ' ').slice(0, 500), url: m.viewerUrl,
  });
}
rows.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
writeFileSync('models/results.json', JSON.stringify(rows, null, 1));
writeFileSync('models/_log.txt', lines.join('\n'));
