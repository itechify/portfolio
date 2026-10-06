# Creamery facade, materials, and serving Props

Implements [#11](https://github.com/itechify/portfolio/issues/11),
[#12](https://github.com/itechify/portfolio/issues/12), and
[#14](https://github.com/itechify/portfolio/issues/14).
Fresh baseline: `2acd2b07eedfb09dcd751f198c56217b9540a8d4`.

The entrance now sits behind a real opening in the facade, framed by layered
jambs and a threshold. The service-opening frame projects farther forward,
giving the existing recess more depth without moving the counter or character
routes. Painted cabinets, molded bezels, brushed steel and tinted glass use
distinct baked treatments, with wear at contact edges. Cups have inner walls,
milk surfaces and pink rims; trays have rolled edges; cookies have irregular
silhouettes, toasted sides and embedded chips.

## Matching browser captures

The fixed review cameras use reduced motion to keep the same seated customer
pose in both captures. Full Quality Tier is held explicitly. These images show
the exported, baked GLB in the actual browser renderer.

| View | Before | After |
| --- | --- | --- |
| Street View | [Before](street-before.png) | [After](street-after.png) |
| Entrance and service opening | [Before](entrance-before.png) | [After](entrance-after.png) |
| Kiosk materials | [Before](kiosk-before.png) | [After](kiosk-after.png) |
| Counter and serving Props | [Before](food-before.png) | [After](food-after.png) |

Additional captures: [returned cup and empty tray](serving-after.png),
[390 × 844 viewport in Light](phone-after.png).

Matching Blender renders were also reviewed for Street View, counter,
entrance, kiosk, food and serving Props. They remain in the ignored
`blender/renders/model-details/before/` and `after/` directories. Browser Station
captures and the complete customer-pose sequence remain in
`blender/renders/web/`.

## Rendering cost

| Measurement | Before | After |
| --- | ---: | ---: |
| Creamery GLB bytes | 2,848,032 | 2,880,060 |
| Exported triangles | 188,887 | 193,973 |
| Exported meshes / primitives | 127 | 126 |
| Embedded images | 19 | 19 |
| Full Street View draw calls | 132 | 131 |
| Full Street View submitted triangles | 182,886 | 187,972 |
| Light Street View draw calls | 116 | 115 |
| Full renderer texture count | 54 | 54 |
| Light renderer texture count | 38 | 38 |

The download increases by 32,028 bytes (1.12%) and exported triangles by
5,086 (2.69%). New static detail joins the existing bake groups; no additional
atlas, live light, reflection pass, or animation controller is introduced.
The old emissive door window is now baked glass, removing one draw call.
Full, Balanced and Light retain the new details. Raw reports:
[before](metrics-before.json), [after](metrics-after.json).

Counts use the same fixed cameras, reduced-motion pose, viewport and manual
Quality Tier. The browser renderer ran with SwiftShader for reproducibility;
these are workload comparisons, not hardware performance claims. The roughly
45 fps target still requires measurement on a real mid-range phone.

## Verification

- Headless scripted build completed with Cycles baking and GLB export.
- Matching Blender renders and browser detail captures reviewed.
- Cookie placement check passed: three separate cookies lie flat inside the rim.
- Full Node test suite: 57 passed, 0 failed. Browser tests use the running dev
  server through `ABOUT_TEST_URL` and `SHORTS_TEST_URL`.
- Full customer review passed for both regulars: preparation, filling, serving,
  eating, drinking, return, cleanup, reduced motion, Light, and narrow layout.
- All Station screenshots completed; direct Hotspot clicks passed for About,
  Street View, Resume and Projects.
- TypeScript/Biome checks and production build passed.

The baseline Station screenshot run emitted YouTube third-party
`compute-pressure` permissions-policy messages. The final Station, model-detail
and customer review runs reported no browser errors.

## Code review

Standards: no documented-standard violations. One nonblocking maintenance
suggestion: the new model review and existing customer review duplicate the
small renderer-discovery/manual-render setup; a shared helper could centralize
future React Three Fiber adaptation. This was left local to keep the change
focused on model work.

Spec: no missing or incorrectly implemented requirements, and no scope creep
found against #11, #12 and #14. Existing Hotspot and rig names and transforms
were preserved. Actual-device fps remains the validation limit stated above.

Total: Standards 0 hard findings and 1 nonblocking suggestion; Spec 0 findings.
