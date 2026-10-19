# Tesla Lightshow Studio: Design

_Status: draft v0.1, 2026-10-18. Research behind this doc: [research/01-tesla-lightshow-format.md](research/01-tesla-lightshow-format.md)._

## 1. Goals

1. **A complete novice can make a good show in minutes.** Upload a song, pick a style, press Generate, copy the result to a USB drive.
2. **Experts lose nothing compared with xLights.** Every Tesla-relevant capability of xLights is available: per-channel and per-frame editing, layered effects, value curves, timing tracks, and import of existing `.fseq`/`.xsq` shows.
3. **The app knows the car.** It edits against a specific vehicle's real capabilities, explains rules in plain language, and catches problems before you walk out to the car.
4. **Runs in the browser, no install.** Version 1 needs no server or account. Accounts, sharing and a community gallery come later without rewriting the editor.

**Non-goals for now:** general-purpose holiday lighting (xLights' main use), hardware controllers, and live (real-time) control of the car.

## 2. Key constraint: one file plays on every car

Tesla defines a single 200-channel layout; each car plays what it has and ignores the rest (research §1). So:

- **Export is vehicle-independent.** We always write the same 200-channel FSEQ v2.0 file.
- **The vehicle profile shapes the experience, not the file.** It decides which tracks the editor shows, what the preview draws, what the generator targets and which warnings fire.

## 3. Architecture

```
┌──────────────────────────────── Browser ────────────────────────────────┐
│                                                                         │
│  UI (React)                                                             │
│   ├─ Setup wizard: song → vehicle (VIN / questions) → style             │
│   ├─ Timeline editor (canvas): tracks, effects, waveform, beat grid     │
│   ├─ Car preview (three.js, stylized Model X)                ✅ first   │
│   └─ Problems panel (validator output, click to jump)                   │
│                                                                         │
│  Core (pure TypeScript, no UI; runs in tests and Web Workers)           │
│   ├─ channels      200-channel map, kinds, closure specs      ✅ done   │
│   ├─ encoding      byte values for light & closure commands   ✅ done   │
│   ├─ fseq          FSEQ v2 read/write, byte-exact             ✅ done   │
│   ├─ validate      header + closure rules                     ✅ done   │
│   ├─ vehicles      capability profiles (Model X first)       ✅ first   │
│   ├─ project       document model: tracks, effects, undo                │
│   ├─ compile       project → frames (incl. ch 4–6 ramp leader rules)    │
│   ├─ simulate      frames + profile → what the car will show ✅ done    │
│   ├─ analysis      audio → beats, sections, energy, melody (Worker)     │
│   ├─ choreograph   analysis + profile + style → effects                 │
│   └─ export        .fseq + 44.1 kHz WAV → LightShow.zip                 │
│                                                                         │
│  Storage: IndexedDB (projects, audio), JSON project files               │
└─────────────────────────────────────────────────────────────────────────┘
```

**Rule:** everything in `src/core` is plain TypeScript with no browser UI dependencies, and is covered by unit tests. The UI is a thin layer on top. That keeps the hard logic testable and lets us move heavy work (audio analysis, compiling) into Web Workers so the page stays responsive.

## 4. Data model

The project stores **effects** (intent), not frames. Frames are compiled only for preview and export.

```ts
Project {
  version: 1
  audio: { name, durationMs, sampleRate, hash }   // audio bytes in IndexedDB
  stepTimeMs: 20
  cars: Car[]                                      // 1 for now; Tesla supports up to 8
  timing: TimingTrack[]                            // beats, bars, sections, user marks
  analysis?: AnalysisResult                        // cached music analysis
}
Car { vehicle: VehicleProfileRef, tracks: Track[] }
Track { target: ChannelId | GroupId, layers: Layer[] }   // groups = "both headlights", "all closures"…
Layer { effects: Effect[], blend: 'override' | 'max' }
Effect {
  id, startMs, endMs,
  type: 'on' | 'ramp' | 'strobe' | 'chase' | 'twinkle' | 'closure' | 'baked' | …
  params: {...}                                    // e.g. ramp time, strobe rate, chase order
  curve?: ValueCurve                               // brightness over time (dimmable/RGB)
  source: 'user' | 'generated'                     // regenerating replaces only 'generated'
}
```

- **Groups and mirroring:** a track can target a group (left + right). "Mirror" is an operation, not a duplicate effect.
- **`baked` effects** hold raw per-frame values. Imported `.fseq` files become baked effects, so any existing show can be opened.
- **`source: 'generated'`** lets the user regenerate the parts they haven't touched while keeping their own edits.
- **Undo/redo:** the document is immutable and every edit is a small patch, so undo is cheap and robust.

## 5. Vehicle profiles and VIN lookup

```ts
VehicleProfile {
  id: 'modelX-2021' | …
  channels: { [channelId]: { present: boolean, kind: ChannelKind, orGroup?: string } }
  questions: Question[]          // what we still need the owner to tell us
}
```

- **Kind overrides:** for example, on Model X the signature and front turn lights are boolean, while the superset map lists them as ramping.
- **OR groups:** some cars drive one physical light from several channels. The `simulate` step uses these so the preview shows what the car will really do.

**Getting a profile:**
1. The user enters a VIN (or picks a model). We decode it with NHTSA vPIC (free, public) to get model, year and plant.
2. We look up candidate profiles in our capability table (model, year, serial ranges).
3. If anything is still ambiguous (headlight type, accent lights, region), we ask 1–3 picture-based questions ("Does your car have colored light strips inside?").
4. Later, optional "Sign in with Tesla" (Fleet API) for exact detection.

Model X 2021+ ships first. Open questions about its variants are in research §7 and §11.

## 6. Auto-generation pipeline

```
audio ──▶ analysis (Worker) ──▶ choreograph(style, profile) ──▶ effects ──▶ editor
             beats & tempo              mapping rules              (source: generated)
             onsets (drums)             closure planner
             energy curve               budget/rule checks
             frequency bands
             melody / pitch
             sections (verse/chorus)
```

- **Analysis:** essentia.js (AGPL, which fits our license) for beat tracking, onsets, melody, key and segmentation. It runs in a Web Worker and the results are cached in the project.
- **Choreography** is rules plus a little randomness, controlled by **style presets**:
  - **Section level:** quiet sections use few, slow ramps; choruses and drops use full strobes and chases.
  - **Beat level:** bass and kick hits go to main beams and fogs, snares and claps to turn signals, hi-hats to quick flickers.
  - **Melody:** pitch contour drives chases across ch 4–6, signature and side lights (rising pitch sweeps outward).
  - **Energy:** controls how dense the effects are and how often ramps are used.
- **Closure planner:** schedules the big moves (falcon wings open on the first big build, dance at the peak chorus, close at the outro). It works backward from travel times, stays within command and thermal budgets, and never moves windows while the doors move.
- **Novice controls:** style, intensity slider, "use doors?" toggle, and "regenerate this section".

## 7. Editor (expert mode)

- Timeline on canvas: tracks grouped Front / Rear / Closures / Interior, with waveform and beat grid, zoom down to single frames.
- Effects: place, drag, resize and snap to beats; keyboard shortcuts compatible with Tesla's xLights hotkeys (Q/A/Z/F, W/S/X, E/D/C) so xLights users feel at home.
- Layers, value curves, copy/paste, mirror L↔R, "fill with pattern".
- A Problems panel that is always visible: validator issues with times, click to jump.
- The preview shows the simulated car, not the raw channels.

## 8. Export

`LightShow/<name>.fseq` plus `LightShow/<name>.wav`, delivered as a zip, with Tesla's USB instructions one click away (the **?** next to Export). Implemented in `src/core/export.ts`, ✅ first pass.
- **Export range:** the user picks which part of the song becomes the show by dragging handles above the waveform, and can slide the whole range along the song. Editing is never limited to the range; only the export is trimmed. Tesla's current limit is 4 hours per show (research §2), so there is no hard length cap.
- Audio is resampled to 44.1 kHz, 16-bit WAV (48 kHz drifts).
- Validator errors are shown in the export dialog (not yet blocking).
- File names must match; the user names the show, and names are made file-safe so several shows can share a drive.
- **Export any time:** "Show file only (.fseq)" saves progress whenever the user wants, finished or not; the app reopens `.fseq` files.
- **Later, a project file.** Once effects are editable (M2), a `.fseq` can't hold the editable effects, layers and settings (it only stores the rendered frames). We'll add a project file then (a zip with project JSON + audio, e.g. `.lsproj`) plus automatic in-browser saving. `.fseq` stays the hand-off format for the car.

## 9. Roadmap

| Milestone | Contents | Status |
|---|---|---|
| **M0 Foundation** | Project setup, FSEQ read/write, validator, file-check page | ✅ done |
| **M1 Playback** | Editor layout (side-by-side / stacked), 3D Model X with working closures, composer timeline with waveform, Tesla example library, audio-synced playback | ✅ first pass |
| **M2 Editor basics** | Project model (effects compiled to frames, lossless import of any .fseq), draw/move/resize/select effects, undo/redo, copy/paste/duplicate, mirror L↔R, xLights hotkeys, snap, inspector, new show from a song | ✅ first pass |
| **M3 Auto-generate v1** | essentia.js analysis, beat grid + snapping, beat-driven lights, style presets, closure planner | next (biggest gap vs competitors, see COMPETITION.md) |
| **M4 Vehicle profiles** | All models and versions in a grouped menu, local VIN decoding with version picker, combined-light (OR) and ramp quirks in the simulation | ✅ first pass |
| **M5 Expert parity** | Layers, value curves, timing tracks, `.xsq` import, shortcuts | |
| **M6 More cars** | 3D bodies for Model S, 3, Y, Cybertruck (light bars, RGB); per-version and per-trim lights in the preview | ✅ first pass (stylized) |
| **M7a Multi-car** | Several cars side by side, cross-car sweeps, one file per car | placeholder |
| **M6a HQ assets** | Tesla's own textured Model S and Cybertruck models, with every light and moving part wired from Tesla's xLights layout; Model X, original Model 3 and Model Y reshaped from the Model S (§10b). Still to do: refreshed Model 3 (2024+) and Model Y (2025+), and exact models of every car (licensed or commissioned) | ✅ first pass |
| **M6b Paint** | Factory paint colors per model version and year, a custom color with finish (gloss, metallic, satin, matte), and a reflections switch | ✅ first pass |
| **M6c Scene** | Wet night street (mirror reflections streaked by puddles), slow auto-rotate while playing | ✅ first pass |
| **M7 Community** | Accounts, cloud projects, share/browse shows, multi-car shows | |

## 10. Technology choices

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Catches mistakes early, good editor help |
| UI | React 19 | Widely used, lots of help available |
| Build/dev server | Vite | Fast, simple |
| Tests | Vitest | Same config as Vite |
| Timeline rendering | HTML canvas | Thousands of cells at 50 frames per second |
| 3D preview | three.js (MIT) with bloom post-processing | Standard WebGL library; rotate/zoom via OrbitControls |
| Zip reading | fflate (MIT) | Small, fast; Tesla ships some examples as zips |
| Audio analysis | essentia.js (AGPL-3.0) | Best in-browser feature set; license matches ours |
| Storage | IndexedDB | Large audio files, works offline |
| Hosting | Static hosting (GitHub Pages or Cloudflare Pages) | Free, no server for v1 |
| License | AGPL-3.0-only | Owner chose open source; required by essentia.js |

## 10a. Show library

Tesla's official example shows are loaded straight from Tesla's GitHub repo at runtime, pinned to commit `9f94951` (`src/library/catalog.ts`). Tesla publishes them without a license, so we link instead of re-hosting copies; GitHub serves them with CORS enabled, so browsers can fetch them directly. Tesla's single-car zips for *Ready for Assault* and *Cyber Symphony* contain only xLights project files and no `.fseq`, so the library uses the per-car files from the multi-car versions.

Community shows (xlightshows.io, teslalightshare.io) are a later addition. They need permission from those sites or their authors before we pull them in.

## 10b. 3D models

Tesla publishes textured 3D models of the Model S and Cybertruck in its xLights project. The app fetches them from Tesla's repo at a pinned commit (never re-hosted), caches them in the browser, and builds a playable car (`src/app/car/teslaAssets.ts`, `meshBody.ts`). Tesla's xLights layout places every channel on these meshes, so each lens triangle is assigned to its channel automatically, and moving parts come from the OBJ groups (Model S) or regions around the layout's closure positions (Cybertruck). The code-built body shows while the 8.6 MB download runs and if it fails. Details, quirks and confidence: `research/03-tesla-3d-models.md`.

**Model X, Model 3 (2017 – 2023) and Model Y (2020 – 2024) are reshaped from Tesla's Model S** (`src/app/car/derive.ts`), labeled "Adapted from Tesla's Model S model". These cars share the S's design language (the 2021+ X also shares its platform, wheelbase and front end). The warp moves the axles, changes ride height, width and wheel size, and raises the greenhouse along each model's roofline, from published dimensions. Lamps keep their channels, because the layout's positions are reshaped too. Moving parts are re-cut for each model: the X's front doors come from the S's front doors (with their window and mirror), and its falcon wings from the S's rear doors plus the roof above them (with the rear windows); the 3's trunk lid is the S liftgate minus its glass. It's an approximation: proportions and roofline are right, but details such as the Model 3's shorter trunk deck and the Model Y's headlight shape are the S's.

For the refreshed Model 3 (2024+) and Model Y (2025+), whose slim lamps and light bars differ from the S, the app builds a stylized body in code (`src/app/car/bodies.ts`), sized from published dimensions: Model S, 3, X and Y share one builder with per-model profiles, and the Cybertruck has its own. Each vehicle version carries a `BodyStyle` (in `src/core/vehicles.ts`) for the hardware that differs by version and trim: refreshed slim headlights (2024+ Model 3, 2025+ Model Y), fog lamps, Model Y Premium front and rear light bars, and Cybertruck light bars (individually driven LEDs). Closures are modeled per car: falcon wings and front doors (X), door handles (S), liftgate (S, X, Y), trunk lid (3) and powered frunk (Cybertruck). High-quality models of the Model 3, X and Y (licensed or commissioned) can replace these later through the same mesh pipeline: an OBJ or glTF whose lens materials are named, plus channel positions in the same form as Tesla's layout.

**Paint** (`src/core/paint.ts`, `src/app/PaintPicker.tsx`) lists the factory colors each vehicle version was sold in, with years (sources: `research/02-paint-colors.md`), plus a custom color with a finish. The choice is remembered per version and only affects the preview. **Reflections** is off by default: bright reflections on the body can be mistaken for show lights. The night environment is dim and has no point-like highlights for the same reason.

**Scene** (`src/app/car/street.ts`): the car is parked at a curb on a wet street. The road is lit asphalt under a `Reflector` mirror whose shader blurs, streaks and fades reflections by a procedural puddle mask, so the car's lights smear across the road. While a show plays, the camera slowly circles the car (**Auto-rotate**, on by default); picking a camera view turns it off.

## 10c. Single car first

The editor works on one car. A **Single car / Multiple cars** switch is in the toolbar; Multiple cars shows a placeholder for now. Tesla's multi-car example shows play their first car's part.

## 10d. Song search

**Find a song…** (File menu, Ctrl/⌘ K, and the start screen) searches Apple's free iTunes Search API, with Deezer as a fallback, (`itunes.apple.com/search?media=music&entity=song`, no key) as you type, debounced by 250 ms with stale requests cancelled. Each result shows artwork, title, artist, album · year, length, a 30-second preview button (one shared `<audio>` element, one clip at a time, stopped when the dialog closes) and a **Listen on Apple Music** link, which Apple's terms ask for next to previews.

- **Your own copy, or the 30-second clip.** Picking a song shows a drop zone for the user's own copy; that file goes through the same "new show from a song" path as a plain drop. **Use the 30-second clip** instead downloads the song's Deezer preview (an Apple result is matched to the same recording by a plain Deezer search for artist and title and `sameSong`, preferring the same version and length; Deezer's `artist:"…" track:"…"` field search returned nothing when tested) and starts a 30-second show from it; `SongInfo.clip` marks it ("30 s clip" in the top bar, no length warning). This was the owner's decision with known risks: Deezer's terms and the clip's copyright (COMPETITION.md, Decisions). Apple's previews are never downloaded. The show keeps the song's metadata (`SongInfo`: title, artist, album, artwork, Apple Music link, length) for the top bar and the default export name.
- **Length check:** if the user's file differs from the catalog length by more than 5 s, a non-blocking note says so ("That's fine if it's an edit").
- **Plain drops get metadata too:** the file name is turned into a search term (`guessFromFileName`), and if a result's title and artist both appear in the name, its artwork and title are attached, with a one-click "Not this song". This never blocks or changes the audio.
- **Two catalogs** (`src/app/musicSearch.ts`). Apple's API sends `Access-Control-Allow-Origin: *` (checked from GitHub's runners in October 2026), so the app calls it with `fetch`. A refused request then means an ad or content blocker, a privacy extension or a network filter blocked it; HTTP 403/429 means Apple's rate limit (about 20 searches a minute per network). Either way search falls back to **Deezer's public API** (`api.deezer.com/search`, no key, MP3 previews, a "Listen on Deezer" link). Deezer sends no CORS headers, so it's called by JSONP (`output=jsonp&callback=`, `src/app/jsonp.ts`). Results are cached per term; a catalog that fails is skipped for one to five minutes depending on why; typing waits 350 ms before searching. If both fail, the dialog names each catalog and the reason, suggests what to allow, and offers **Try again**.
- **Checked against the real APIs** by `.github/workflows/song-search-check.yml` (weekly, on demand, and when the search code changes). It runs Chromium and WebKit with Apple working, blocked, rate-limited, and both catalogs blocked, and checks that results appear and previews play.
- Pure logic (URL building, defensive parsing, artwork sizes, length check, file-name matching) is in `src/core/songSearch.ts`, tested against a hand-written sample response, since tests never call the network.

## 11. Risks

- **The car is the real spec.** Some rules are documented loosely and Tesla's own examples bend them (research §6). We need real-car testing, especially for Model X variants.
- **Tesla can change things in a software update.** Keep rules in data tables, not scattered through code.
- **Generation quality is subjective.** Ship presets, gather feedback, and make regenerating cheap.
- **Large audio in the browser:** decode once, cache analysis, and do heavy work in Workers.
