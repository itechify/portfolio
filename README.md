# JJ's Creamery

Jeffrey Davis's portfolio: an immersive 3D cyberpunk dairy bar you explore to find the content. Inspired by Jesse Zhou's [Jesse's Ramen](https://www.jessezhou.com/) and the pixel art of [Brandon James Greer (BJGPixel)](https://www.youtube.com/@BJGPixel).

## How it works

- The shop is built by a Blender Python script (`blender/build.py`) that constructs every mesh, bakes the lighting, and exports `public/models/creamery.glb`. Nothing is hand-modeled.
- The site is Vite, React, and React Three Fiber. Clicking a glowing object moves the camera to it and reveals that section's content, which is ordinary HTML so it stays readable, linkable, and accessible.
- Deployed on Cloudflare Workers static assets.

## Develop

```sh
pnpm install
pnpm dev            # site at http://localhost:5173
pnpm model:build    # rebuild the model and a review render (needs Blender)
pnpm model:build --car-only # rebuild just the passing car
pnpm check          # typecheck and lint
node --test scripts/traffic.test.mjs # traffic, exported car, Quality Tiers
node scripts/shot.mjs http://localhost:5173 # Street View and Station screenshots
node scripts/shot.mjs http://localhost:5173 --traffic # traffic and Quality Tier review
node --test scripts/customer-visits.test.mjs # service, cat coexistence, exported rigs
node scripts/shot.mjs http://localhost:5173 --customers # service poses and phone review
```

The build also exports `public/models/traffic-car.glb`, with portable baked shading
and independent wheel pivots. Traffic loads after Entry when motion is enabled;
one car crosses Street View at a time, with 20–40 seconds of quiet between trips.
New trips wait while a Section is open. No audio or real-time lights are added.

Two robot regulars take turns visiting JJ at the middle counter stool. After
Entry, the first arrives in about five seconds; a visit takes about 30 seconds,
plus any pauses to yield to the cats, followed by a 15–30-second quiet gap.
They greet JJ, receive milk and a cookie, eat and drink, return the cup, and
leave to the left. Opening another Station lets the current visit finish and
stops new arrivals. Reduced motion shows one still seated customer with food.
Light keeps the whole visit while omitting secondary gestures and the customer
contact shadow. The robots and detachable serving Props are built in Blender
with portable baked shading; `customerVisits.ts` coordinates their rigid joints.

The cog button in Street View opens Quality Tier options: Auto, Full, Balanced,
and Light. Use arrow keys to select an option, or Escape to close the panel.
Auto starts at Balanced on touch devices and Full elsewhere, then steps down
after sustained rendering below 43 fps. Balanced reduces reflection resolution
and pixel density; Light removes the reflection and bloom and reduces pixel
density further. Model detail and traffic remain available in every tier. A
manual choice is remembered locally. Phone-sized screenshots check layout, not
the roughly 45 fps target: that still needs measurement on actual phone hardware.

See `CONTEXT.md` for the vocabulary, `docs/adr/` for the decisions, and `AGENTS.md` for conventions.
