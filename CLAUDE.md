# Tesla Lightshow Studio

Web app for creating Tesla light shows (`.fseq` + audio on a USB drive). Plan: `docs/DESIGN.md`. Format facts and their sources: `docs/research/`.

## Collaboration

- Handle tooling (git, npm, GitHub settings, deploys) directly where possible rather than handing off steps.
- When a manual step is needed, give complete click-by-click instructions, including where to find each setting.
- Summaries should say what changed in plain language, not just list files.

## Code

- `src/core/` is plain TypeScript with no UI imports, and every module has tests next to it (`*.test.ts`). Keep it that way.
- `src/app/` is the React UI, kept thin.
- Format facts (byte values, limits, channel numbers) must trace back to Tesla's repo or a decoded example. Record new findings in `docs/research/` with a confidence tag.
- Tesla's example shows are not ours to redistribute: tests read them from `fixtures/` (gitignored, fetched by `npm run fixtures`) and skip when they're absent.

## Commands

- `npm test`, `npm run typecheck`, `npm run build` must pass before committing.
- `npm run fixtures` once per fresh checkout so the real-file tests run.

## Checking the UI

- Dev builds expose `window.__playback` (seek/play), `window.__editor` (project, selection) and `window.__scene` (3D scene) for automated browser checks; production builds don't.
- `VITE_LIBRARY_BASE` points the show library at another URL (e.g. a local copy of Tesla's `examples/` folder) when GitHub isn't reachable.

## Product direction

Aim to be the obvious best Tesla light show editor: desktop-first, modern and polished. Track competitors in `docs/COMPETITION.md` and keep suggesting features that widen the lead.
