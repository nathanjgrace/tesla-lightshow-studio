# 05 · Community 3D models (Model X, 3, Y)

_Compiled 2026-11-14. Confidence tags as in `01-tesla-lightshow-format.md`._

Tesla publishes 3D models only of the Model S and Cybertruck. The other cars use Creative Commons models from Sketchfab, rigged by `scripts/models` (see its README). The files are not downloaded by the app from Sketchfab (downloads need a signed-in account), so the rigged results are stored in `public/models/`.

## Sources

| Car | Model | Author | License | Triangles / size after rigging |
|---|---|---|---|---|
| Model Y 2025+ | 2025 Tesla Model Y (`619601e7…`) | BloxBloger | CC BY-NC 4.0 | 310k / 2.0 MB |
| Model Y 2020 – 2024 | 2021 Tesla Model Y (`59e2ead3…`) | tonielpro520 | CC BY 4.0 | 305k / 2.1 MB |
| Model 3 2024+ | 2024 Tesla Model 3 + Interior (`61ddcbdb…`) | tonielpro520 | CC BY 4.0 | 165k / 2.2 MB |
| Model 3 2017 – 2023 | Tesla Model 3 (`bcecd9bf…`) | David_Holiday | CC BY 4.0 | 346k / 2.3 MB |
| Model X | Tesla Model X 2020 (`c61839793…`) | ItsDiyor | CC BY 4.0 | 226k / 2.5 MB |

Chosen from 12 downloaded candidates by rendering each. Rejected ones had baked-in author plates only, broken shading, missing materials, or one material for the whole car.

## Provenance [unverified]

Licenses are as the uploaders state. We cannot verify that the uploaders made the models:
- **Model 3 2024+:** material names such as `DAMAGE_GLASS` and `Rim_Blur_Spoke`, and a second uploader with identical geometry, point to a racing-game asset.
- **Model Y 2020, Model 3 2024+, Model Y 2025+:** root nodes named `….obj.cleaner.materialmerger.gles` (a conversion tool chain).
- **Model 3 2017:** the listing's description and tags mention other cars (leftover upload text).
- **Model X:** a license plate texture with the author's name (removed).

The 2025 Model Y is CC BY-NC: no commercial use.

## Lamp mapping

- **Model 3 (2017) and Model Y (2020)** follow Tesla's Model 3/Y headlight diagram (`images/3_headlights_reflector.png` in Tesla's repo): outer and inner main beams in the lower block, signature strip above, channels 4–6 as one lamp in the top outer corner, front turn along the bottom edge, and fog / aux park / side marker in the bumper lamp [doc for the layout; our cuts of each model are by eye].
- **Model X** follows Tesla's Model X diagram, with channels 6-5-4 across the top [doc]. The source is the pre-2021 body; the 2021+ front bumper differs.
- **Model 3 2024+ and Model Y 2025+** are newer than Tesla's documentation. Which channel drives which segment is **assumed**: light bars follow Signature (front) and Tail (rear); the slim headlights are divided by position. The 2024 Model 3 model has no fog, aux park or side marker lamps, so those channels light nothing on it.
- **Rear clusters:** where a model has no separate chambers, tail / brake / turn / reverse are split by position [inferred].
- **High brake light:** the Model 3s have it behind the rear glass, so a band of the glass over it is lit; the Model Ys get a strip at the top of the rear glass.
- **License plate lamps and charge port doors** are approximated on every model (none has them as separate parts).

## Rendering notes [verified]

- Glossy lamp covers mirrored the lot lamps and bloomed like a lit lamp; covers now have almost no specular.
- Chrome, alloy and glass highlights did the same; with reflections off they turn satin and gloss maps are dropped.
