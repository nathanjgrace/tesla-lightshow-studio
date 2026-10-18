# Competitive landscape

_Last reviewed 2026-10-18. Goal: be the obvious best tool for Tesla light shows the moment someone opens it._

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

## Must match (or beat)

| Feature | Status |
|---|---|
| 3D preview of your model | ✅ |
| Mirror left↔right | ✅ (M) |
| Waveform timeline, live preview | ✅ |
| Validated exports | ✅ (plus closure checks nobody else has) |
| **One-click auto-generate from beats/drops** | Next: the biggest gap |
| Show library / sharing | Tesla examples ✅; community sharing later (M7) |
| Flash-rate safety limit | To add to the validator |
| Beat grid snapping | Next, comes with audio analysis |
| Many audio formats (That Lightshow takes MP3, WAV, M4A, AAC, OGG, FLAC) | ✅ same set plus Opus; always exported as 44.1 kHz WAV |
| Drag a song onto the page to start | ✅ |

## Decisions

- **No importing songs from YouTube or streaming services.** Jowua's tool takes a YouTube link, but downloading YouTube audio breaks YouTube's terms and copyright law, browsers can't fetch it without a download server, and an open-source project doing it is a takedown target (GitHub removed youtube-dl over a DMCA notice in 2020). Spotify and Apple Music are copy-protected. We follow That Lightshow's "bring your own music" approach and make it as fast as possible: drop in any common format. A legitimate way to search by name would be a catalog of freely licensed music (e.g. Jamendo's API, which needs a registered app key).

## Notes

- **Name:** "Lightshow Studio" is close to Marquee's "Tesla Light Show Studio", and product names using "Tesla" invite trademark trouble. Worth choosing a distinctive name before a public launch.
