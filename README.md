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
pnpm check          # typecheck and lint
```

See `CONTEXT.md` for the vocabulary, `docs/adr/` for the decisions, and `AGENTS.md` for conventions.
