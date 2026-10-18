# Tesla Lightshow Studio

A web app for creating custom Tesla light shows: one click to auto-generate a show from any song, and full frame-by-frame control when you want it.

> **Try it:** <https://nathanjgrace.github.io/tesla-lightshow-studio/>
>
> **Status:** early development. The app opens in an editor with a 3D Model X and a timeline composer, and can play Tesla's official example shows or your own `.fseq` files in sync with their music. Creating and editing shows comes next. See [docs/DESIGN.md](docs/DESIGN.md) for the plan.

## Running it on your own computer

You only need to do steps 1–3 once.

1. **Install Node.js** (the engine that runs the tools). Download the "LTS" version from <https://nodejs.org> and run the installer. To check it worked, open a terminal (macOS: the *Terminal* app; Windows: *PowerShell*) and type `node -v`. It should print a version number like `v22.x`.
2. **Download this project.** Either install [GitHub Desktop](https://desktop.github.com) and choose *Clone repository*, or in a terminal run:
   ```
   git clone https://github.com/nathanjgrace/tesla-lightshow-studio.git
   ```
3. **Install the project's libraries.** In a terminal, go into the project folder and install:
   ```
   cd tesla-lightshow-studio
   npm install
   ```
4. **Start the app:**
   ```
   npm run dev
   ```
   It prints an address like `http://localhost:5173`. Open that in your browser. Press `Ctrl+C` in the terminal to stop it.

## Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app locally and reloads it when code changes |
| `npm test` | Runs the automated tests |
| `npm run fixtures` | Downloads Tesla's example shows so the tests can check against real files |
| `npm run build` | Builds the final website into the `dist/` folder |
| `npm run typecheck` | Checks the code for type errors |

## Project layout

```
src/core/      The engine: channel map, file format, validator, vehicle profiles,
               light/closure simulation. No UI; fully tested.
src/library/   Catalog of Tesla's example shows, loaded from Tesla's GitHub repo.
src/app/       The editor UI (React): 3D car (three.js), composer timeline, playback.
docs/       Design doc and research notes.
scripts/    Helper scripts.
```

## License

[AGPL-3.0](LICENSE). Tesla's example shows used in tests belong to Tesla and are downloaded on demand, not included here.
