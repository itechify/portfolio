# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: friends, family, and the curious, arriving from a link Jeffrey shared. They are not evaluating him for a job; they want to see what he made and be impressed by it, then poke around to learn more about him. Secondary, unplanned but welcome: fellow developers and recruiters who find the site and want to see projects and reach him.

## Product Purpose

JJ's Creamery is Jeffrey Davis's personal site: a single immersive 3D scene of a cyberpunk dairy bar that visitors explore to find his projects, resume, contact details, and over time his hobbies, writing, and other creative work. The site itself is the headline project. Success is a visitor who stays to explore the whole shop, understands who Jeffrey is, and tells someone about it.

## Positioning

The content lives inside a hand-built world rather than on pages. It is modeled on Jesse Zhou's "Jesse's Ramen" and the pixel art of Brandon James Greer, but the shop is Jeffrey's own: a milk, cookies, and soft-serve bar built entirely from a reproducible Blender script, with content that stays real HTML so it is readable, linkable, and accessible. A template portfolio cannot truthfully claim any of that.

## Operating Context

- Visitors arrive on phones as often as desktops, from chat links and social posts, with no instruction. Many will never discover free orbit; the Station Menu and the Hint exist for them.
- Jeffrey has a full-time job and builds this on his own time with an AI agent doing the construction. There is no deadline.
- Vocabulary is fixed in `CONTEXT.md`: Creamery, Reference, Section, Look, Hotspot, Station, Street View, Entry, Station Menu, Hint, Prop, Quality Tier. Decisions are in `docs/adr/`.

## Capabilities and Constraints

- One immersive scene, no scrollable page. Clicking a Hotspot moves the camera to its Station and reveals that Section's content. Sections: About, Projects, Resume, Contact, Credits. Hotspot to Section mapping: cow screen is About, right-side machine is Projects, left kiosk is Resume, notice board is Contact, rooftop monitor is Credits, neon sign returns to Street View.
- Planned future Sections, not yet designed: hobbies and interests, writing or blog posts, other creative work. Each will need a Hotspot and a Station when it arrives.
- Section content is live DOM, always present in the document, visible only at its Station, shown as a panel on narrow screens. Projection onto the object's screen face on wide screens is planned (ADR 0002).
- The model comes from `blender/build.py` and is rebuilt, never hand-edited. Lighting is baked into texture atlases (ADR 0001); the browser renders baked meshes unlit and only neon and screens are emissive.
- Performance target is roughly 45 fps on a mid-range phone, held by Quality Tiers that drop reflections, bloom, and pixel ratio, plus a manual toggle.
- Entry button gates the scene and starts sound. Ambient music and click sounds come from CC0 sources, credited, with a visible mute.
- Deployed to Cloudflare Workers static assets from the public GitHub repo `itechify/portfolio`. Cloudflare Web Analytics, no cookies.
- Undecided: the exact hobby, writing, and creative-work content; whether a blog needs more than one Station; sound tracks.

## Brand Commitments

- Name: JJ's Creamery. The shop sells milk, cookies, and soft serve. The neon sign carries the name in readable letters with a decorative glyph strip beneath, in the manner of the Reference.
- Voice: playful and in-world. The shop talks like a shop: menu boards, receipts, "Pouring your milk...", "Open the shop", "Back to the street." Personality first, never at the cost of clarity.
- Credits are binding: Jesse Zhou for the concept, Brandon James Greer (BJGPixel) for the Reference, every audio source, and the main libraries. The Reference image is never committed, bundled, or shown.
- Typography commitment made during planning: a pixel font for headings and interface labels, a readable sans for body text.

## Evidence on Hand

- The only real project content is this site itself, with its public repo. Other projects (sorcerify, spotter, temple-discord-bot, and others on GitHub) exist but Jeffrey has not yet chosen which to include; do not add them unasked.
- No bio text, no photo, no resume PDF, no LinkedIn or email yet. About, Resume, and Contact are labelled placeholders until he supplies them. Do not invent biography, employers, or credentials.
- No testimonials, press, or metrics, and none should be fabricated.
- Reference image at `reference/bjgpixel-creamery-reference.png`, gitignored, comparison only.
- Review renders at `blender/renders/` and browser screenshots at `blender/renders/web/`, both gitignored and regenerated.

## Product Principles

1. The shop leads. Every interface element exists to get the visitor back into the scene, not to compete with it.
2. Delight on a phone counts as much as on a desktop. A visitor who never orbits must still reach everything.
3. Content is real and editable. Text is text, links are links, and nothing true about Jeffrey is baked into an image.
4. Credit the sources every time something new is borrowed.
5. Playful, never confusing. In-world language is allowed only where the meaning survives without the joke.

## Accessibility & Inclusion

- Every Section is reachable by keyboard through the Station Menu, and the full content is in the document for screen readers and crawlers.
- prefers-reduced-motion stops the fans, neon flicker, and camera glides, with instant cuts instead.
- Without WebGL the same content is shown as a plain page.
- Pixel fonts are reserved for headings and short labels; body copy stays in a readable sans at legible sizes.
