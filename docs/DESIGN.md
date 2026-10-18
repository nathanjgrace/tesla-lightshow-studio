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
| **M2 Editor basics** | Project model, compile, timeline, place/move effects, export zip | next |
| **M3 Auto-generate v1** | essentia.js analysis, beat-driven lights, style presets, closure planner | |
| **M4 Vehicle profiles** | All models and versions in a grouped menu, local VIN decoding with version picker, combined-light (OR) and ramp quirks in the simulation | ✅ first pass |
| **M5 Expert parity** | Layers, value curves, timing tracks, `.xsq` import, shortcuts | |
| **M6 More cars** | 3D bodies for Model S, 3, Y, Cybertruck (light bars, RGB); per-variant lights in the preview | |
| **M6a HQ assets** | Licensed or commissioned high-quality 3D models (glTF) per model and version, replacing the code-built bodies; light/closure wiring stays the same | later |
| **M6b Paint** | Factory paint colors per model and year, plus a Tesla-style custom picker with finish (gloss/matte/metallic) | later, low priority |
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

## 10b. 3D model

Tesla publishes 3D models only for the Model S and Cybertruck (in its xLights project). The Model X in the app is built in code (`src/app/car/ModelXScene.ts`): stylized, with every light channel placed per Tesla's diagram, and working falcon wings, front doors, liftgate, mirrors, windows and charge port. A detailed licensed model can replace the body later; light and closure wiring stays the same.

## 11. Risks

- **The car is the real spec.** Some rules are documented loosely and Tesla's own examples bend them (research §6). We need real-car testing, especially for Model X variants.
- **Tesla can change things in a software update.** Keep rules in data tables, not scattered through code.
- **Generation quality is subjective.** Ship presets, gather feedback, and make regenerating cheap.
- **Large audio in the browser:** decode once, cache analysis, and do heavy work in Workers.
