# Research Notes: Tesla Light Show Format & Model X Capabilities

_Compiled 2026-10-18. Primary source: [teslamotors/light-show](https://github.com/teslamotors/light-show) @ `9f94951` (last commit 2024-12-29), including its README, `validator.py`, the xLights project folder (`xlights_rgbeffects.xml`, `xlights_keybindings.xml`) and the example `.fseq` files, decoded byte-by-byte._

Confidence tags: **[verified]** = read from Tesla's files or decoded from Tesla's examples. **[doc]** = stated in Tesla's README, not independently tested. **[unverified]** = third-party or inferred; needs confirmation, ideally on a real car.

---

## 1. Key insight: shows are vehicle-agnostic

> "A single show can be shared and run on any supported vehicle; they are not model-specific." **[doc]**

Tesla defines one **superset channel map**: a Model S layout plus Cybertruck extras, 200 channels. Each car plays the channels it physically has and ignores or remaps the rest.

**Implications for us:**
- The output file is always the same 200-channel layout. "Vehicle profile" is an **editor/preview concept**, not an export concept.
- The profile decides what the user sees, what the preview renders, what the auto-generator targets, and which warnings fire ("your car has no fog lights, so this effect won't show").
- A show made for a Model X still plays on a Model 3. We can show a "how it looks on other cars" preview later.

## 2. USB / file requirements [doc]

- Root folder `LightShow/` (case-sensitive) containing `<name>.fseq` plus `<name>.wav` or `<name>.mp3`, with **matching base names**. WAV is recommended.
- Multiple shows per drive are supported (software 2023.44.25+).
- Filesystem: exFAT, FAT32, ext3/ext4. **No NTFS.** The drive must not contain a root `TeslaCam/` folder or map/firmware update files.
- Audio must be **44.1 kHz**. 48 kHz files drift out of sync, so **our export must resample** to 44.1 kHz.
- Supported cars: Model S (2021+), Model 3, **Model X (2021+)**, Model Y, Cybertruck; software v11.0 (2021.44.25)+.
- Max show length is **4 hours**. The global command limit was removed, but **per-closure actuation limits still apply** (§6).

## 3. FSEQ v2 binary format [verified]

Taken from `validator.py` and checked against the example files. **Little-endian**, uncompressed, **frame-major** layout (all channels of frame 0, then frame 1, …), 1 byte per channel.

| Offset | Size | Field | Our value |
|---|---|---|---|
| 0 | 4 | magic | `PSEQ` |
| 4 | 2 | channel data offset | e.g. 128 / 168 (header + variable headers, padded) |
| 6 | 1 | minor version | `0` (2.0) or `2` (2.2); only these are validated by Tesla |
| 7 | 1 | major version | `2` |
| 8 | 2 | fixed header length | `32` |
| 10 | 4 | channel count | **`200`** (validator accepts 48 or 200; 48 is the legacy layout) |
| 14 | 4 | frame count | ≥1 |
| 18 | 1 | step time (ms) | **`20`** recommended; car accepts 15–100 |
| 19 | 1 | flags | `0` |
| 20 | 1 | compression type | **must be `0`** (uncompressed) |
| 21 | 1 | # compression blocks | `0` |
| 22 | 1 | # sparse ranges | `0` |
| 23 | 1 | reserved | `0` |
| 24 | 8 | unique id | timestamp (µs) |
| 32 | … | variable headers | `[u16 len][2-char code][data]`, e.g. `mf` = media filename, `sp` = sequence producer |

File size = `data_offset + channels × frames`; this held exactly for every example. Validator checks: magic, `start ≥ 24`, `frames ≥ 1`, `step ≥ 15`, channel count, compression = 0, duration ≤ 4 h, version 2.0/2.2.

## 4. Value encoding [verified]

xLights writes brightness % as `floor(pct × 2.55)` → byte. Tesla gives specific byte bands special meanings.

**Boolean lights:** `0` = off, `255` = on. On non-dimmable lights, anything **>50%** counts as ON. Minimum visible on-time is 15 ms; 100 ms+ looks better.

**Ramping lights**, decoded from example 3 (byte values observed exactly):

| Command | xLights % | Byte | xLights hotkey |
|---|---|---|---|
| Off, instant | 0 | 0 | (empty) |
| Off, 500 ms ramp | 10 | 25 | W |
| Off, 1000 ms ramp | 20 | 51 | S |
| Off, 2000 ms ramp | 30 | 76 | X |
| On, 500 ms ramp | 70 | 178 | E |
| On, 1000 ms ramp | 80 | 204 | D |
| On, 2000 ms ramp | 90 | 229 | C |
| On, instant | 100 | 255 | F |

Rules: you can't hold a steady mid-brightness. To guarantee the light reaches its target, the effect must last ≥ ramp + 50 ms; to guarantee it stops short, ≤ ramp − 100 ms. A ramp can be reversed mid-way.

**Closures**, from `xlights_keybindings.xml` and confirmed in example 1 (falcon doors 63 → 127):

| Command | xLights % | Byte | Hotkey |
|---|---|---|---|
| Idle | 0 | 0 | (empty) |
| Open | 25 | 63 | Q |
| Dance | 50 | 127 | A |
| Close | 75 | 191 | Z |
| Stop | 100 | 255 | F |

**Full-brightness channels** (Cybertruck light bars, Cybertruck brake/rear turn) and **RGB interior**: raw 0–255 values, which can follow arbitrary curves.

## 5. Channel map (1-indexed, 200 channels) [verified]

Taken from model `StartChannel`s in `xlights_rgbeffects.xml`. **Bold** = present on Model X.

| Ch | Function | Model X | Notes |
|---|---|---|---|
| 1 / 2 | L / R Outer Main Beam | **yes** | Ramping on LED reflector headlights; boolean on projector **[doc]** |
| 3 / 4 | L / R Inner Main Beam | **yes** | Ramping |
| 5 / 6 | L / R Signature | **yes** | Boolean on S/X |
| 7 / 8 | L / R Channel 4 | **yes** | Ramping; **ch 4 sets the ramp time for ch 4–6** on S/X |
| 9 / 10 | L / R Channel 5 | **yes** | Ramping (follows ch 4 timing) |
| 11 / 12 | L / R Channel 6 | **yes** | Ramping (follows ch 4 timing) |
| 13 / 14 | L / R Front Turn | **yes** | Boolean on S/X |
| 15 / 16 | L / R Front Fog | **yes** | |
| 17 / 18 | L / R Aux Park | **yes** | CT: frunk light |
| 19 / 20 | L / R Side Marker | **yes** (N. America only) | |
| 21 / 22 | L / R Side Repeater | **yes** | CT: rear side markers |
| 23 / 24 | L / R Rear Turn | **yes** | |
| 25 | Brake Lights | **yes** | |
| 26 / 27 | L / R Tail | **yes** | CT: reverse lights |
| 28 | Reverse Lights | **yes** | CT: bed lights (always 500 ms ramp) |
| 29 | Rear Fog | **yes** (N. America Model X has it; elsewhere non-NA cars do) | |
| 30 | License Plate | **yes** | |
| 31 / 32 | L / R Falcon Door | **yes, X only** | Closure: Dance ✓, **6 commands/show**, open ≈20 s, close ≈8 s |
| 33 / 34 | L / R Front Door | **yes, X only** | Closure: no dance, **6/show**, open ≈22 s, close ≈3 s |
| 35 / 36 | L / R Mirror | **yes** | Closure: no dance, **20/show**, ≈2 s |
| 37–40 | Windows LF, LR, RF, RR | **yes** | Closure: Dance ✓, **6/show**, ≈4 s |
| 41 | Liftgate | **yes** | Closure: Dance ✓, **6/show**, open ≈14 s, close ≈4 s (CT: frunk) |
| 42–45 | Door Handles LF, LR, RF, RR | no (Model S only) | |
| 46 | Charge Port | **yes** | Closure: Dance = rainbow LED, **3/show**, auto-closes after 2 min |
| 47–106 | Front Light Bar (60 px) | no (CT) | Full brightness |
| 111–162 | Rear Light Bar (52 px) | no (CT) | Full brightness; 107–110 and 163–166 are legacy/empty |
| 167–172 | Offroad Light Bar (6) | no (CT, optional) | |
| 175 | "Suspension" | ? | Present in the model but `Active="0"`; undocumented. **Treat as reserved.** |
| 176–178 | Center Front Display RGB | **likely yes** **[unverified for X]** | Lights the whole cabin |
| 179–193 | Interior accent RGB: R Rear, R Front, Center Front, L Front, L Rear (3 ch each) | **only cars with accent lights** **[unverified for X]** | |
| 194–200 | unused | | |

**Mapping quirks the editor must model** **[doc]**:
- **OR'd channels:** on some cars several channels drive one physical light (e.g. Model 3/Y aux park + side markers). To get a visible flash, *all* the OR'd channels need shared off-time. The editor should simulate this per profile.
- **Channel 4 leads ramp timing** for ch 4–6. A ramp effect sometimes has to be placed on ch 4 even when ch 4 itself isn't lit. **We can hide this from users**: the compiler inserts the ch 4 ramp automatically.

## 6. Closure rules (the validator we need to build) [doc]

- Only **Open, Close and Dance** count toward limits, and limits are per individual closure (left and right falcon are counted separately).
- **Dance is ignored unless the closure is already open** (windows are the exception), so Open must come first, with enough travel time before the Dance (falcon ≈20 s!).
- Dance must be held for the whole dance duration. Open/Close/Stop work at any effect length.
- **Thermal limits:** ≈30 s or less of dancing per closure per show is recommended.
- **Model X:** moving windows while the doors move can trigger **false pinch detection and stop the show**. This should be a hard warning in our validator.
- Commands packed too closely (~20 ms apart) waste budget and barely move anything.
- Music plays only through cabin speakers, so the generator should avoid closing windows.

None of these are checked by Tesla's `validator.py`; it checks only the header. **A closure-aware validator is a real differentiator.**

**Tesla's own examples bend these rules** [verified by running our validator on them]:
- *Cyber Symphony* sends the charge port **4** counted commands (Open, Dance, Dance, Close) against the documented limit of 3.
- *The Arrival* and *Ready for Assault* tell the liftgate to dance 5–13 s after Open, sooner than the ≈14 s opening time.

Together with the README's "the limit on number of commands … has been removed", this means the per-closure limits and travel times are **guidance, not hard rules**. Our validator reports them as warnings, not errors. Confirming the real behavior on a car is an open question (§11).

## 7. Model X: what varies within 2021+ [mostly unverified]

Tesla doesn't use strict model years; build date matters more. Known or suspected differences that affect light shows:

1. **Headlight type:** the README distinguishes LED **reflector** (outer main beam ramps) from **projector** (outer main beam boolean) for S/X. Owner forums report a switch to **matrix** headlamps around 2023 builds. Which ramping behavior applies to each Model X headlight version is **unverified**; this needs owner reports or a test on a real car.
2. **Interior accent RGB lights:** forum reports say 2022–2023 builds had white-only footwell/door lights, while the 2025 refresh added multicolor ambient strips. That decides whether channels 179–193 do anything.
3. **Side markers:** North America only. **Rear fog:** N. America Model X has it.
4. **2025 refresh** (new bumper camera, ambient lighting) reportedly kept the same headlights.

## 8. VIN lookup: what's realistic

- **Free/public:** NHTSA **vPIC** decodes make, model, model year (position 10) and plant (position 11). It does **not** give headlight type or ambient lighting. Tesla's serial number (positions 12–17) rises with build order, so **serial-range lookup tables** could approximate build date. We'd have to build those from community data.
- **Tesla Fleet API** (owner OAuth): returns a `vehicle_config` object with trim/configuration data. **I couldn't confirm** which fields it includes (e.g. headlight type), because Tesla's developer docs weren't reachable from this session. It also requires registering as a Tesla developer app and adds OAuth to our scope, so it's a later phase.
- **Plan:** VIN → vPIC → (model, year) → our capability table, then a **short visual questionnaire** for anything still ambiguous ("Do you have colored interior light strips?"), with the answers saved in the project. Fleet API comes later as an optional "sign in with Tesla" for exact detection.

## 9. Audio analysis library licensing ⚠️ decision needed

| Library | License | Notes |
|---|---|---|
| `essentia.js` 0.1.3 | **AGPL-3.0** | Strongest feature set (beat tracking, key, melody/pitch, onsets). AGPL would require open-sourcing our whole app, **including the server for community features**. |
| `meyda` 5.6.3 | MIT | Spectral features, RMS loudness, chroma, MFCC. No beat tracker. |
| `web-audio-beat-detector` 8.2.39 | MIT | Tempo/BPM and offset. |

**Recommendation:** if the project will be open source under AGPL anyway, essentia.js is the fastest route to good analysis. Otherwise build on MIT libraries (Meyda + a beat detector) plus our own onset, section-segmentation and pitch code. That's more work, but we keep licensing freedom. **This is a product decision for you.**

## 10. Other findings worth keeping

- **Multi-car shows:** Tesla ships 5-car and **8-car** synchronized examples (one `.fseq` per car, same audio). Our data model should allow N cars per project from the start, even if the UI ships with one.
- **Importing existing shows:** the examples include `.xsq` (xLights sequence XML) as well as `.fseq`. Importing `.fseq` is straightforward (raw frames → "baked" effects). Importing `.xsq` requires interpreting xLights effect definitions, which is harder but valuable for winning over xLights users.
- Tesla's examples provide **round-trip test fixtures**: decode → re-encode must be byte-identical.
- Community sharing sites already exist (xlightshows.io, teslalightshare.io). They're a possible integration or import source and also the competition for our future community features.

## 11. Open questions to resolve

1. Model X headlight variants vs. ramping behavior by build date (needs owner data or a real car).
2. Do the Model X center display and accent RGB channels work, and from which build?
3. What is channel 175 "Suspension" (reserved for a future air-suspension "dance"?). Ignore it until Tesla documents it.
4. Fleet API `vehicle_config` fields (check developer.tesla.com directly).
5. Licensing: AGPL-compatible or not? (§9)

### Sources
- [teslamotors/light-show](https://github.com/teslamotors/light-show): README, validator.py, xLights project folder, example shows
- [Tesla light-show PR #93 (cross-vehicle / Cybertruck docs)](https://github.com/teslamotors/light-show/pull/93/files)
- [TMC: Model X variations across years](https://teslamotorsclub.com/tmc/threads/model-x-variations-across-years.346874/)
- [TMC: Ambient lighting for 2023 Model X?](https://teslamotorsclub.com/tmc/threads/ambient-lighting-for-2023-model-x.311591/)
- [Not a Tesla App: new Model S/X with ambient lighting](https://www.notateslaapp.com/news/2747/teslas-new-model-s-and-model-x-spotted-new-color-grill-ambient-lighting-and-front-bumper-camera)
- [ev-inventory: Model X history of changes](https://ev-inventory.com/model-history/MX)
- [Tesla Light Show Guide 2026 (tslna.com)](https://tslna.com/en/tesla-light-show-custom-usb-sync-guide-2026/)
- [vpic-api (NHTSA vPIC wrapper)](https://pypi.org/project/vpic-api/0.4.0)
- [Tesla Fleet API: What is Fleet API?](https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api)
- npm registry: essentia.js, meyda, web-audio-beat-detector (license fields)

## 12. Vehicle versions in the app (added 2026-10-18)

Profiles live in `src/core/vehicles.ts`. What each is based on:

| Version | Basis | Confidence |
|---|---|---|
| Model S 2021+ | README tables; aux park + side markers combined per side; door handles | **[doc]** |
| Model 3 2017 – Oct 2020 | README: tails and license plate operate together, license channel ignored | **[doc]** |
| Model 3 Oct 2020 – 2023 | README Model 3/Y rules (ch 4–6 one light per side; all aux park + side markers combined); no fogs/aux park on Standard Range Plus | **[doc]** |
| Model 3 2024+ Premium / Performance | Same rules plus interior accent lights; front fogs reportedly removed with the refresh | **[unverified]** |
| Model 3 2026+ Standard | As above without the interior accent lights (and without matrix headlights) | **[unverified]**, press reports |
| Model X 2021 – 2024 | README tables | **[doc]** |
| Model X 2025+ | As 2021, plus accent RGB lights (reported ambient lighting) | **[unverified]** |
| Model Y 2020 – 2024 | README Model 3/Y rules; liftgate only with power liftgate | **[doc]** |
| Model Y 2025+ Premium / Performance | Released after Tesla's last README update (Dec 2024). Has front and rear light bars and accent lights. **Which channels drive the light bars is undocumented**; the preview assumes signature → front bar, tails → rear bar | **[unverified]** |
| Model Y 2026+ Standard | No front light bar, single-piece headlights (no matrix), no colored ambient lighting. Sources conflict on whether the rear light strip lights up (Edmunds/ArenaEV: removed; Tesla Oracle: strip present, only corner brake lights lit); the preview leaves it dark | **[unverified]**, press reports |
| Cybertruck 2024+ | README remapping (reverse via tails, bed lights via reverse, frunk via liftgate, frunk light via aux park, rear turn disabled), light bars | **[doc]** |

Trim sources: [Edmunds, 2026 Model Y Standard](https://www.edmunds.com/car-news/2026-tesla-model-y-standard-debut-first-look.html), [Tesla Oracle, Model Y Standard missing features](https://www.teslaoracle.com/2025/10/08/stripped-down-tesla-model-y-standard-is-here-price-range-missing-features/), [ArenaEV, Model Y Standard vs Premium](https://www.arenaev.com/10_things_you_lose_with_the_tesla_model_y_standard_-news-5256.php), [Tesery, Tesla fog lights guide](https://www.tesery.com/blogs/tesla-accessories-information/tesla-fog-lights-guide), [Notebookcheck, Juniper light bar](https://www.notebookcheck.net/2025-Tesla-Model-Y-Juniper-refresh-light-bar-can-be-switched-off.953038.0.html). Trims can't be told apart by VIN year alone, so a 2026 Model Y VIN offers both Premium and Standard.

VIN decoding (`src/core/vin.ts`) uses the standard VIN layout: position 4 is Tesla's model letter (S, 3, X, Y, C), 9 the check digit, 10 the model year, 11 the plant. It runs locally. Model years that span two versions (Model 3 2020, Model Y 2025) show both with a distinguishing hint. Region and options (side markers, rear fogs, Standard Range Plus, power liftgate) can't be read from the VIN; the composer marks those rows with *.

**Show length:** Tesla's current documentation has no 90-second or 5-minute limit; the maximum is 4 hours (§2). Older guides online mention shorter limits from earlier software.
