# Research Notes: Tesla's 3D Models (Model S, Cybertruck)

_Compiled 2026-10-19 from `xlights/tesla_xlights_show_folder.zip` in [teslamotors/light-show](https://github.com/teslamotors/light-show) @ `9f94951`. Confidence tags as in `01-tesla-lightshow-format.md`._

Tesla's xLights project includes two textured OBJ models and an xLights layout that places one xLights model per channel on top of them. The app downloads the zip from Tesla's repo at a pinned commit (8.6 MB, cached by the browser afterwards) and builds the playable car in the browser. Like the example shows, the files are **not re-hosted**, because Tesla publishes them without a license.

## Files [verified]

| | Model S | Cybertruck |
|---|---|---|
| Folder in zip | `Model_S/` | `Cybertruck/` |
| OBJ | `ModelS.obj`, 8.8 MB, 35,808 vertices | `Cybertruck.obj`, 15 MB, 65,276 vertices |
| Units | 0.5 cm (length about 1,004 units = 5.0 m) | 1 cm (about 568 units = 5.7 m) |
| Placement in the layout | origin, scale 1 | `WorldPosZ=-1000`, scale 2 |
| Axes | x = forward, y = up, z = right (left lights at -z) | same |

Layout units are therefore half-centimeters for both: meters = mesh units × layout scale / 200.

### OBJ groups

- **Model S:** `Body`, `Hood`, `Hood_Hinge_1/2`, `Trunk` (liftgate, including the tail light sections on it), `Spoiler`, `Door_LF/LR/RF/RR`, `Door_LF_Mirror`, `Door_RF_Mirror`, `Window_LF/LR/RF/RR`, `Windows_Top`, `Charge_Cap` (in the left tail light), `Lights`, `Wheels`.
- **Cybertruck:** only `Body`, `Windows`, `Lights`, `Wheels`. Moving parts have to be cut out by region.

### Materials (from the .mtl files)

The textures are baked ambient occlusion with the color baked in (Kd 0, map_Kd):

- S `BodySG`/`BodySG1` and Cybertruck `blinn3SG` use a **red paint bake** (`Exterior_AO.png`, `Paint_Red_AO.png`). We recolor it: red pixels are paint, and their brightness becomes shading under the chosen color.
- `Exterior_AO_Dark.png` covers trim and black parts.
- `Lights_AO.png` is clear lenses and `Lights_Red_AO.png` / `Lights_AO_Red.png` red lenses. Glass is an untextured material with Kd 0.08–0.1.

## Quirks found

- **UVs use whole-tile offsets** [verified]. Some Cybertruck materials run v = -1..0 or 1..2 (Maya UDIM style), so textures need repeat wrapping. Clamped sampling hits the texture's dark border and the truck renders almost black.
- **21 zero-length vertex normals** in `Cybertruck.obj` [verified] (0 in the Model S). Each one produces a NaN pixel, and the bloom pass spreads a single NaN over the whole frame, so views showing those faces went black until we swapped in face normals.
- **The Cybertruck's paint bake is much darker than the Model S's** [verified]. Its median red is 63/255 against 91/255, so the brightness reference comes from the texture itself (90th-percentile red) rather than a constant.

## Channel positions [verified]

Each light channel is an xLights model in `xlights_rgbeffects.xml` with `StartChannel="!Model S:<n>"` and a world position. The Cybertruck's are prefixed `CT ` and sit on the Cybertruck mesh; the rest sit on the Model S, including X-only channels like the falcon doors.

- `StringType="Single Color …"` models drive all their nodes from one channel. Reverse lights, rear fogs and the license plate are 2-node lines spanning both sides of the car.
- `StringType="Node Single Color"` models give each node its own channel: the Cybertruck light bars. Their layout entries are flat strips off to the side of the cars, so they don't locate the bars on the truck.
- `DisplayAs="Custom"` models (tail lights, brake light) are grids; we use their center.

The app parses this at runtime (`src/core/xlightsLayout.ts`). It assigns each lens triangle to the nearest channel within about 22 cm (26 cm on the Cybertruck), and splits the Cybertruck bars into LEDs by position across the truck: 60 front and 52 rear, numbered left to right. Channels with no lens geometry nearby (Model S side repeaters, license plate, rear fogs; Cybertruck bed lights) get a small lamp at the layout position.

Findings from the layout:
- On the Cybertruck, the **bed lights are on channel 28 (Reverse Lights)** and the **"Tail" channels (26/27) sit at the reverse light positions** [verified].
- The **brake light and rear turn signals sit on the rear light bar**, so those channels also light the bar LEDs near them [verified for the positions; how the car mixes them with the bar's own channels is unverified].
- Tesla's layout spells the channel 45 model "Right Rear Door Handle", though its channel list says "Rear Rear Door Handle" [verified].

## Moving parts

- **Model S:** from its groups. Windows drop, mirrors fold about their inner edge, the liftgate hinges at its top front edge, the charge port door swings out, and door handles slide out about 2 cm.
- **Cybertruck:** cut out by region around the layout's closure positions. Side glass goes to the nearest window position on the same side; mirror panels are cut within about 24 cm of the mirror position; the frunk lid is the top of the nose ahead of the windshield (x > 2.22 m, facing up); the charge port is within about 10 cm of its position. Opening angles are estimates [unverified].
