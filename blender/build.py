"""Builds the Creamery, renders review images, and exports the GLB.

Run headless:  blender -b --python blender/build.py [-- --no-render]
Everything here is reproducible; the .blend is never saved.

Contracts with the web code (src/scene/Creamery.tsx):
- A Hotspot is one single-material mesh named `hotspot_<...>` that matches
  src/stations.ts. Its detail is parented to it with names that do NOT start
  with `hotspot_`, so clicks on detail still resolve to the Hotspot.
- A spinning fan is one mesh named `prop_fan_N` whose local Z is the spin axis.
- Everything else is joined by material into `static_<material>` meshes.
"""

import math
import os
import random
import sys

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB_PATH = os.path.join(ROOT, "public", "models", "creamery.glb")
RENDER_DIR = os.path.join(ROOT, "blender", "renders")
FONT_PATH = os.path.join(ROOT, "blender", "fonts", "PressStart2P-Regular.ttf")

# Palette sampled from the Reference, plus a few supporting tones (sRGB hex).
PAL = {
    "blue": "4050e0",
    "blue_light": "5a6ef0",
    "blue_mid": "40a0e0",
    "blue_deep": "2838b0",
    "blue_dark": "1c2680",
    "purple": "402040",
    "purple_deep": "281030",
    "ink": "14102a",
    "teal": "48f0e0",
    "teal_pale": "a8f0f0",
    "pink": "f06ea8",
    "pink_pale": "f8b0d0",
    "white": "f8f8f8",
    "cream": "fff1d0",
    "cookie": "c98a4b",
    "choc": "5a3420",
    "steel": "8a98b8",
}

random.seed(7)


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def srgb(hex6):
    r, g, b = (int(hex6[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return (_lin(r), _lin(g), _lin(b), 1.0)


# ---------------------------------------------------------------- materials

_mats = {}


def mat(name, color, emit=None, strength=0.0, rough=0.7, metal=0.0):
    key = (name, color, emit, strength, rough, metal)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = srgb(PAL[color])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = srgb(PAL[emit])
        bsdf.inputs["Emission Strength"].default_value = strength
    _mats[key] = m
    return m


class M:
    """Material set, created once per build."""

    def __init__(self):
        self.blue = mat("blue", "blue")
        self.blue_light = mat("blue_light", "blue_light")
        self.blue_mid = mat("blue_mid", "blue_mid")
        self.blue_deep = mat("blue_deep", "blue_deep")
        self.blue_dark = mat("blue_dark", "blue_dark")
        self.purple = mat("purple", "purple")
        self.purple_deep = mat("purple_deep", "purple_deep")
        self.ink = mat("ink", "ink")
        self.pink = mat("pink", "pink")
        self.pink_pale = mat("pink_pale", "pink_pale")
        self.teal = mat("teal", "teal")
        self.teal_pale = mat("teal_pale", "teal_pale")
        self.white = mat("white", "white")
        self.cream = mat("cream", "cream")
        self.cookie = mat("cookie", "cookie")
        self.choc = mat("choc", "choc")
        self.steel = mat("steel", "steel", rough=0.35, metal=0.8)
        self.ground = mat("ground", "ink", rough=0.25)
        # emissives
        self.neon = mat("neon", "teal", emit="teal", strength=3.0)
        self.neon_soft = mat("neon_soft", "teal", emit="teal", strength=1.0)
        self.neon_pink = mat("neon_pink", "pink", emit="pink", strength=2.5)
        self.sign_plate = mat("sign_plate", "blue_dark", emit="teal", strength=0.12)
        self.screen = mat("screen", "teal_pale", emit="teal_pale", strength=1.2)
        self.screen_dark = mat("screen_dark", "purple_deep", emit="purple", strength=0.5)
        self.screen_pink = mat("screen_pink", "pink_pale", emit="pink_pale", strength=1.1)
        self.bulb = mat("bulb", "white", emit="white", strength=3.0)
        self.bulb_pink = mat("bulb_pink", "pink_pale", emit="pink_pale", strength=2.5)
        self.glow_white = mat("glow_white", "white", emit="white", strength=0.6)
        # The cow is a lit display, so its white reads at night without baked light
        self.cow_white = mat("cow_white", "white", emit="white", strength=0.45)
        self.cow_pink = mat("cow_pink", "pink", emit="pink", strength=0.5)


# ---------------------------------------------------------------- primitives


def _link(o):
    bpy.context.collection.objects.link(o)
    return o


def box(name, center, size, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    o.data.materials.append(material)
    return o


def cyl(name, center, radius, depth, material, axis="Z", verts=24, rot=None):
    base = {"Z": (0, 0, 0), "Y": (math.pi / 2, 0, 0), "X": (0, math.pi / 2, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=radius, depth=depth, location=center, rotation=rot or base
    )
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    return o


def ball(name, center, radius, material, subdiv=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=radius, location=center)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    return o


def cone(name, center, r1, r2, depth, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=16, radius1=r1, radius2=r2, depth=depth, location=center, rotation=rot
    )
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    return o


_font = None


def text(name, body, size, material, location, extrude=0.02, align="CENTER"):
    """Front-facing extruded text, converted to a mesh without operators."""
    global _font
    if _font is None:
        _font = bpy.data.fonts.load(FONT_PATH)
    cu = bpy.data.curves.new(f"{name}_curve", "FONT")
    cu.body = body
    cu.font = _font
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = "CENTER"
    tobj = _link(bpy.data.objects.new(f"{name}_text", cu))
    tobj.location = location
    tobj.rotation_euler = (math.pi / 2, 0, 0)  # local +Z (face) -> world -Y (front)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tobj.evaluated_get(dg))
    obj = _link(bpy.data.objects.new(name, me))
    obj.matrix_world = tobj.matrix_world.copy()
    bpy.data.objects.remove(tobj)
    bpy.data.curves.remove(cu)
    me.materials.append(material)
    return obj


def parent(children, hotspot):
    """Attach detail to a Hotspot while keeping world transforms."""
    for c in children:
        c.parent = hotspot
        c.matrix_parent_inverse = hotspot.matrix_world.inverted()


def join(objs, name):
    """Join meshes into the first one. Works headless via a context override."""
    objs = [o for o in objs if o is not None]
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    with bpy.context.temp_override(
        active_object=objs[0], selected_editable_objects=objs, selected_objects=objs
    ):
        bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


def screen_content(prefix, center, w, h, material, rows=4, seed=0, depth=0.012):
    """Dark text-like bars on a screen so it reads as a display, not a lamp.

    `center` is the screen face center; bars sit `depth` in front of it (-Y)."""
    rnd = random.Random(seed)
    out = []
    x0, z_top = center[0] - w / 2 + w * 0.08, center[2] + h / 2 - h * 0.14
    step = (h * 0.72) / rows
    for r in range(rows):
        bw = w * rnd.uniform(0.35, 0.8)
        out.append(
            box(
                f"{prefix}_bar_{r}",
                (x0 + bw / 2, center[1] - depth, z_top - r * step),
                (bw, 0.01, step * 0.42),
                material,
            )
        )
    return out


# ---------------------------------------------------------------- regions


def street(m):
    box("ground", (0, 0, -0.05), (16, 10, 0.1), m.ground)
    box("curb", (0, -2.3, 0.06), (12, 0.6, 0.12), m.purple)
    box("curb_edge", (0, -2.59, 0.1), (12, 0.04, 0.04), m.blue_deep)
    for i in range(-5, 6):
        box(f"paving_{i}", (i * 1.1, -2.3, 0.125), (0.02, 0.6, 0.01), m.ink)
    # drain grate right of the door
    for i in range(5):
        box(f"grate_{i}", (1.6 + i * 0.06, -2.1, 0.125), (0.02, 0.3, 0.01), m.ink)


def storefront(m):
    # Shell: the left two thirds is an open recess, the right third is solid.
    box("storefront_right", (1.6, 0, 1.3), (2.6, 3.0, 2.6), m.blue)
    box("storefront_back", (-1.3, 0.9, 1.3), (3.2, 1.2, 2.6), m.blue)
    box("storefront_left_wall", (-2.75, -0.6, 1.3), (0.3, 1.8, 2.6), m.blue)
    box("storefront_ceiling", (-1.3, -0.6, 2.45), (3.2, 1.8, 0.3), m.blue)
    box("recess_floor", (-1.3, -0.6, 0.05), (2.6, 1.8, 0.1), m.ink)
    box("recess_back_wall", (-1.3, 0.29, 1.2), (2.6, 0.02, 2.2), m.purple_deep)
    box("recess_left_wall", (-2.59, -0.6, 1.2), (0.02, 1.8, 2.2), m.purple_deep)
    box("recess_right_wall", (0.29, -0.6, 1.2), (0.02, 1.8, 2.2), m.purple_deep)
    box("recess_ceiling", (-1.3, -0.6, 2.29), (2.6, 1.8, 0.02), m.purple_deep)
    # Pillars and trims that frame the opening
    box("pillar_left", (-2.78, -1.55, 1.3), (0.26, 0.12, 2.6), m.blue_deep)
    box("pillar_mid", (0.42, -1.55, 1.3), (0.26, 0.12, 2.6), m.blue_deep)
    box("opening_trim", (-1.18, -1.55, 2.37), (2.94, 0.12, 0.14), m.blue_deep)
    box("opening_neon", (-1.18, -1.62, 2.31), (2.9, 0.02, 0.03), m.neon_soft)
    # Hanging shop sign inside the opening, like the Reference's small sign
    box("hang_chain_l", (-2.2, -1.2, 2.16), (0.015, 0.015, 0.26), m.steel)
    box("hang_chain_r", (-1.7, -1.2, 2.16), (0.015, 0.015, 0.26), m.steel)
    box("hang_sign", (-1.95, -1.2, 1.9), (0.7, 0.05, 0.3), m.purple)
    box("hang_sign_face", (-1.95, -1.23, 1.9), (0.62, 0.01, 0.22), m.screen_pink)
    text("hang_sign_text", "OPEN", 0.11, m.ink, (-1.95, -1.24, 1.9), extrude=0.004)

    # Door with window, handle, and a frame
    box("door_frame", (1.1, -1.5, 1.1), (0.84, 0.06, 2.2), m.blue_deep)
    box("door", (1.1, -1.5, 1.05), (0.7, 0.08, 2.1), m.purple_deep)
    box("door_window", (1.1, -1.55, 1.6), (0.46, 0.01, 0.7), m.screen_dark)
    box("door_window_bar", (1.1, -1.56, 1.6), (0.46, 0.005, 0.03), m.ink)
    box("door_handle", (1.36, -1.58, 1.0), (0.04, 0.06, 0.25), m.steel)
    box("door_kick", (1.1, -1.55, 0.2), (0.6, 0.01, 0.25), m.steel)
    # Three wall lamps above the board
    for i, x in enumerate((1.75, 2.0, 2.25)):
        lamp_m = m.bulb_pink if i == 1 else m.bulb
        cyl(f"wall_lamp_ring_{i}", (x, -1.52, 2.35), 0.1, 0.05, m.purple, axis="Y")
        cyl(f"wall_lamp_{i}", (x, -1.54, 2.35), 0.07, 0.04, lamp_m, axis="Y")
    # Vent grille and a downpipe on the right wall
    for i in range(4):
        box(f"vent_slat_{i}", (2.55, -1.52, 0.5 + i * 0.09), (0.5, 0.02, 0.03), m.ink)
    cyl("downpipe", (2.8, -1.45, 1.5), 0.05, 2.6, m.blue_dark)
    box("downpipe_bracket_1", (2.8, -1.45, 0.6), (0.14, 0.14, 0.04), m.steel)
    box("downpipe_bracket_2", (2.8, -1.45, 2.0), (0.14, 0.14, 0.04), m.steel)

    # Notice board: Contact. Papers and pins are children of the Hotspot.
    board = box("hotspot_contact_board", (2.0, -1.52, 1.75), (0.9, 0.06, 0.8), m.blue_mid)
    papers = []
    for i, (x, z, w, h, mt) in enumerate(
        (
            (1.75, 1.9, 0.26, 0.3, m.white),
            (2.05, 1.95, 0.22, 0.22, m.pink_pale),
            (2.3, 1.85, 0.2, 0.28, m.teal_pale),
            (1.85, 1.55, 0.3, 0.2, m.cream),
            (2.2, 1.55, 0.24, 0.22, m.white),
        )
    ):
        papers.append(box(f"paper_{i}", (x, -1.56, z), (w, 0.01, h), mt))
        papers.append(box(f"pin_{i}", (x, -1.57, z + h / 2 - 0.03), (0.03, 0.01, 0.03), m.pink))
        for r in range(2):
            papers.append(
                box(f"paper_{i}_line_{r}", (x, -1.565, z + 0.03 - r * 0.06), (w * 0.6, 0.004, 0.015), m.ink)
            )
    box("board_frame_t", (2.0, -1.53, 2.17), (0.96, 0.06, 0.04), m.blue_deep)
    box("board_frame_b", (2.0, -1.53, 1.33), (0.96, 0.06, 0.04), m.blue_deep)
    parent(papers, board)

    # Trash can with lid and a bag beside it
    cyl("prop_trash", (1.0, -1.95, 0.3), 0.18, 0.6, m.teal)
    cyl("prop_trash_band", (1.0, -1.95, 0.45), 0.185, 0.04, m.blue_deep)
    cyl("prop_trash_lid", (1.0, -1.95, 0.62), 0.2, 0.04, m.blue_mid)
    cyl("prop_trash_knob", (1.0, -1.95, 0.66), 0.04, 0.04, m.blue_deep)
    ball("prop_trash_bag", (1.32, -1.9, 0.16), 0.17, m.ink, subdiv=2)


def counter_interior(m):
    # Counter with a pink top and a striped front
    box("counter_top", (-1.2, -1.3, 0.95), (2.6, 0.42, 0.08), m.pink)
    box("counter_base", (-1.2, -1.27, 0.45), (2.6, 0.3, 0.9), m.blue_deep)
    for i in range(6):
        box(f"counter_stripe_{i}", (-2.3 + i * 0.44, -1.43, 0.45), (0.06, 0.01, 0.8), m.pink)
    box("counter_kick", (-1.2, -1.43, 0.05), (2.6, 0.02, 0.1), m.ink)
    # Stools: chrome post, foot ring, pink seat
    for i, x in enumerate((-2.0, -1.2, -0.4)):
        cyl(f"stool_{i}_base", (x, -1.9, 0.02), 0.14, 0.04, m.steel)
        cyl(f"stool_{i}_post", (x, -1.9, 0.27), 0.035, 0.5, m.steel)
        cyl(f"stool_{i}_ring", (x, -1.9, 0.22), 0.11, 0.02, m.steel)
        cyl(f"stool_{i}_seat", (x, -1.9, 0.55), 0.21, 0.08, m.pink)
        cyl(f"stool_{i}_seat_rim", (x, -1.9, 0.505), 0.21, 0.015, m.purple)
    # Things on the counter: cups, a napkin box, a cookie plate
    for i, x in enumerate((-2.15, -1.75, -0.95)):
        cyl(f"cup_{i}", (x, -1.3, 1.03), 0.045, 0.09, m.white)
        cyl(f"cup_{i}_lid", (x, -1.3, 1.08), 0.05, 0.015, m.pink)
    cyl("plate", (-0.55, -1.3, 1.0), 0.14, 0.015, m.white)
    for i in range(3):
        cyl(f"plate_cookie_{i}", (-0.6 + i * 0.07, -1.3, 1.02 + i * 0.02), 0.06, 0.02, m.cookie, verts=12)
    box("napkins", (-1.4, -1.25, 1.03), (0.12, 0.1, 0.08), m.teal_pale)

    # Back wall: menu board, shelves, soft-serve machine
    board = box("menu_board", (-1.5, 0.27, 1.95), (1.5, 0.03, 0.5), m.screen)
    board_rows = screen_content("menu", (-1.5, 0.255, 1.95), 1.5, 0.5, m.ink, rows=3, seed=1)
    for i, z in enumerate((2.08, 1.95, 1.82)):
        box(f"menu_price_{i}", (-0.95, 0.24, z), (0.14, 0.01, 0.05), m.pink)
    text("menu_title", "MENU", 0.09, m.ink, (-1.5, 0.235, 2.14), extrude=0.003)
    # shelves with milk cartons, cookie jars, bottles
    box("shelf_1", (-1.6, 0.17, 1.45), (1.6, 0.26, 0.04), m.blue_mid)
    box("shelf_2", (-1.6, 0.17, 1.1), (1.6, 0.26, 0.04), m.blue_mid)
    for i, x in enumerate((-2.25, -2.08, -1.91)):
        box(f"milk_{i}", (x, 0.17, 1.57), (0.12, 0.12, 0.2), m.white)
        box(f"milk_{i}_cap", (x, 0.17, 1.69), (0.06, 0.06, 0.04), m.pink)
        box(f"milk_{i}_label", (x, 0.1, 1.55), (0.08, 0.01, 0.08), m.teal)
    for i, x in enumerate((-1.6, -1.35)):
        cyl(f"jar_{i}", (x, 0.17, 1.58), 0.09, 0.22, m.teal_pale, verts=16)
        cyl(f"jar_{i}_cookies", (x, 0.17, 1.55), 0.075, 0.14, m.cookie, verts=16)
        cyl(f"jar_{i}_lid", (x, 0.17, 1.7), 0.095, 0.03, m.choc, verts=16)
    for i, x in enumerate((-1.05, -0.95)):
        cyl(f"bottle_{i}", (x, 0.17, 1.58), 0.035, 0.22, m.pink_pale, verts=10)
        cyl(f"bottle_{i}_neck", (x, 0.17, 1.72), 0.015, 0.06, m.pink, verts=10)
    for i in range(5):
        box(f"shelf2_box_{i}", (-2.2 + i * 0.3, 0.17, 1.2), (0.2, 0.16, 0.16), (m.pink, m.teal, m.cream)[i % 3])
    # soft-serve machine at the right end of the back counter
    box("softserve_body", (-0.45, -0.05, 1.3), (0.5, 0.45, 0.7), m.white)
    box("softserve_panel", (-0.45, -0.29, 1.45), (0.4, 0.01, 0.2), m.pink)
    box("softserve_screen", (-0.45, -0.3, 1.47), (0.2, 0.01, 0.08), m.screen)
    for i, x in enumerate((-0.57, -0.33)):
        cyl(f"softserve_spout_{i}", (x, -0.33, 1.05), 0.03, 0.14, m.steel)
        box(f"softserve_lever_{i}", (x, -0.4, 1.13), (0.03, 0.14, 0.03), m.pink)
    cone("softserve_cone", (-0.45, -0.3, 1.78), 0.0, 0.12, 0.22, m.cookie)
    ball("softserve_swirl", (-0.45, -0.3, 1.95), 0.1, m.cream, subdiv=2)
    # Round window at the back with a silhouette
    cyl("back_window_ring", (0.0, 0.25, 1.9), 0.3, 0.06, m.blue_mid, axis="Y")
    cyl("back_window", (0.0, 0.24, 1.9), 0.25, 0.04, m.screen_pink, axis="Y")
    # A cat silhouette in the window: body, head, two ears, a tail
    cyl("window_cat_body", (0.0, 0.21, 1.78), 0.09, 0.02, m.ink, axis="Y", verts=16)
    cyl("window_cat_head", (0.07, 0.21, 1.9), 0.06, 0.02, m.ink, axis="Y", verts=16)
    box("window_cat_ear_l", (0.03, 0.21, 1.96), (0.03, 0.02, 0.05), m.ink)
    box("window_cat_ear_r", (0.11, 0.21, 1.96), (0.03, 0.02, 0.05), m.ink)
    box("window_cat_tail", (-0.12, 0.21, 1.82), (0.1, 0.02, 0.025), m.ink, rot=(0, math.radians(-30), 0))

    # Barista robot: body, head with visor, arms, one holding a cup
    box("prop_barista_body", (-0.9, -0.55, 1.3), (0.42, 0.34, 0.7), m.blue_mid)
    box("prop_barista_belly", (-0.9, -0.73, 1.3), (0.22, 0.02, 0.24), m.screen_dark)
    box("prop_barista_neck", (-0.9, -0.55, 1.68), (0.14, 0.14, 0.08), m.steel)
    box("prop_barista_head", (-0.9, -0.55, 1.88), (0.36, 0.34, 0.32), m.purple)
    box("prop_barista_visor", (-0.9, -0.73, 1.9), (0.28, 0.02, 0.1), m.screen)
    box("prop_barista_eye_l", (-0.97, -0.745, 1.9), (0.04, 0.01, 0.05), m.ink)
    box("prop_barista_eye_r", (-0.83, -0.745, 1.9), (0.04, 0.01, 0.05), m.ink)
    cyl("prop_barista_antenna", (-0.9, -0.55, 2.1), 0.015, 0.14, m.steel)
    ball("prop_barista_antenna_tip", (-0.9, -0.55, 2.18), 0.035, m.bulb_pink)
    cyl("prop_barista_arm_l", (-1.16, -0.75, 1.3), 0.04, 0.5, m.steel, rot=(math.radians(60), 0, 0))
    cyl("prop_barista_arm_r", (-0.64, -0.75, 1.3), 0.04, 0.5, m.steel, rot=(math.radians(60), 0, 0))
    cyl("prop_barista_cup", (-0.64, -1.0, 1.15), 0.05, 0.1, m.white)
    cyl("prop_barista_tray", (-1.18, -0.98, 1.1), 0.12, 0.015, m.steel)
    # Pendant lamps over the counter
    for i, x in enumerate((-2.0, -1.2, -0.4)):
        cyl(f"pendant_{i}_cord", (x, -0.9, 2.12), 0.008, 0.34, m.ink)
        cone(f"pendant_{i}_shade", (x, -0.9, 1.9), 0.12, 0.03, 0.14, m.pink)
        cyl(f"pendant_{i}_bulb", (x, -0.9, 1.84), 0.04, 0.03, m.bulb)
    return board_rows


def sign(m):
    box("sign_band", (0, 0, 3.0), (6.6, 3.4, 0.8), m.blue_deep)
    box("sign_band_top", (0, 0, 3.42), (6.7, 3.5, 0.06), m.blue_dark)
    box("sign_lip", (0, -1.7, 2.6), (6.6, 0.1, 0.06), m.teal)
    box("sign_backplate", (-0.9, -1.72, 3.0), (4.5, 0.06, 0.72), m.purple)
    plate = box("hotspot_home_sign", (-0.9, -1.76, 3.0), (4.3, 0.04, 0.56), m.sign_plate)
    kids = []
    # Neon tube border around the plate
    for name, c, s in (
        ("sign_tube_t", (-0.9, -1.79, 3.26), (4.3, 0.015, 0.015)),
        ("sign_tube_b", (-0.9, -1.79, 2.74), (4.3, 0.015, 0.015)),
        ("sign_tube_l", (-3.05, -1.79, 3.0), (0.015, 0.015, 0.52)),
        ("sign_tube_r", (1.25, -1.79, 3.0), (0.015, 0.015, 0.52)),
    ):
        kids.append(box(name, c, s, m.neon))
    # Cup icon at the left, like the Reference
    kids.append(box("sign_cup", (-2.75, -1.8, 3.0), (0.22, 0.02, 0.26), m.pink))
    kids.append(box("sign_cup_lid", (-2.75, -1.81, 3.15), (0.28, 0.02, 0.05), m.pink))
    kids.append(cyl("sign_cup_straw", (-2.68, -1.81, 3.22), 0.015, 0.12, m.white))
    kids.append(box("sign_cup_band", (-2.75, -1.81, 3.0), (0.22, 0.01, 0.05), m.ink))
    kids.append(text("sign_text", "JJ's CREAMERY", 0.3, m.neon_pink, (-0.65, -1.79, 3.07), extrude=0.03))
    # Glyph strip beneath the name
    rnd = random.Random(3)
    x = -2.3
    while x < 1.1:
        w = rnd.choice((0.06, 0.1, 0.14))
        kids.append(box(f"glyph_{int(x * 100)}", (x, -1.79, 2.8), (w, 0.015, 0.05), m.neon))
        if rnd.random() < 0.5:
            kids.append(box(f"glyph_{int(x * 100)}_b", (x, -1.79, 2.86), (w * 0.6, 0.015, 0.02), m.neon))
        x += w + rnd.choice((0.05, 0.08))
    parent(kids, plate)
    # Pink vents right of the sign
    box("vent_frame", (2.5, -1.71, 3.0), (1.6, 0.04, 0.72), m.purple)
    for i in range(5):
        box(f"vent_{i}", (2.5, -1.74, 2.72 + i * 0.14), (1.4, 0.05, 0.06), m.pink)
        box(f"vent_gap_{i}", (2.5, -1.735, 2.79 + i * 0.14), (1.4, 0.03, 0.03), m.ink)


def upper(m):
    box("upper", (0, 0.1, 4.5), (5.4, 2.8, 2.2), m.blue)
    box("upper_cornice", (0, 0.1, 5.58), (5.5, 2.9, 0.06), m.blue_dark)
    # Panels in slightly different blues break up the big face
    box("upper_panel_a", (0.4, -1.32, 5.1), (2.2, 0.06, 0.5), m.blue_light)
    box("upper_panel_b", (-1.6, -1.32, 3.75), (1.6, 0.06, 0.4), m.blue_light)
    box("upper_panel_c", (2.0, -1.32, 3.75), (1.0, 0.06, 0.4), m.blue_mid)
    # Control panel with lights, top middle like the Reference
    box("ctrl_panel", (-0.1, -1.34, 5.1), (0.7, 0.06, 0.3), m.purple)
    for i, mt in enumerate((m.bulb_pink, m.neon, m.bulb)):
        box(f"ctrl_light_{i}", (-0.3 + i * 0.2, -1.38, 5.1), (0.08, 0.02, 0.08), mt)
    box("ctrl_grille", (-0.1, -1.37, 4.98), (0.5, 0.01, 0.03), m.ink)
    # Cables snaking from the control panel to the cow screen and down the side
    cyl("cable_1", (-0.9, -1.4, 5.0), 0.02, 1.2, m.ink, axis="X")
    cyl("cable_2", (-1.6, -1.4, 5.0), 0.02, 0.8, m.ink, rot=(0, math.radians(100), 0))
    cyl("cable_3", (2.65, -1.4, 4.3), 0.02, 2.6, m.ink)
    box("cable_clip_1", (2.65, -1.38, 3.9), (0.08, 0.06, 0.06), m.steel)
    box("cable_clip_2", (2.65, -1.38, 4.9), (0.08, 0.06, 0.06), m.steel)
    cyl("pipe_h", (1.4, -1.42, 3.65), 0.05, 2.6, m.steel, axis="X")
    cyl("pipe_elbow", (2.7, -1.42, 3.65), 0.07, 0.14, m.steel, axis="X")

    # Cow screen: About. The plate is the Hotspot; the face is its children.
    box("cow_frame", (-1.9, -1.55, 4.3), (1.7, 0.3, 1.5), m.purple)
    box("cow_frame_inner", (-1.9, -1.7, 4.3), (1.5, 0.02, 1.3), m.ink)
    plate = box("hotspot_about_cowscreen", (-1.9, -1.72, 4.3), (1.4, 0.04, 1.2), m.screen_dark)
    f = []  # face parts sit at y = -1.76 and -1.77
    f.append(box("cow_face", (-1.9, -1.76, 4.25), (0.8, 0.02, 0.7), m.cow_white))
    f.append(box("cow_face_top", (-1.9, -1.76, 4.63), (0.56, 0.02, 0.1), m.cow_white))
    f.append(box("cow_patch_l", (-2.2, -1.77, 4.45), (0.22, 0.02, 0.26), m.ink))
    f.append(box("cow_patch_r", (-1.68, -1.77, 4.15), (0.18, 0.02, 0.2), m.ink))
    f.append(box("cow_ear_l", (-2.42, -1.76, 4.6), (0.24, 0.02, 0.14), m.cow_white))
    f.append(box("cow_ear_r", (-1.38, -1.76, 4.6), (0.24, 0.02, 0.14), m.cow_white))
    f.append(box("cow_ear_l_in", (-2.46, -1.77, 4.6), (0.12, 0.02, 0.07), m.cow_pink))
    f.append(box("cow_ear_r_in", (-1.34, -1.77, 4.6), (0.12, 0.02, 0.07), m.cow_pink))
    f.append(box("cow_horn_l", (-2.2, -1.76, 4.72), (0.08, 0.02, 0.12), m.cream))
    f.append(box("cow_horn_r", (-1.6, -1.76, 4.72), (0.08, 0.02, 0.12), m.cream))
    f.append(box("cow_eye_l", (-2.08, -1.78, 4.4), (0.1, 0.02, 0.1), m.ink))
    f.append(box("cow_eye_r", (-1.72, -1.78, 4.4), (0.1, 0.02, 0.1), m.ink))
    f.append(box("cow_eye_l_hi", (-2.1, -1.79, 4.42), (0.03, 0.01, 0.03), m.white))
    f.append(box("cow_eye_r_hi", (-1.74, -1.79, 4.42), (0.03, 0.01, 0.03), m.white))
    f.append(box("cow_snout", (-1.9, -1.78, 4.05), (0.5, 0.02, 0.24), m.cow_pink))
    f.append(box("cow_nostril_l", (-2.0, -1.79, 4.06), (0.06, 0.01, 0.06), m.ink))
    f.append(box("cow_nostril_r", (-1.8, -1.79, 4.06), (0.06, 0.01, 0.06), m.ink))
    parent(f, plate)

    # Three fans: housing with grille bars, and a single-mesh blade assembly
    for i, x in enumerate((0.5, 1.4, 2.3)):
        box(f"fan_housing_{i}", (x, -1.35, 4.65), (0.78, 0.16, 0.78), m.purple)
        cyl(f"fan_housing_ring_{i}", (x, -1.44, 4.65), 0.34, 0.03, m.ink, axis="Y", verts=32)
        hub = cyl(f"prop_fan_{i + 1}", (x, -1.46, 4.65), 0.07, 0.06, m.teal, axis="Y", verts=12)
        blades = []
        for b in range(4):
            a = math.radians(b * 90 + 20)
            blades.append(
                box(
                    f"fan_blade_{i}_{b}",
                    (x + math.cos(a) * 0.17, -1.46, 4.65 + math.sin(a) * 0.17),
                    (0.26, 0.02, 0.1),
                    m.teal,
                    rot=(0, -a, 0),
                )
            )
        join([hub] + blades, f"prop_fan_{i + 1}")
        for g in range(3):
            box(f"fan_grille_{i}_{g}", (x, -1.49, 4.45 + g * 0.2), (0.66, 0.01, 0.02), m.ink)


def rooftop(m):
    box("roof", (0, 0.1, 5.65), (5.6, 3.0, 0.1), m.blue_deep)
    for name, c, s in (
        ("roof_lip_f", (0, -1.38, 5.75), (5.6, 0.08, 0.14)),
        ("roof_lip_b", (0, 1.58, 5.75), (5.6, 0.08, 0.14)),
        ("roof_lip_l", (-2.76, 0.1, 5.75), (0.08, 3.0, 0.14)),
        ("roof_lip_r", (2.76, 0.1, 5.75), (0.08, 3.0, 0.14)),
    ):
        box(name, c, s, m.blue_dark)
    # Vent unit with a grille
    box("roof_unit", (-0.5, 0.3, 6.0), (1.0, 0.8, 0.6), m.purple)
    box("roof_unit_top", (-0.5, 0.3, 6.32), (1.06, 0.86, 0.04), m.ink)
    for g in range(4):
        box(f"roof_unit_slat_{g}", (-0.5, -0.11, 5.85 + g * 0.1), (0.8, 0.02, 0.03), m.ink)
    cyl("roof_unit_fan", (-0.5, -0.12, 6.1), 0.14, 0.02, m.teal, axis="Y", verts=16)
    # Antennas with crossbars and a wire between them
    for i, x in enumerate((-2.0, -1.2)):
        cyl(f"antenna_{i}", (x, 0.6, 6.45), 0.02, 1.6, m.ink)
        for k in range(3):
            box(f"antenna_{i}_bar_{k}", (x, 0.6, 6.6 + k * 0.25), (0.3 - k * 0.07, 0.02, 0.02), m.ink)
    box("antenna_wire", (-1.6, 0.6, 7.2), (0.8, 0.008, 0.008), m.ink)
    ball("bird", (-1.45, 0.6, 7.25), 0.04, m.ink)
    cyl("antenna_light", (-1.2, 0.6, 7.27), 0.02, 0.04, m.bulb_pink)
    # Satellite dish on the right
    cyl("dish_mast", (2.3, 0.6, 5.95), 0.025, 0.5, m.steel)
    cone("dish", (2.2, 0.35, 6.2), 0.3, 0.05, 0.12, m.steel, rot=(math.radians(-60), 0, 0))
    # Monitor: Credits. Content bars are children of the Hotspot.
    tilt = (math.radians(-8), 0, 0)
    box("monitor_leg_l", (0.6, 0.4, 6.0), (0.08, 0.08, 0.6), m.purple)
    box("monitor_leg_r", (2.2, 0.4, 6.0), (0.08, 0.08, 0.6), m.purple)
    box("monitor_frame", (1.4, 0.3, 6.8), (2.2, 0.25, 1.2), m.purple, rot=tilt)
    scr = box("hotspot_credits_monitor", (1.4, 0.16, 6.82), (2.0, 0.04, 1.0), m.screen, rot=tilt)
    bars = []
    rnd = random.Random(5)
    for r in range(5):
        for c in range(3):
            if rnd.random() < 0.3:
                continue
            w = rnd.uniform(0.25, 0.5)
            bars.append(
                box(
                    f"mon_bar_{r}_{c}",
                    (0.65 + c * 0.6 + w / 2, 0.135 + (r - 2) * 0.026, 7.18 - r * 0.17),
                    (w, 0.01, 0.07),
                    m.ink,
                    rot=tilt,
                )
            )
    bars.append(box("mon_block", (2.1, 0.12, 6.75), (0.3, 0.01, 0.5), m.teal, rot=tilt))
    bars.append(box("mon_block_in", (2.1, 0.11, 6.75), (0.2, 0.01, 0.3), m.ink, rot=tilt))
    parent(bars, scr)
    cyl("monitor_cable", (1.6, 0.6, 6.0), 0.015, 0.7, m.ink)
    # Rooftop foliage: clusters of spheres in two blues
    for i, (x, y) in enumerate(((-2.3, 0.9), (2.4, 1.0), (0.2, 1.1), (-0.9, 1.2), (2.5, -0.9), (-2.4, -0.8))):
        for k in range(3):
            ball(
                f"plant_{i}_{k}",
                (x + rnd.uniform(-0.2, 0.2), y + rnd.uniform(-0.15, 0.15), 5.8 + rnd.uniform(0, 0.2)),
                rnd.uniform(0.22, 0.34),
                (m.blue_deep, m.blue_dark, m.blue_mid)[k % 3],
            )
    box("planter_l", (-2.3, 0.9, 5.75), (0.7, 0.5, 0.12), m.purple)
    box("planter_r", (2.4, 1.0, 5.75), (0.7, 0.5, 0.12), m.purple)


def kiosk(m):
    body = box("hotspot_resume_kiosk", (-4.2, -0.4, 0.75), (0.8, 0.7, 1.5), m.teal_pale)
    k = []
    k.append(box("kiosk_base", (-4.2, -0.4, 0.03), (0.9, 0.8, 0.06), m.purple))
    k.append(box("kiosk_cap", (-4.2, -0.4, 1.53), (0.86, 0.76, 0.06), m.purple))
    k.append(box("kiosk_screen_frame", (-4.2, -0.76, 0.95), (0.6, 0.02, 0.5), m.purple))
    k.append(box("kiosk_screen", (-4.2, -0.77, 0.95), (0.52, 0.02, 0.42), m.screen))
    k += screen_content("kiosk", (-4.2, -0.78, 0.95), 0.52, 0.42, m.ink, rows=4, seed=2)
    k.append(box("kiosk_slot", (-4.2, -0.77, 0.5), (0.45, 0.03, 0.06), m.ink))
    k.append(box("kiosk_slot_paper", (-4.2, -0.8, 0.46), (0.3, 0.04, 0.02), m.white))
    for r in range(3):
        for c in range(3):
            k.append(box(f"kiosk_key_{r}{c}", (-4.3 + c * 0.1, -0.77, 0.33 - r * 0.07), (0.06, 0.02, 0.04), m.ink))
    for g in range(4):
        k.append(box(f"kiosk_grille_{g}", (-4.2, -0.77, 1.3 + g * 0.05), (0.4, 0.01, 0.015), m.ink))
    k.append(cyl("kiosk_mast", (-4.2, -0.4, 1.78), 0.03, 0.5, m.purple))
    k.append(box("kiosk_mast_bar", (-4.2, -0.4, 2.02), (0.36, 0.03, 0.03), m.purple))
    k.append(cyl("kiosk_lamp_l", (-4.36, -0.4, 2.08), 0.07, 0.1, m.neon_pink))
    k.append(cyl("kiosk_lamp_r", (-4.04, -0.4, 2.08), 0.07, 0.1, m.neon_pink))
    k.append(box("kiosk_side_stripe", (-4.61, -0.4, 0.75), (0.02, 0.5, 1.2), m.pink))
    parent(k, body)


def machine(m):
    body = box("hotspot_projects_machine", (3.3, -0.6, 0.9), (0.8, 0.9, 1.8), m.blue_deep)
    k = []
    k.append(box("machine_canopy", (3.3, -0.7, 1.86), (0.92, 1.1, 0.12), m.pink))
    k.append(box("machine_canopy_sign", (3.3, -1.26, 1.86), (0.9, 0.02, 0.1), m.screen_pink))
    k.append(text("machine_sign_text", "PLAY", 0.07, m.ink, (3.3, -1.27, 1.86), extrude=0.003))
    for i in range(3):
        k.append(cyl(f"machine_canopy_bulb_{i}", (3.05 + i * 0.25, -1.1, 1.79), 0.03, 0.02, m.bulb))
    k.append(box("machine_screen_frame", (3.3, -1.06, 1.2), (0.62, 0.02, 0.56), m.purple))
    k.append(box("machine_screen", (3.3, -1.07, 1.2), (0.54, 0.02, 0.48), m.screen))
    k += screen_content("machine", (3.3, -1.08, 1.2), 0.54, 0.48, m.ink, rows=3, seed=4)
    k.append(box("machine_screen_cursor", (3.42, -1.09, 1.08), (0.06, 0.01, 0.03), m.pink))
    for i, mt in enumerate((m.pink, m.teal, m.bulb_pink, m.white)):
        k.append(box(f"machine_btn_{i}", (3.1 + i * 0.13, -1.07, 0.78), (0.08, 0.03, 0.08), mt))
    k.append(box("machine_coin", (3.52, -1.07, 0.62), (0.08, 0.02, 0.12), m.ink))
    k.append(box("machine_slot", (3.3, -1.07, 0.38), (0.5, 0.03, 0.14), m.ink))
    k.append(box("machine_slot_lip", (3.3, -1.1, 0.3), (0.52, 0.06, 0.02), m.steel))
    k.append(box("machine_side_stripe", (3.71, -0.6, 0.9), (0.02, 0.6, 1.4), m.teal))
    k.append(box("machine_foot", (3.3, -0.6, 0.03), (0.86, 0.96, 0.06), m.ink))
    parent(k, body)


def light(name, kind, location, color, energy, size=1.0, rot=(0, 0, 0)):
    bpy.ops.object.light_add(type=kind, location=location)
    o = bpy.context.object
    o.name = name
    o.data.color = srgb(PAL[color])[:3]
    o.data.energy = energy
    if kind == "POINT":
        o.data.shadow_soft_size = size
    if kind == "AREA":
        o.data.size = size
    o.rotation_euler = rot
    return o


def lights_and_cameras(scene):
    light("fill", "AREA", (0, -12, 6), "blue_mid", 700, size=8, rot=(math.radians(70), 0, 0))
    light("neon_glow", "AREA", (-0.9, -2.3, 2.9), "teal", 250, size=3, rot=(math.radians(90), 0, 0))
    light("counter_glow", "POINT", (-1.2, -0.6, 2.1), "pink", 220, size=0.5)
    light("counter_glow_teal", "POINT", (-0.3, 0.0, 1.6), "teal", 60, size=0.3)
    light("kiosk_glow", "POINT", (-4.2, -1.0, 1.0), "teal", 40, size=0.3)
    light("machine_glow", "POINT", (3.3, -1.3, 1.2), "teal", 40, size=0.3)
    light("cow_glow", "POINT", (-1.9, -2.2, 4.3), "pink_pale", 60, size=0.6)

    world = bpy.data.worlds.new("Night")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.004, 0.005, 0.02, 1)
    bg.inputs["Strength"].default_value = 1.0

    cams = {}
    for name, loc, look, lens in (
        ("street", (0, -16, 4.6), (0, 0, 3.0), 45),
        ("counter", (-1.0, -6.5, 1.9), (-1.2, 0, 1.3), 50),
        ("sign", (-0.9, -6.5, 3.3), (-0.9, 0, 3.4), 45),
    ):
        bpy.ops.object.camera_add(location=loc)
        cam = bpy.context.object
        cam.name = f"cam_{name}"
        cam.data.lens = lens
        direction = Vector(look) - Vector(loc)
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        cams[name] = cam
    return cams


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    m = M()
    street(m)
    storefront(m)
    counter_interior(m)
    sign(m)
    upper(m)
    rooftop(m)
    kiosk(m)
    machine(m)
    cams = lights_and_cameras(scene)
    return scene, cams


# ---------------------------------------------------------------- output


def render(scene, cams):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "OPTIX"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    os.makedirs(RENDER_DIR, exist_ok=True)
    for name, cam in cams.items():
        scene.camera = cam
        scene.render.resolution_x = 1280
        scene.render.resolution_y = 1280 if name == "street" else 800
        scene.render.filepath = os.path.join(RENDER_DIR, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)


def join_statics():
    """Join every top-level non-Hotspot, non-Prop mesh by material."""
    groups = {}
    for o in list(bpy.data.objects):
        if o.type != "MESH" or o.parent is not None:
            continue
        if o.name.startswith(("hotspot_", "prop_")):
            continue
        key = o.data.materials[0].name if o.data.materials else "none"
        groups.setdefault(key, []).append(o)
    for key, objs in groups.items():
        join(objs, f"static_{key}")


def export():
    join_statics()
    verts = sum(len(o.data.vertices) for o in bpy.data.objects if o.type == "MESH")
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    meshes = sum(1 for o in bpy.data.objects if o.type == "MESH")
    os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        o.select_set(o.type == "MESH")
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_lights=False,
        export_cameras=False,
        export_yup=True,
    )
    print(f"EXPORTED {GLB_PATH} {os.path.getsize(GLB_PATH)} bytes, {meshes} meshes, {verts} verts, {tris} tris")


if __name__ == "__main__":
    scene, cams = build()
    if "--no-render" not in sys.argv:
        render(scene, cams)
    export()
