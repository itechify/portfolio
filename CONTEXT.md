# JJ's Creamery Portfolio

Jeffrey Davis's personal portfolio: a single immersive 3D scene of a cyberpunk milk-and-cookies shop, inspired by Jesse Zhou's "Jesse's Ramen" and a pixel artwork by Brandon James Greer (BJGPixel). Visitors explore the shop to find the portfolio content.

## Language

**Creamery**:
The shop itself: the building, its props, and the street around it, as one 3D scene. Named "JJ's Creamery".
_Avoid_: Store, shop, ramen shop, scene (when meaning the building)

**Reference**:
Greer's pixel artwork that the Creamery is modeled after. Inspiration only, credited on the site; its pixels are never reused.
_Avoid_: Source art, original, mockup

**Section**:
One body of portfolio content, such as About, Projects, Resume, Contact, or Credits.
_Avoid_: Page, tab, route

**Look**:
The visual target: a smooth-shaded 3D render of a pixel-art concept, with baked soft lighting and neon glow, not crisp pixel blocks.
_Avoid_: Pixel style, retro style

## Navigation

**Hotspot**:
A clickable object in the Creamery that leads to exactly one Station.
_Avoid_: Button, target, clickable, hitbox (that is an implementation detail)

**Station**:
A framed camera view that shows exactly one Section's content. Street View is also a Station.
_Avoid_: Page, view, scene, screen, camera position

**Street View**:
The default wide Station showing the whole Creamery from the street, where a visit begins and to which the neon sign returns the visitor.
_Avoid_: Home, overview, main view

**Entry**:
The moment the visitor presses the button on the loading screen and the Creamery opens, which also starts sound.
_Avoid_: Start, splash, intro

**Station Menu**:
The always-visible list of Stations that offers a second route to every Section, including by keyboard.
_Avoid_: Nav, navbar, sidebar

**Hint**:
The one-time prompt shown after Entry telling the visitor to click the glowing objects.
_Avoid_: Tutorial, tooltip, onboarding

## Scene

**Prop**:
A modeled object in the Creamery that is not a Hotspot, such as the cats, the trash can, the fans, or the counter goods.
_Avoid_: Decoration, asset, mesh

**Quality Tier**:
One of the graded sets of visual features the Creamery steps through to hold frame rate, from full effects down to reduced resolution. The visitor can also pick one by hand.
_Avoid_: Performance mode, graphics setting, LOD
