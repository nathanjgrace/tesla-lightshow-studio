# Competitive landscape

_Last reviewed 2026-10-19. Goal: be the obvious best tool for Tesla light shows the moment someone opens it._

## Who else is out there

| Tool | Type | What it does well | Weak spots | Price |
|---|---|---|---|---|
| **xLights** | Desktop, open source | Total control; Tesla's official route (Tesla ships an xLights project) | Built for whole-house displays; steep learning curve; no Tesla-specific guidance | Free |
| **That Lightshow** (thatteslalightshow.com) | Web | Auto-generates from a song (tempo, drop detection), 3D preview of your model, "mirror edits across the car", validated exports with flash-rate limits, a show library (bring your own music) | Paid after the first export | Freemium |
| **Light Show Creator** (lightshowcreator.com) | Web | Timeline editor with waveform and live preview; auto-generate | Limited free tier | $2.99/mo or $26.99/yr |
| **Light Show Creator for Tesla** | iOS, Android, Windows | One-tap auto-generate by tempo; exports .xsq for xLights | Reviews ~3.1★: hard to make effects, doors hard to program, export paywall, ads | Paid |
| **Marquee: Tesla Light Show Studio** | Web (Patreon) | Timeline editor, four vehicle views | Small; **nearly the same name as this project** | Patreon |
| **Show libraries** (xlightshows.io, teslalightshare.io) | Web | Lots of community shows to download | Not editors | Free |

Sources: [That Lightshow](https://thatteslalightshow.com/), [Light Show Creator](https://lightshowcreator.com/), [App Store listing](https://apps.apple.com/us/app/light-show-creator-for-tesla/id6446385602), [Google Play listing](https://play.google.com/store/apps/details?id=com.coding1024.tslshow&hl=en_US), [Tesla light-show repo](https://github.com/teslamotors/light-show). Feature claims are from vendors' own pages and store listings.

## Where we win

1. **Free and open source, no export paywall.** Every competitor except xLights charges to export.
2. **True to the car.** We simulate what the car really does: ramp timing, combined (OR) lights, channel 4–6 ramp leader, door travel times, dance-only-when-open, and per-version/per-trim hardware with VIN lookup. Competitors preview the channels, not the car.
3. **Closure safety.** The validator catches command limits, dance-before-open, thermal limits and Model X pinch risk. Nobody else advertises this.
4. **Open any show and keep editing.** Imported `.fseq` files become editable effects, byte-for-byte lossless. That makes us the editor for every show in the community libraries.
5. **Respect for xLights users.** Tesla's xLights hotkeys (F, E/D/C, W/S/X, Q/A/Z) work the same way.
6. **The best-looking preview.** Tesla's own textured 3D models, wired light by light from Tesla's xLights layout: the Model S and Cybertruck as Tesla made them (including every Cybertruck light bar LED), and the Model X, 3 and Y reshaped from the S. The car sits in a wet parking lot that reflects the show, in the paint it was sold in. Competitors use generic or stylized models.

## Must match (or beat)

| Feature | Status |
|---|---|
| 3D preview of your model | ✅ |
| Mirror left↔right | ✅ (M) |
| Waveform timeline, live preview | ✅ |
| Validated exports | ✅ (plus closure checks nobody else has) |
| **One-click auto-generate from beats/drops** | ✅ beats, hits, **melody** and sections drive lights and a closure planner; one light family per sound (shown in the panel), dark between hits, notes held for their length, repeated choruses look the same; three styles, intensity, variations; measured against Tesla's own choreography |
| Show library / sharing | Tesla examples ✅; community sharing later (M7) |
| Flash-rate safety limit | To add to the validator |
| Beat grid snapping | ✅ beat and bar lines, section labels, snapping to beat subdivisions |
| Many audio formats (That Lightshow takes MP3, WAV, M4A, AAC, OGG, FLAC) | ✅ same set plus Opus; always exported as 44.1 kHz WAV |
| Drag a song onto the page to start | ✅ |
| Type a song name, pick from autocomplete | ✅ legally: Apple's iTunes Search with previews and an Apple Music link, then the user adds their own copy, so exports are full-length shows (competitors reportedly build on Apple's 30-second preview clips, which caps a show at 30 seconds and isn't allowed by the preview license) |

## Decisions

- **No importing songs from YouTube or streaming services.** Jowua's tool takes a YouTube link, but downloading YouTube audio breaks YouTube's terms and copyright law, browsers can't fetch it without a download server, and an open-source project doing it is a takedown target (GitHub removed youtube-dl over a DMCA notice in 2020). Spotify and Apple Music are copy-protected. We follow That Lightshow's "bring your own music" approach and make it as fast as possible: drop in any common format. Searching by name is done legally with Apple's iTunes Search API: users find and preview the song, then drop in their own copy (DESIGN §10d). Exporting preview clips: see the next decision.
- **Shows can use a song's 30-second preview clip (owner's decision, October 2026).** Offered as "Use the 30-second clip" next to "drop your copy". Clips come from Deezer (MP3, downloadable by the page); Apple results are matched to the same recording there. Known risks, accepted: Deezer's developer guidelines make the app owner responsible for not making audio downloadable and say non-compliant apps can be blocked, which would also take down the search fallback; and the clip is copyrighted music used outside its preview license. The dialog notes such shows are for personal use. Competitors reportedly do the same. A catalog of freely licensed music (e.g. Jamendo's API, which needs a registered app key) could later supply songs users don't own.

## Notes

- **Name:** "Lightshow Studio" is close to Marquee's "Tesla Light Show Studio", and product names using "Tesla" invite trademark trouble. Worth choosing a distinctive name before a public launch.

## That Lightshow's builder, up close (2026-10-19)

Captured by a real browser on a GitHub Actions runner (the site isn't reachable from our sandbox):
- **Song lookup:** the page calls its own server, `GET /api/song-search?q=…`, which returns Apple iTunes Search results reshaped as `{id, title, artist, album, artwork (200 px), previewUrl (Apple's 30 s AAC), fullSeconds, explicit, storeUrl}`. Results come back in Apple's order (for "Blinding Lights" a remix and covers came before The Weeknd's original, which was 6th); our `bestMatch` ranking does better here. A server proxy means the user's browser never talks to Apple, so ad blockers and school/work networks that block `itunes.apple.com` don't matter, at the cost of running a server.
- **Flow:** "Hear 30 seconds and watch your car light up to it. No file needed." Then "drop in your own copy of the song" to export the full show. That's the same split as ours: preview clip first, own copy to export.
- **Editor:** a beat-cell grid (click a cell to cycle Open/Close/Dance/Stop on closures), BPM and intensity sliders, 46 channels, a Model 3 `.glb` with Draco compression. Closures are auto-choreographed by default.
- **Export:** a ZIP download plus an emailed link; "Your song is deleted from our servers after you export" (they upload the song).

What it means for us:
- We stay serverless; nothing is uploaded. If browser-side lookups keep failing for some users, a tiny optional proxy (for example a free Cloudflare Worker in front of iTunes Search) is the fallback after Deezer.
- Their editor is a coarse beat grid; ours is a full timeline with xLights-style effects, so the lead is in editing depth and preview fidelity. Keep auto-generate visibly musical (melody, per-sound lights) since that's their headline.

