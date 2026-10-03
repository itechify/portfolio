# JJ's Creamery portfolio

Jeffrey Davis's portfolio: one immersive 3D cyberpunk dairy bar, explored to reach the portfolio content. Modeled on Jesse Zhou's "Jesse's Ramen" and a pixel artwork by Brandon James Greer (BJGPixel), which is credited and never copied pixel for pixel.

Read `CONTEXT.md` before naming anything: it fixes the vocabulary (Creamery, Hotspot, Station, Section, Prop, Quality Tier) and the words to avoid. Decisions that look odd from the code are explained in `docs/adr/`; read the relevant one before "fixing" the thing it explains.

## Shape

- Web: Vite, TypeScript, React, React Three Fiber, drei. Single page, no server.
- Model: `blender/` holds a Python build script that constructs the whole Creamery, bakes lighting with Cycles, and exports the GLB (ADR 0001). Change the script, rebuild, look at the render. The `.blend` file is generated and ignored.
- Content: every Section is React DOM, always present in the document, projected over its object's screen on wide viewports and shown as a panel on narrow ones (ADR 0002). Editing content means editing that DOM, never a texture.
- Deploy: Cloudflare Workers static assets from `dist`, configured in `wrangler.jsonc`, built by Cloudflare's git integration on push to `main`.

## Conventions

- pnpm for every install and script. Biome for lint and format.
- Blender runs headless: `blender -b --python <script>`. The GUI is unreliable over Remote Desktop; rely on rendered PNGs to review the model.
- Motion and sound are opt-in: honour `prefers-reduced-motion`, and start audio only after Entry.
- Hold roughly 45 fps on a mid-range phone. If a feature can't, it belongs in a lower Quality Tier, not deleted.
- Credit Jesse Zhou, Brandon James Greer, and every audio source in the Credits Section whenever something new is used.
- The Reference image lives in `reference/`, which is gitignored. It is for visual comparison only and is never committed, bundled, or shown on the site, because the repo is public and the art is Greer's.
