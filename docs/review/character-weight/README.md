# Character weight and contact

Implements [#16](https://github.com/itechify/portfolio/issues/16) and
[#17](https://github.com/itechify/portfolio/issues/17).
Baseline: `0db636b93b4940a432c4cf449521561d5c6b7567`.

Robot steps use shorter placement prediction and strides, including small
corrective steps during braking and turns. Sitting approaches from behind the
stool, plants one boot on the ring, lifts the pelvis clear of the seat, then
brings up the second boot before settling. Separate steps around the ring bring
boots forward while the knees stay clear of the rim. Standing reverses that
support transfer.
The scripted model uses a 22 cm thigh and 34 cm shin (56 cm total as before),
placing the seated thigh above the cushion while the boot reaches the ring.
Ring contacts are fixed world positions, independent of body lift. The visit
sequence, durations, pauses and sidewalk reservation are unchanged.

Cats rise before completing their turns, shift their chest toward the supporting
paws, and give larger turns enough time for several planted steps. Paired chase
steps begin only once upright and translating. Jump anticipation now builds into
takeoff instead of relaxing before launch; landing compression precedes settling.
Routes, rest variation and shared-sidewalk coordination are preserved. Larger
turns can take longer to prepare. Light retains these contact changes; disabling
motion restores still cats and one seated customer.

## Fresh visual comparisons

The capture script uses deterministic 60 Hz updates, identical camera rules and
the first customer. Cat jump captures are relative to takeoff/landing, so changed
turn durations do not compare unrelated activities. Customer cameras follow the
robot horizontally; the approach to the stool changes that framing slightly.

| Phase | Before | After |
| --- | --- | --- |
| Walking, approach +9 s | [Before](before/walk.png) | [After](after/walk.png) |
| Turning, sit +0.8 s | [Before](before/turn.png) | [After](after/turn.png) |
| Sitting, +2.1 s | [Before](before/sit.png) | [After](after/sit.png) |
| Knee return and settling, +2.8 s | [Before](before/settle.png) | [After](after/settle.png) |
| Settled, sit +3.2 s | [Before](before/seated.png) | [After](after/seated.png) |
| Standing, +1.2 s | [Before](before/stand.png) | [After](after/stand.png) |
| Departure, +1 s | [Before](before/depart.png) | [After](after/depart.png) |
| Skadi rising/turning, 7.7 s | [Before](before/cat-turn.png) | [After](after/cat-turn.png) |
| Skadi walking, 9.1 s | [Before](before/cat-walk.png) | [After](after/cat-walk.png) |
| Skadi anticipating takeoff, -0.1 s | [Before](before/cat-crouch.png) | [After](after/cat-crouch.png) |
| Skadi landing on stool, +0.2 s | [Before](before/cat-land.png) | [After](after/cat-land.png) |
| Freya landing on stool, +0.2 s | [Before](before/freya-land.png) | [After](after/freya-land.png) |
| Customer coexistence | [Before](before/coexist.png) | [After](after/coexist.png) |
| Reduced motion | [Before](before/reduced.png) | [After](after/reduced.png) |
| Light | [Before](before/light.png) | [After](after/light.png) |
| Narrow Light, 390 x 844 | [Before](before/narrow.png) | [After](after/narrow.png) |

Presentation checks: [Street View](street.png),
[desktop About](desktop-about.png), [narrow About](narrow-about.png).
All six Stations were also captured in Full, Balanced and Light at 1280 x 800
and 390 x 844 under `blender/renders/web/stations/` (ignored).

## Rendering cost

| Measurement | Before | After |
| --- | ---: | ---: |
| GLB bytes | 2,790,580 | 2,789,596 |
| Exported meshes | 126 | 126 |
| Exported triangles | 193,973 | 193,973 |
| Walking capture draw calls / triangles | 77 / 139,608 | 77 / 139,608 |
| Seated Full draw calls / triangles | 105 / 182,134 | 105 / 182,134 |
| Light transition draw calls / triangles | 89 / 182,118 | 89 / 182,118 |
| Narrow transition draw calls / triangles | 60 / 139,460 | 62 / 140,676 |
| Full / Light renderer textures | 55 / 39 | 55 / 39 |
| Mean controller update, desktop milliseconds | 0.0841 | 0.0635 |

Raw reports: [before](before/metrics.json), [after](after/metrics.json).
Controller timing measures both controllers on the loaded GLB for five batches
of 6,000 updates after one warmup batch. It excludes rendering and is noisy;
the final pair measured a 0.0206 ms decrease per update, which should not be
treated as a guaranteed speedup. Render passes, mesh and triangle counts,
textures and per-frame allocations did not increase. The narrow transition's extra two
draws/1,216 triangles accompany different limb positions and a slightly different
tracking-camera frustum; the equivalent complete model and desktop workloads
are unchanged. These SwiftShader desktop measurements are workload comparisons,
not actual phone measurements. The roughly 45 fps mid-range phone target remains
unverified on physical hardware.

The leg proportions are authored in `blender/build.py`, rebuilt headlessly,
rendered, baked and exported by `pnpm model:build`. The customer bake retains
portable shading. [The fresh Blender customer render](blender-customers.png)
shows both revised rigs. No generated Blender file or Reference is included.

## Reproduction and checks

Start `pnpm dev`, then use PowerShell:

```powershell
$env:REVIEW_OUTPUT = 'blender/renders/weight-after'
pnpm exec node scripts/shot.mjs http://127.0.0.1:5173 --motion
```

To reproduce the baseline with the same capture helper and original GLB:

```powershell
New-Item -ItemType Directory -Force blender/renders/motion-baseline | Out-Null
foreach ($name in @('characterMotion.ts','catMotion.ts','customerVisits.ts','limbMotion.ts','quality.ts')) {
    $source = git show "0db636b:src/scene/$name"
    [IO.File]::WriteAllText((Join-Path $PWD "blender/renders/motion-baseline/$name"), ($source -join "`n"))
}
@'
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
writeFileSync('blender/renders/motion-baseline/creamery.glb', execFileSync('git', ['show', '0db636b:public/models/creamery.glb'], {maxBuffer: 10 * 1024 * 1024}));
'@ | pnpm exec node --input-type=module
$env:REVIEW_OUTPUT = 'blender/renders/weight-before'
pnpm exec node scripts/shot.mjs http://127.0.0.1:5173 --motion --motion-before
```

Validation includes `pnpm model:build`, `pnpm check`, `pnpm build`, the complete `scripts/*.test.mjs`
suite, `scripts/shot.mjs`, `scripts/shot.mjs --lighting`, and
`scripts/click-check.mjs`. Contact checks use the shipped GLB at the agreed
`createCharacterMotion` and `createCustomerVisits` boundaries. New regressions
cover planted support during stool transfers, leg and pelvis clearance at all four
stools, both regulars' starts/stops at 30/60 Hz in Full/Light, and both cats'
support during rising, turning and settling. Existing checks cover the full
visit, ten minutes of coexistence with Section changes, the chase, and reduced
motion. The build retains its existing large-JavaScript-chunk advisory.

All 66 tests pass in the final full invocation with
`SHORTS_TEST_URL=http://127.0.0.1:5173` (the Shorts tests otherwise default to
port 5174). The Spec review's knee-clearance finding is covered by the added
regression sampling both leg centerlines and solid limb volumes against the four
seat cylinders through sitting and standing.
