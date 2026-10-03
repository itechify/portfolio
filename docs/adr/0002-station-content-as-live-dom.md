---
status: accepted
---

# Station content is live DOM projected into the scene, not baked images

Each Station's Section content, such as About or Projects, is ordinary React DOM positioned in 3D over the object's screen face, and shown as a flat panel on narrow screens. Jesse's Ramen instead baked each screen as a Photoshop image and placed invisible hitboxes over its buttons. We chose live DOM because editing a project should be editing text, links should be real links, and the same DOM serves screen readers, crawlers, and the no-WebGL fallback with no second copy of the content.

## Consequences

- The Section DOM is always in the document, visually hidden when its Station is inactive, which is what makes the accessibility and crawler fallback free.
- DOM overlaid on WebGL cannot receive the scene's bloom or reflections, so the screens look slightly flatter than textured ones. Accepted for maintainability.
- When WebGL is unavailable, the same DOM is revealed as a plain page.
