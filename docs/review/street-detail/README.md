# Localized street detail

Implements [#18](https://github.com/itechify/portfolio/issues/18).
Baseline: `29db36e073ca802c8f1331de3083e4ec877f2bc5`.

The entrance and curb now have selective worn paving corners, a hairline
crack, localized stains, a recessed drain with a framed grate, and two shallow
puddles. The drain sits in an actual opening in the sidewalk. The puddles use
opaque baked water and a damp perimeter with shared edges, so their silhouettes
remain visible in Light. Everything joins the existing street mesh and atlas;
there are no new runtime materials, animations, lights, or reflection passes.
Existing road reflections remain controlled by Quality Tier.

## Visual review

| View | Baseline | Completed |
| --- | --- | --- |
| Blender Street View | [Before](blender-before.png) | [After](blender-after.png) |
| Browser Street View, Full | [Before](street-before.png) | [After](street-after.png) |
| Entrance and curb, Full | [Before](pavement-before.png) | [After](pavement-after.png) |

Additional completed views: [pavement in Light](pavement-light.png),
[390 × 844 Street View in Light](narrow-light.png).

Normal-render-loop Street View comparisons:

| Viewport / Quality Tier | Baseline | Completed |
| --- | --- | --- |
| Desktop / Full | [Before](desktop-full-before.png) | [After](desktop-full-after.png) |
| Desktop / Balanced | [Before](desktop-balanced-before.png) | [After](desktop-balanced-after.png) |
| Desktop / Light | [Before](desktop-light-before.png) | [After](desktop-light-after.png) |
| Narrow / Full | [Before](narrow-full-before.png) | [After](narrow-full-after.png) |
| Narrow / Balanced | [Before](narrow-balanced-before.png) | [After](narrow-balanced-after.png) |
| Narrow / Light | [Before](narrow-light-before.png) | [After](narrow-light-after.png) |

Fixed-camera comparison captures remain in the ignored
`blender/renders/street-detail/before/web/` and `after/web/` directories:
Street View at 1280 × 800 and 390 × 844 in Full, Balanced, and Light, plus
pavement closeups in all three tiers. Fresh Blender comparisons are in
`blender/renders/model-details/street-before/` and `street-after/`.
The normal-render-loop Station comparisons are in
`blender/renders/street-detail/before/` and `verified-stations/`.
Use these for Full/Balanced reflection comparisons: the fixed-camera helper
renders the main scene and postprocessing only, so newly mounted reflection
targets are not refreshed after a Quality Tier switch.
The completed closeup confirms the drain recess and separation between the
repaired corner and crack. Detail stays localized and leaves customer routes
and the entrance clear. No new external artwork or audio was used.

## Reproduce

Run `pnpm model:build -- --no-render` for the baked GLB. For Blender review,
run `blender -b --python-exit-code 1 --python blender/review_details.py -- street-after`.
With `pnpm dev` running, set `REVIEW_OUTPUT` to the desired evidence directory
and run `pnpm exec node scripts/shot.mjs <url> --model-details`.
The review sets reduced motion before Entry, fixes the cameras, and selects
each Quality Tier explicitly so character timing cannot skew workload counts.
Use `--lighting` for all Station Menu Sections at both viewport sizes and all
three tiers.

## Rendering cost and validation

| Measurement | Baseline | Completed |
| --- | ---: | ---: |
| Creamery GLB bytes | 2,789,596 | 2,799,756 |
| Exported triangles | 193,973 | 194,584 |
| Meshes / primitives | 126 | 126 |
| Embedded images | 19 | 19 |
| Full / Balanced desktop draw calls | 131 | 131 |
| Light desktop draw calls | 115 | 115 |
| Full / Balanced narrow draw calls | 117 | 117 |
| Light narrow draw calls | 101 | 101 |
| Full / Balanced renderer textures | 54 | 54 |
| Light renderer textures | 38 | 38 |

The model adds 10,160 bytes (0.36%) and 611 triangles (0.32%). Main-render
triangle counts also rise by 611; no additional draw calls, texture allocations,
lights or rendering passes are introduced. The existing reflected render also
includes the street mesh, so Full/Balanced pay for the extra geometry there.
The recorded draw counts include the main render and postprocessing, not that
reflection pass. Raw reports: [before](metrics-before.json), [after](metrics-after.json).

These captures use desktop Chromium with SwiftShader. Rendering workload
counts are comparisons, not measurements of physical phone performance.
The small geometry increase does not change the Quality Tier strategy, but
the roughly 45 fps target still requires a real mid-range phone.

Headless Cycles build and GLB export completed. `pnpm check` and `pnpm build`
passed; the production build retains its existing large-bundle warning.
All 66 Node tests passed, including live DOM Sections, player lifecycle,
character/customer motion and Quality Tier behavior. Direct Hotspot checks
passed for About, Projects, Resume, Contact, Credits and Street View. All
Station Menu Sections were reviewed at desktop and narrow sizes across all
three tiers. The geometry changes were verified with renders rather than
implementation-coupled tests of polygon coordinates.

## Standards

No documented-standard violations. One optional maintenance suggestion:
derive the grate and sidewalk opening from shared drain bounds to keep future
dimension changes together. Existing numerical bounds agree; no correction
is needed for this build.

## Spec

No remaining implementation findings. Review caught downward polygon winding
and a coplanar overlap between the crack and repaired corner; both were
corrected before the final build. Final renders confirm Light readability and
localized detail. Actual phone frame rate remains unmeasured.

Review totals: Standards 0 violations, 1 optional suggestion; Spec 0 findings.
