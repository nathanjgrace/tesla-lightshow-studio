# Car model pipeline

Turns a downloaded 3D model into the rigged file the app loads (`public/models/<id>.glb`). Not needed to build or run the app; it has its own `package.json`.

```
cd scripts/models
npm install
SKETCHFAB_TOKEN=... node fetch.mjs            # downloads sources into .cache/ (not committed)
node inspect.mjs prims modelY-2025            # what's in the file
node build.mjs modelY-2025                    # writes public/models/modelY-2025.glb
```

## How a model is rigged

Each car has a config in `configs/<id>.mjs`. It says, in car coordinates (x forward, y up, z right, so the car's left is -z; meters; origin on the ground under the middle of the car):

- **`source`**: Sketchfab id, title, author, links and license. Shown in the app as the credit.
- **`front`**, **`lengthM`**: which source axis the nose points along, and the car's real length (the model is scaled to it).
- **`drop`**: selection rules for things to remove (ground planes, branded plates).
- **`materials`**: `[regex, preset]` pairs, first match wins, tested against `"<node name> | <material name>"`. Presets are in `build.mjs` (`paint`, `glass`, `lens`, `redlens`, `black`, `gloss`, `chrome`, `rubber`, `alloy`, ...). The app replaces `paint`, `glass`, `lens` and `redlens` with its own materials; `hide` removes; unmatched materials are kept as they are. A preset can be an object: `{ preset: 'alloy', color: [r, g, b], rough, metal, keepTexture }`.
- **`parts`**: moving parts by closure channel id (`liftgate`, `leftMirror`, `leftFrontWindow`, `leftFalconDoor`, `chargePort`, ...). Each has `select` rules and a `rig`: `{ type: 'hinge', pivot, axis, deg }` or `{ type: 'slide', vector }`, with optional `parent` (a window riding in a door) and `invert` (mirrors rest unfolded).
- **`lamps`**: `{ ids: [channel ids], color: 'white' | 'amber' | 'red', select: [rules], add: [boxes] }`. The selected triangles are copied into a glow mesh that the app lights with those channels; `add` makes small boxes where the model has no lamp geometry.
- **`beams`**, **`cabin`**: where the headlight (and fog) beams start on the right side, and where the cabin glow sits.

A selection rule is `{ mat: /regex/, not: /regex/, box: [[minX, minY, minZ], [maxX, maxY, maxZ]], mode }`:
- `mode: 'component'` (default): a connected piece is selected when it lies entirely inside the box.
- `mode: 'center'`: when the piece's middle is in the box.
- `mode: 'tri'`: triangle by triangle, by each triangle's middle.
- For lamps only, `clip: box` instead of `box` cuts the matching triangles at the box's faces, for crisp segment edges.

`node inspect.mjs pieces <id> out.glb "<regex>"` lists the connected pieces of matching primitives with their bounds and writes a color-coded GLB for viewing.

## Licenses

Sources are Creative Commons models from Sketchfab; see `public/models/CREDITS.md`. Keep the `source` block accurate: it is the attribution the licenses require.
