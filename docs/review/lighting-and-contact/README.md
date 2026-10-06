# Baked lighting and serving contact

Implements [#13](https://github.com/itechify/portfolio/issues/13) and
[#15](https://github.com/itechify/portfolio/issues/15).
Baseline: `eef9959b936439abc8637d2addce08525abeade9`.

The counter now receives warm service light instead of a broad pink wash.
Reduced moonlight, frontal cyan fill and ambient light separate the jambs,
shelves and upper ledges while retaining cyan machinery and pink accents.
All architectural lighting is baked with Cycles. The exported Creamery still
uses unlit atlases; Section content remains live DOM.

Thinner, deeper grippers fit the finished cup. JJ and the customer contact
different heights during both handoffs, with offsets blended into pickup and
release. The tray rests on the fingers rather than floating above them. The
drinking path brings the lip to the mouth, and the cookie stays at the mouth
while consumed before the empty hand withdraws. Existing visit durations,
pauses, route coordination and Quality Tier behavior remain intact.

## Visual evidence

| Matching camera | Before | After |
| --- | --- | --- |
| Blender Street View | [Before](blender-before.png) | [After](blender-after.png) |
| Browser Street View, Full | [Before](street-before.png) | [After](street-after.png) |
| Browser counter, Full | [Before](counter-before.png) | [After](counter-after.png) |

Browser alternatives: [Balanced](balanced.png), [Light](light.png),
[390 × 844 in Light](narrow.png).
Contact captures: [handoff](handoff.png), [drinking](drink.png),
[eating](bite.png), [return](return.png), [cleanup](cleanup.png).

Fresh Blender renders at matching cameras also cover the counter, entrance,
kiosk, food and serving Props. They remain in the ignored
`blender/renders/model-details/lighting-before/` and `lighting-after/`.
The complete browser comparison is in `blender/renders/lighting/before/`
and `after/`: all Station Menu Sections in Full, Balanced and Light at desktop
and narrow sizes, plus the full visit and both regulars. The final standard
Station capture also covers the Shorts TV and its narrow panel.

## Rendering cost

| Measurement | Before | After |
| --- | ---: | ---: |
| Creamery GLB bytes | 2,880,060 | 2,790,580 |
| Exported triangles | 193,973 | 193,973 |
| Exported meshes / primitives | 126 | 126 |
| Embedded images | 19 | 19 |
| Full / Balanced Street View draw calls | 131 | 131 |
| Light Street View draw calls | 115 | 115 |
| Full / Balanced submitted triangles | 187,972 | 187,972 |
| Light submitted triangles | 187,956 | 187,956 |
| Full / Balanced renderer textures | 54 | 54 |
| Light renderer textures | 38 | 38 |

Download size falls by 89,480 bytes (3.11%). Grippers use the existing meshes
and atlas. No additional runtime lights, passes, textures or animation
controllers are introduced; the added contact calculations reuse scratch
vectors. Raw reports: [before](metrics-before.json), [after](metrics-after.json).

Measurements use identical cameras, reduced-motion pose, viewport and manual
Quality Tier in SwiftShader. These are workload comparisons, not device fps.
No rendering-cost regression was found; the roughly 45 fps target still needs
measurement on an actual mid-range phone.

## Reproduction and validation

- `pnpm model:build -- --no-render`: headless Cycles bake and GLB export.
- Headless `blender/review_details.py -- lighting-before` / `lighting-after`:
  matching Blender review cameras, run against the corresponding source.
- `pnpm exec node scripts/shot.mjs http://127.0.0.1:5173 --model-details`:
  fixed browser cameras and rendering counts.
- `pnpm exec node scripts/shot.mjs http://127.0.0.1:5173 --lighting`:
  Station Menu controls in all three Quality Tiers and both viewport sizes.
- `pnpm exec node scripts/shot.mjs http://127.0.0.1:5173 --customers`:
  complete visit, two regulars, contact closeups, reduced motion, Light,
  narrow presentation and completion while reading a Section.
- Set `REVIEW_OUTPUT` to preserve separate capture directories.
- Targeted red/green checks at the existing exported-rig controller seam:
  shared cup contact, drinking lip and cookie consumption. Existing checks
  retain handoff continuity, cleanup, quiet gaps, route coordination and
  coherent still poses.
- Direct Hotspot clicks passed for About, Street View, Resume and Projects.
- `pnpm check` and `pnpm build` passed.
- Full Node suite: all 60 tests passed after correcting the browser test URL.
  The initial full run passed 55; five Shorts checks tried the test's default
  port 5174 and received connection refused. Rerunning the browser suites with
  `ABOUT_TEST_URL` and `SHORTS_TEST_URL` set to `http://127.0.0.1:5173`
  passed all ten browser tests. No code change was needed.

The collaborative preview could navigate and interact but repeatedly failed
to capture screenshots. Visual evidence uses the repository's prescribed
`shot.mjs` review harness.

## Standards

No documented-standard violations or actionable new baseline smells found.
Reviewed against `AGENTS.md`, `CONTEXT.md` and ADRs 0001/0002. Lighting stays
in the scripted Cycles bake, Section content remains live DOM, and domain
vocabulary is consistent. Contact changes reuse the animation machinery and
scratch vectors. The evidence distinguishes workload counts from phone fps.

## Spec

No actionable findings against #13 or #15: no missing implementation,
incorrect behavior or scope creep identified. Matching renders show warmer
counter lighting, reduced cyan wash and clearer recesses. Contact captures
support handoffs, drinking, eating and cleanup. Scheduling and pause
durations remain unchanged. Actual phone fps is explicitly unmeasured.
The independent reviewer also reran all 16 customer behavior tests successfully.

Review totals: Standards 0 findings; Spec 0 findings.
