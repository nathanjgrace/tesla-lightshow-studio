# 04 · What makes a light show read as "on the music"

Findings behind the auto-generate rework (`src/core/generate.ts`, `src/core/melody.ts`). Confidence tags:
- **[measured]** from Tesla's example shows in `fixtures/` or from our own output.
- **[source]** from a fetched page.
- **[snippet]** from search results only; the page couldn't be fetched.
- **[inferred]** our own reasoning.

## Measurements of Tesla's examples [measured]

Exterior lights only (channels 1–30), 20 ms frames. The four shows are Elevator Music, The Arrival, Ready for Assault and Cyber Symphony.

| | Elevator | Arrival | Ready for Assault | Cyber Symphony |
|---|---|---|---|---|
| Frames with no light on | 12% | 41% | 67% | 42% |
| Mean lights on at once | 3.2 | 4.2 | 3.3 | 8.8 |
| Light-on events per second | 1.4 | 1.8 | 2.7 | 9.7 |

- **How long a light stays on (10th–90th percentile):** 200–700 ms, 175–1850 ms and 60–440 ms in three of the shows.
- **Left/right symmetry:** Elevator Music alternates sides heavily (L/R agree 41% of the time when either is lit). The others are mostly symmetric (82–92%). The Cybertruck bars are mirror-symmetric 77% of the time.
- **Our first generator on Elevator Music (Model S):** 0% dark, 9.1 lights on at once, flashes all about 200 ms long. 97% of its light-ons were within 40 ms of an audio onset, so the timing was right. The problem was readability: too much lit at once, no darkness, and no variety in length.
- **After the rework:** 7% dark, 4.8 lights on at once, holds of 140–400 ms that follow note lengths.

## Principles [inferred, unless tagged]

1. **Darkness and few lights** make each hit visible. Christmas-display sequencers say the same: "nothing wrong with some 'off' time" [snippet, auschristmaslighting.com].
2. **One sound, one light family, kept constant.** Viewers learn the mapping within a few bars. Rotating patterns per bar, as one open-source generator does, hides it [source: github.com/hannohenni/Light-Show-Studio `js/generator.js`]. Light-O-Rama users report that instant sequences "seemed unrelated to the beat" [snippet, forums.lightorama.com/topic/29083].
3. **Hold for the note.** Sustained notes hold or ramp; short flashes are for percussion only [measured: Tesla holds lights up to about 1.8 s].
4. **Movement:** alternate left/right on rhythm (snares) and mirror for big hits [measured, above].
5. **Repetition:** a repeated chorus should repeat its choreography.
6. **Contrast at the drop:** a moment of darkness, then everything.
7. **Lead slightly:** place effects slightly before the beat [snippet, xLights Tip of the Day #009].
8. **Tesla's rules still bound everything:**
   - Ramps run 500/1000/2000 ms.
   - Model 3/Y channels 4–6 are one light.
   - Closure command limits apply [source: github.com/teslamotors/light-show].

## Melody without ML [source + inferred]

- **Our approach:** predominant-pitch tracking by harmonic summation, after Melodia (Salamon & Gómez 2012; Essentia's PredominantPitchMelodia) [snippet], simplified:
  1. Whitened spectrum, weighted to 120–3500 Hz.
  2. Harmonic sum over 10 harmonics at 0.84^h.
  3. A smooth path by dynamic programming.
  4. A voicing test: the best pitch must stand far above the frame's average.
  5. Notes split on a jump of more than 0.8 semitones or on a re-attack.
- **On Elevator Music:** 157 notes in 45 s, covering 77% of the song, in 0.4 s of compute [measured].
- **Alternatives considered:** YIN/McLeod via `pitchy` or `pitchfinder` are simpler but cope worse with full mixes. Separating drums from the rest by median filtering would help, but costs memory and time in the browser [inferred].

## Competitor note [source]

That Lightshow's builder looks songs up through its own server, which proxies iTunes Search (see `docs/COMPETITION.md`).
