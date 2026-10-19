// Fetches public review/discussion pages and saves readable text extracts.
import { writeFileSync, mkdirSync } from 'node:fs';
const out = 'reviews'; mkdirSync(out, { recursive: true });
const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', accept: '*/*' };
const get = async (url) => { try { const r = await fetch(url, { headers: UA }); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: String(e) }; } };
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const log = [];
// App Store reviews (JSON RSS), several pages and countries.
for (const id of ['6446385602']) for (const cc of ['us', 'gb', 'ca', 'au']) for (const page of [1, 2, 3]) {
  const url = `https://itunes.apple.com/${cc}/rss/customerreviews/page=${page}/id=${id}/sortby=mostrecent/json`;
  const r = await get(url); log.push(`${r.status} ${url}`);
  try { const entries = JSON.parse(r.text).feed.entry ?? []; writeFileSync(`${out}/appstore-${id}-${cc}-${page}.txt`, entries.filter((e) => e['im:rating']).map((e) => `[${e['im:rating'].label}★] ${e.title.label}: ${e.content.label}`).join('\n\n')); } catch {}
}
// App Store search for other Tesla light show apps.
{ const r = await get('https://itunes.apple.com/search?term=tesla%20light%20show&entity=software&limit=25'); log.push(`${r.status} appsearch`);
  try { writeFileSync(`${out}/appsearch.txt`, JSON.parse(r.text).results.map((a) => `${a.trackId} | ${a.trackName} | ${a.averageUserRating?.toFixed?.(1)}★ (${a.userRatingCount}) | ${a.formattedPrice}\n  ${(a.description ?? '').slice(0, 600).replace(/\s+/g, ' ')}`).join('\n\n')); } catch {} }
// Reddit search (JSON).
for (const q of ['tesla light show editor', 'tesla light show creator app', 'thatteslalightshow', 'lightshowcreator', 'tesla light show xlights easy', 'tesla light show maker', 'tesla light show generator']) {
  for (const host of ['https://www.reddit.com', 'https://old.reddit.com']) {
    const url = `${host}/search.json?q=${encodeURIComponent(q)}&sort=relevance&t=all&limit=25`;
    const r = await get(url); log.push(`${r.status} ${url}`);
    try { const posts = JSON.parse(r.text).data.children.map((c) => c.data);
      writeFileSync(`${out}/reddit-${q.replace(/\W+/g, '_')}.txt`, posts.map((p) => `[${p.score}] r/${p.subreddit} · ${p.title} · https://reddit.com${p.permalink}\n  ${(p.selftext ?? '').slice(0, 800).replace(/\s+/g, ' ')}`).join('\n\n'));
      // Comments of the top 4 posts.
      for (const p of posts.slice(0, 4)) {
        const c = await get(`${host}${p.permalink}.json?limit=60&sort=top`);
        try { const comments = JSON.parse(c.text)[1].data.children.map((x) => x.data).filter((x) => x.body);
          writeFileSync(`${out}/reddit-c-${p.id}.txt`, `${p.title}\nhttps://reddit.com${p.permalink}\n\n` + comments.map((x) => `[${x.score}] ${x.body.slice(0, 700).replace(/\s+/g, ' ')}`).join('\n\n')); } catch {}
      }
      break;
    } catch {}
  }
}
// Product pages and forums (text only).
for (const url of ['https://play.google.com/store/apps/details?id=com.coding1024.tslshow&hl=en_US&showAllReviews=true', 'https://thatteslalightshow.com/', 'https://lightshowcreator.com/', 'https://www.trustpilot.com/review/thatteslalightshow.com', 'https://teslamotorsclub.com/tmc/search/?q=light+show+editor', 'https://www.producthunt.com/search?q=tesla%20light%20show', 'https://xlightshows.io/', 'https://www.teslalightshare.io/']) {
  const r = await get(url); log.push(`${r.status} ${url}`);
  writeFileSync(`${out}/page-${url.replace(/^https?:\/\//, '').replace(/\W+/g, '_').slice(0, 60)}.txt`, strip(r.text).slice(0, 15000));
}
writeFileSync(`${out}/_log.txt`, log.join('\n'));
