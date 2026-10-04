"""Builds the Creamery, renders review images, and exports the GLB.

Run headless:  blender -b --python blender/build.py [-- --no-render]
Everything here is reproducible; the .blend is never saved.

Contracts with the web code (src/scene/Creamery.tsx):
- A Hotspot is one single-material mesh named `hotspot_<...>` that matches
  src/stations.ts. Its detail is parented to it with names that do NOT start
  with `hotspot_`, so clicks on detail still resolve to the Hotspot.
- A spinning fan is one mesh named `prop_fan_N` whose local Z is the spin axis.
- Character meshes stay under `rig_` pivots, animated in characterMotion.ts.
- The road sits CURB below the sidewalk; the web draws its own road there.
- Everything else is joined into baked meshes (see `regroup`), except
  emissive geometry, which keeps its material so it still blooms.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB_PATH = os.path.join(ROOT, "public", "models", "creamery.glb")
RENDER_DIR = os.path.join(ROOT, "blender", "renders")
BAKE_DIR = os.path.join(ROOT, "blender", "bakes")
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
    "pave": "34366a",
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
    else:
        weather(m, bsdf, srgb(PAL[color]))
    _mats[key] = m
    return m


def weather(m, bsdf, color):
    """Subtle grime, baked into the atlases with the lighting: broad blotches,
    faint vertical streaks, and darkening near the street. Sampled in world
    space so neighbouring objects of one colour still differ a little."""
    nt = m.node_tree
    pos = nt.nodes.new("ShaderNodeNewGeometry").outputs["Position"]

    def noise(vector, scale):
        n = nt.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = 2.0
        nt.links.new(vector, n.inputs["Vector"])
        return n.outputs[0]

    def mul_add(value, factor, addend):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = "MULTIPLY_ADD"
        nt.links.new(value, n.inputs[0])
        n.inputs[1].default_value = factor
        if isinstance(addend, float):
            n.inputs[2].default_value = addend
        else:
            nt.links.new(addend, n.inputs[2])
        return n.outputs[0]

    stretch = nt.nodes.new("ShaderNodeMapping")
    stretch.inputs["Scale"].default_value = (6.0, 6.0, 0.5)
    nt.links.new(pos, stretch.inputs["Vector"])
    xyz = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(pos, xyz.inputs[0])
    near_street = nt.nodes.new("ShaderNodeMapRange")
    nt.links.new(xyz.outputs["Z"], near_street.inputs["Value"])
    near_street.inputs["From Min"].default_value = 0.0
    near_street.inputs["From Max"].default_value = 0.8
    near_street.inputs["To Min"].default_value = 1.0
    near_street.inputs["To Max"].default_value = 0.0

    # Brightness around 1.0: +-9% blotches, +-6% streaks, -30% at the street.
    k = mul_add(noise(pos, 1.3), 0.3, 0.75)
    k = mul_add(noise(stretch.outputs[0], 3.0), 0.2, k)
    k = mul_add(near_street.outputs["Result"], -0.3, k)
    tint = nt.nodes.new("ShaderNodeVectorMath")
    tint.operation = "SCALE"
    tint.inputs[0].default_value = color[:3]
    nt.links.new(k, tint.inputs["Scale"])
    nt.links.new(tint.outputs[0], bsdf.inputs["Base Color"])


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
        self.steel_dull = mat("steel_dull", "steel", rough=0.8)
        self.pave = mat("pave", "pave", rough=0.9)
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
        # The cow is a lit display: emission is its only light in the browser,
        # so full strength keeps the face white without crossing into bloom.
        self.cow_white = mat("cow_white", "white", emit="white", strength=0.95)
        self.cow_pink = mat("cow_pink", "pink", emit="pink", strength=0.95)


# ---------------------------------------------------------------- primitives


def _link(o):
    bpy.context.collection.objects.link(o)
    return o


def bevel(o, width, segments, harden):
    """Round the object's edges so the bake catches a highlight on them.

    Applied in `apply_modifiers`, before any join drops it."""
    md = o.modifiers.new("bevel", "BEVEL")
    md.width = width
    md.segments = segments
    md.limit_method = "ANGLE"
    md.use_clamp_overlap = True
    md.harden_normals = harden
    return o


def box(name, center, size, material, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center, rotation=rot)
    o = bpy.context.object
    o.name = name
    # Scale the mesh, not the object, so the bevel width is in metres.
    o.data.transform(Matrix.Diagonal((*size, 1.0)))
    o.data.materials.append(material)
    thin = min(size)
    if thin >= 0.03:
        bevel(o, min(0.03, thin * 0.15), 2, harden=True)
    return o


def cyl(name, center, radius, depth, material, axis="Z", verts=None, rot=None):
    base = {"Z": (0, 0, 0), "Y": (math.pi / 2, 0, 0), "X": (0, math.pi / 2, 0)}[axis]
    verts = verts or (40 if radius >= 0.15 else 24 if radius >= 0.04 else 12)
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=radius, depth=depth, location=center, rotation=rot or base
    )
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    if radius >= 0.04 and depth >= 0.03:
        bevel(o, min(0.012, radius * 0.12, depth * 0.2), 1, harden=False)
    return o


def ball(name, center, radius, material, subdiv=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=radius, location=center)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    return o


def blob(name, center, radii, material, turn=0.0, rot=None, detail=12):
    """A smooth ellipsoid with per-axis radii, turned `turn` radians about Z
    or by the Euler `rot`. `detail` is its ring count; segments are double."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=detail * 2, ring_count=detail, radius=1, location=center)
    o = bpy.context.object
    o.name = name
    o.data.transform(Matrix.Diagonal((*radii, 1.0)))
    o.rotation_euler = rot or (0, 0, turn)
    o.data.materials.append(material)
    o["organic"] = True  # smooth-shaded even when low-poly, see finalize()
    return o


def tube(name, points, radius, material):
    """A smooth round tube through `points`, for cables, wires, and tails."""
    cu = bpy.data.curves.new(f"{name}_curve", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 2
    cu.use_fill_caps = True
    cu.resolution_u = 6
    spline = cu.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for bp, p in zip(spline.bezier_points, points):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    cobj = _link(bpy.data.objects.new(f"{name}_tmp", cu))
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(cobj.evaluated_get(dg))
    bpy.data.objects.remove(cobj)
    bpy.data.curves.remove(cu)
    me.materials.clear()
    me.materials.append(material)
    return _link(bpy.data.objects.new(name, me))


def cable(name, start, end, sag, radius, material, steps=10):
    """A tube hanging between two points, dipping `sag` metres at its middle."""
    a, b = Vector(start), Vector(end)
    pts = [a.lerp(b, i / steps) - Vector((0, 0, sag * 4 * (i / steps) * (1 - i / steps))) for i in range(steps + 1)]
    return tube(name, pts, radius, material)


def leaf(name, at, outward, length, material, rnd):
    """One flat leaf blade at `at`, lying across `outward` and tipped out
    from it, spun randomly about it."""
    q = outward.to_track_quat("Y", "Z")
    q = q @ Quaternion((0, 1, 0), rnd.uniform(0, math.tau)) @ Quaternion((1, 0, 0), rnd.uniform(0.35, 0.85))
    return blob(name, at, (length * 0.6, 0.008, length), material, rot=q.to_euler(), detail=4)


def bush(name, center, size, core, leaves, seed, count=50, length=0.075):
    """A leafy shrub: a dark core of `size` radii covered in leaf blades that
    point outward, mostly over its top and front where they are seen."""
    rnd = random.Random(seed)
    c = Vector(center)
    blob(f"{name}_core", center, tuple(s * 0.8 for s in size), core, detail=8)
    for i in range(count):
        d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1) - 0.4, abs(rnd.gauss(0, 1)) + 0.3)).normalized()
        at = c + Vector((d.x * size[0], d.y * size[1], d.z * size[2])) * rnd.uniform(0.8, 1.0)
        leaf(f"{name}_leaf_{i}", at, d, length * rnd.uniform(0.8, 1.25), rnd.choice(leaves), rnd)


def vine(name, top, length, stem, leaves, seed):
    """Ivy hanging from `top` against a wall facing -Y: a wandering stem with
    pairs of flat leaves that shrink toward the tip."""
    rnd = random.Random(seed)
    steps = max(3, int(length / 0.05))
    path = []
    for k in range(steps + 1):
        t = k / steps
        path.append(
            (top[0] + math.sin(t * 5 + seed) * 0.035, top[1] - 0.01 * math.sin(t * 9), top[2] - t * length)
        )
    tube(f"{name}_stem", path, 0.007, stem)
    for k, (x, y, z) in enumerate(path[:-1]):
        size = 1.0 - 0.5 * k / steps
        for side in (-1, 1):
            if rnd.random() < 0.15:
                continue
            blob(
                f"{name}_leaf_{k}_{side}",
                (x + side * 0.042 * size, y - 0.012, z - rnd.uniform(0, 0.02)),
                (0.05 * size, 0.008, 0.03 * size),
                rnd.choice(leaves),
                rot=(rnd.uniform(-0.35, 0.35), side * rnd.uniform(0.3, 0.9), rnd.uniform(-0.3, 0.3)),
                detail=4,
            )


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


def articulation(name, center, parts):
    """A rigid character joint. Keep geometry in its authored world pose."""
    pivot = _link(bpy.data.objects.new(name, None))
    pivot.location = center
    bpy.context.view_layer.update()
    parent(parts, pivot)
    return pivot


def apply_modifiers(objs):
    """Bake each object's modifiers into its mesh; joining would drop them."""
    dg = bpy.context.evaluated_depsgraph_get()
    for o in objs:
        if o.type != "MESH" or not o.modifiers:
            continue
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        old = o.data
        o.modifiers.clear()
        o.data = me
        if old.users == 0:
            bpy.data.meshes.remove(old)


def is_hidden(normal, center):
    """True for a face no Station or orbit can show.

    The orbit stays within 60 degrees of the front (-Y) and at most 2 degrees
    below the horizon, so faces turned to the back are never seen, and nor
    are bottoms resting on the street. Undersides higher up stay: the
    Contact and Projects cameras look up at the sign band and the canopy."""
    return normal.y > 0.9 or (normal.z < -0.9 and center.z < 0.02)


def finalize():
    """Apply bevels, smooth-shade, and drop faces nobody can see.

    Dropping hidden faces before the bake gives their atlas space to visible
    ones. Lights all sit in front of the Creamery, so open backs leak none."""
    objs = mesh_objects()
    apply_modifiers(objs)
    for o in objs:
        me = o.data
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        if not me.has_custom_normals:
            # Hardened bevels already carry their normals; everything else
            # stays faceted at real corners and smooth around curves. Leaves
            # and cats are coarse ellipsoids, so they smooth across wider angles.
            me.set_sharp_from_angle(angle=math.radians(80 if o.get("organic") else 40))
        # Articulated Props expose different faces as they move.
        if o.name == "ground" or (o.parent and o.parent.name.startswith("rig_")):
            continue
        to_world = o.matrix_world
        normal_to_world = to_world.to_3x3().inverted_safe().transposed()
        bm = bmesh.new()
        bm.from_mesh(me)
        hidden = [
            f
            for f in bm.faces
            if is_hidden((normal_to_world @ f.normal).normalized(), to_world @ f.calc_center_median())
        ]
        bmesh.ops.delete(bm, geom=hidden, context="FACES")
        bm.to_mesh(me)
        bm.free()


def join(objs, name):
    """Join meshes into the first one. Works headless via a context override."""
    objs = [o for o in objs if o is not None]
    apply_modifiers(objs)
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


CURB = 0.12  # the road sits this far below the sidewalk


def street(m):
    """The sidewalk everything stands on, and the road a curb below it.

    The road is for review renders only; the browser draws its own reflective
    street at the same height. The sidewalk is baked into its own atlas, so
    the kiosk, machine, stools, and trash can get contact shadows and the
    shop's neon spills across it."""
    box("ground", (0, 0, -CURB - 0.05), (24, 14, 0.1), m.ground)
    # Slabs are cut into squarish pieces, seams on the paving joints, so
    # their atlas islands pack tightly instead of as one long diagonal strip.
    slab = 1.05
    edge = 9 * slab
    pieces = [((x, x + 3 * slab), (-2.6, -1.5)) for x in (-edge, -6 * slab, -3 * slab, 0, 3 * slab, 6 * slab)]
    for side in (-1, 1):
        for y0, y1 in ((-1.5, 0.75), (0.75, 3.0)):
            pieces.append((tuple(sorted((side * 2.9, side * edge))), (y0, y1)))
    for i, ((x0, x1), (y0, y1)) in enumerate(pieces):
        box(f"street_sidewalk_{i}", ((x0 + x1) / 2, (y0 + y1) / 2, -CURB / 2), (x1 - x0, y1 - y0, CURB), m.pave)
    for i, x in enumerate((-2 * 3 * slab, 0, 2 * 3 * slab)):
        box(f"street_curb_{i}", (x, -2.51, -CURB / 2 + 0.003), (6 * slab, 0.18, CURB + 0.006), m.steel_dull)
    # Joints between paving slabs
    for i in range(-8, 9):
        box(f"street_joint_x_{i}", (i * slab, -2.0, 0.001), (0.014, 1.0, 0.004), m.ink)
    for side in (-1, 1):
        for k in range(4):
            box(f"street_joint_y_{side}_{k}", (side * (2.9 + edge) / 2, -1.0 + k * slab, 0.001), (edge - 2.9, 0.014, 0.004), m.ink)
        for i in range(3, 9):
            box(f"street_joint_s_{side}_{i}", (side * i * slab, 0.75, 0.001), (0.014, 4.5, 0.004), m.ink)
    # drain grate right of the door
    for i in range(5):
        box(f"street_grate_{i}", (1.6 + i * 0.06, -2.1, 0.003), (0.02, 0.3, 0.006), m.ink)


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


def cat(name, base, identity, turn=0.0, tail_side=1):
    """Skadi (long-haired brown tabby) or Freya (short-haired gray bicolor).

    Authored coat colors survive regrouping as vertex colors, then bake into
    the existing character atlas. The numbered pivots are the web animation
    contract; identity changes the likeness without changing those joints.
    Photos are visual references only and are not needed to rebuild."""
    spin = Matrix.Rotation(turn, 3, "Z")
    fluffy = identity == "Skadi"
    # Reserve headroom for the strong counter lights in the Standard bake.
    white = srgb("bab7b0")
    coat = srgb("705640" if fluffy else "636669")
    stripe = srgb("302820" if fluffy else "484d50")
    pink = srgb("b77c79")
    dark = srgb("242323")
    iris = srgb("657f54" if fluffy else "839752")
    fur = bpy.data.materials.get("cat_fur")
    if fur is None:
        fur = bpy.data.materials.new("cat_fur")
        fur.use_nodes = True
        bsdf = fur.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = 0.85
        color = fur.node_tree.nodes.new("ShaderNodeVertexColor")
        color.layer_name = "cat_coat"
        fur.node_tree.links.new(color.outputs["Color"], bsdf.inputs["Base Color"])

    def at(x, y, z):
        return tuple(Vector(base) + spin @ Vector((x, y, z)))

    def paint(obj, color_at):
        obj.data.materials.clear()
        obj.data.materials.append(fur)
        colors = obj.data.color_attributes.new(name="cat_coat", type="FLOAT_COLOR", domain="POINT")
        for vertex, color in zip(obj.data.vertices, colors.data):
            color.color = color_at(vertex.co)
        return obj

    def ellipsoid(part, center, radii, color, pattern=None, detail=12):
        obj = blob(f"{name}_{part}", at(*center), radii, fur, turn, detail=detail)
        return paint(obj, lambda p: pattern(*(p[i] / radii[i] for i in range(3))) if pattern else color)

    def tabby(x, y, z):
        # Broad, slightly wandering bands remain legible at counter scale.
        band = math.sin(z * 19 + math.sin(y * 6) * 1.4 + abs(x) * 3)
        return stripe if band > 0.55 else coat

    def body_coat(x, y, z):
        if y < -0.25 and abs(x) < (0.58 if fluffy else 0.78):
            return white
        return tabby(x, y, z)

    def face_coat(x, y, z):
        if y < -0.2:
            # Skadi's narrow, forked blaze; Freya's broader white inverted V.
            blaze = (0.14 + 0.10 * max(z, 0)) if fluffy else (0.30 - 0.13 * z)
            if z < -0.3 or (abs(x + (0.035 if fluffy else 0)) < blaze and z < 0.86):
                return white
            # Dark forehead M and cheek bars, following the face's curvature.
            if z > 0.3 and math.sin(x * 22 + abs(z - 0.5) * 8) > 0.4:
                return stripe
            if abs(x) > 0.55 and -0.25 < z < 0.22 and math.sin(z * 32 + abs(x) * 3) > 0.45:
                return stripe
        return coat

    body_parts = [
        ellipsoid("haunch", (0, 0.033, 0.069), (0.103 if fluffy else 0.09, 0.082, 0.069), coat, body_coat, 16),
        ellipsoid("body", (0, 0.012, 0.133), (0.081 if fluffy else 0.067, 0.067, 0.105), coat, body_coat, 20),
        ellipsoid("bib", (0, -0.045, 0.135), (0.062 if fluffy else 0.049, 0.037, 0.087), white),
    ]
    for side in (-1, 1):
        body_parts.extend([
            ellipsoid(f"leg_{side}", (side * 0.032, -0.041, 0.069), (0.024, 0.027, 0.061), white),
            ellipsoid(f"paw_{side}", (side * 0.034, -0.059, 0.018), (0.029, 0.037, 0.018), white),
            ellipsoid(f"hind_paw_{side}", (side * 0.074, 0.014, 0.019), (0.027, 0.04, 0.019), white),
        ])
        if fluffy:
            body_parts.append(ellipsoid(f"sleeve_{side}", (side * 0.039, -0.035, 0.109), (0.029, 0.029, 0.035), coat, tabby))
    if fluffy:
        # One continuous mane, with a gently uneven silhouette. Keeping the
        # tufts in the surface avoids bead-like pieces and extra UV islands.
        ruff = ellipsoid("ruff", (0, -0.02, 0.173), (0.097, 0.073, 0.072), white, detail=20)
        for v in ruff.data.vertices:
            angle = math.atan2(v.co.y / 0.073, v.co.x / 0.097)
            lower = max(0, -v.co.z / 0.072)
            ripple = 1 + 0.08 * math.cos(angle * 9) * (1 - lower)
            v.co.x *= ripple * (1 - 0.22 * lower)
            v.co.y *= ripple
            v.co.z -= 0.008 * lower * (0.5 + 0.5 * math.cos(angle * 9))
        body_parts.append(ruff)
    body = articulation(f"rig_{name}_body", base, body_parts)
    body["cat_name"] = identity

    head_parts = [ellipsoid("head", (0, -0.018, 0.241), (0.072 if fluffy else 0.065, 0.058, 0.06), coat, face_coat, 28)]
    for side in (-1, 1):
        if fluffy:
            head_parts.append(ellipsoid(f"cheek_fur_{side}", (side * 0.055, -0.03, 0.218), (0.032, 0.039, 0.027), coat))
        head_parts.append(ellipsoid(f"muzzle_{side}", (side * 0.015, -0.071, 0.219), (0.025, 0.015, 0.019), white))
        # Flattened triangular ears, with inset pink faces rather than cones.
        ear_points = [
            (side * 0.023, -0.042, 0.275), (side * 0.072, -0.025, 0.271),
            (side * 0.061, -0.012, 0.337 if fluffy else 0.331),
            (side * 0.025, 0.006, 0.277), (side * 0.068, 0.012, 0.272),
        ]
        me = bpy.data.meshes.new(f"{name}_ear_{side}")
        me.from_pydata([at(*p) for p in ear_points], [], [(0, 2, 1), (0, 3, 2), (1, 2, 4), (2, 3, 4), (0, 1, 4, 3)])
        # Mirroring an ear reverses its winding. Reorient the closed shell
        # before baking so neither ear picks up lighting on its inside face.
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(me)
        bm.free()
        ear = _link(bpy.data.objects.new(me.name, me))
        head_parts.append(paint(ear, lambda p: coat))
        me = bpy.data.meshes.new(f"{name}_inner_ear_{side}")
        me.from_pydata([at(side * 0.032, -0.0425, 0.279), at(side * 0.063, -0.031, 0.279), at(side * 0.059, -0.017, 0.321)], [], [(0, 1, 2) if side == 1 else (2, 1, 0)])
        inner = _link(bpy.data.objects.new(me.name, me))
        head_parts.append(paint(inner, lambda p: pink))
    head_parts.extend([
        ellipsoid("chin", (0, -0.066, 0.202), (0.024, 0.016, 0.013), white),
        # Freya's long gray nose patch interrupts the white blaze; Skadi's
        # brown bridge is shorter and wider, as in the supplied portraits.
        ellipsoid("nose_bridge", (0.003 if not fluffy else 0, -0.075, 0.239), (0.011 if not fluffy else 0.014, 0.006, 0.022 if not fluffy else 0.016), coat),
        ellipsoid("nose", (0, -0.085, 0.222), (0.009, 0.005, 0.006), pink, detail=8),
        ellipsoid("mouth", (0, -0.084, 0.211), (0.0015, 0.0015, 0.006), dark, detail=6),
    ])
    head = articulation(f"rig_{name}_head", at(0, -0.01, 0.195), head_parts)
    s = tail_side
    tail = tube(f"{name}_tail", [at(s * x, y, z) for x, y, z in (
        (0.048, 0.082, 0.05), (0.123, 0.065, 0.042), (0.14, -0.033, 0.029), (0.098, -0.091, 0.025), (0.028, -0.105, 0.025)
    )], 0.027 if fluffy else 0.013, fur)
    def tail_coat(p):
        local = spin.transposed() @ (p - Vector(base))
        return stripe if math.sin((local.x * s - local.y) * 100) > 0.25 else coat
    tail["organic"] = True
    paint(tail, tail_coat)
    tail_tip = ellipsoid("tail_tip", (s * 0.028, -0.105, 0.025), (0.027 if fluffy else 0.013,) * 3, stripe)
    articulation(f"rig_{name}_tail", at(s * 0.048, 0.082, 0.05), [tail, tail_tip])
    eyes = []
    for side in (-1, 1):
        x = side * 0.029
        eyes.extend([
            ellipsoid(f"eye_rim_{side}", (x, -0.070, 0.249), (0.018, 0.009, 0.014), dark),
            ellipsoid(f"iris_{side}", (x, -0.077, 0.249), (0.0145, 0.0045, 0.0115), iris),
            ellipsoid(f"pupil_{side}", (x, -0.081, 0.249), (0.0038, 0.002, 0.010), dark, detail=8),
            ellipsoid(f"eye_glint_{side}", (x - 0.004, -0.082, 0.254), (0.0025, 0.001, 0.0025), white, detail=6),
        ])
    eyelids = articulation(f"rig_{name}_eyes", at(0, -0.078, 0.249), eyes)
    parent([eyelids], head)
    parent([head], body)


def barista(m):
    """A compact enamel service robot, with visible hinges and gripping hands."""
    body = [
        box("barista_chassis", (-0.9, -0.55, 1.3), (0.4, 0.32, 0.66), m.blue_deep),
        box("barista_chest", (-0.9, -0.735, 1.48), (0.37, 0.06, 0.24), m.teal_pale),
        box("barista_apron", (-0.9, -0.735, 1.17), (0.32, 0.045, 0.34), m.purple),
        box("barista_pocket", (-0.9, -0.765, 1.21), (0.21, 0.02, 0.12), m.blue_mid),
        box("barista_badge", (-0.9, -0.774, 1.49), (0.18, 0.018, 0.095), m.purple),
        text("barista_badge_text", "JJ", 0.052, m.pink_pale, (-0.9, -0.787, 1.49), extrude=0.001),
        cyl("barista_neck", (-0.9, -0.55, 1.67), 0.075, 0.13, m.steel),
    ]
    for z in (1.64, 1.675, 1.71):
        body.append(cyl("barista_neck_ring", (-0.9, -0.55, z), 0.085, 0.014, m.ink))
    for x in (-1.045, -0.755):
        body.append(box("barista_apron_strap", (x, -0.775, 1.4), (0.035, 0.012, 0.36), m.pink))
        body.append(cyl("barista_fastener", (x, -0.79, 1.51), 0.016, 0.012, m.steel, axis="Y"))
    articulation("rig_barista_body", (-0.9, -0.55, 0.97), body)

    head_parts = [
        box("barista_head_shell", (-0.9, -0.55, 1.88), (0.4, 0.34, 0.32), m.purple),
        box("barista_crown", (-0.9, -0.55, 2.035), (0.34, 0.29, 0.045), m.teal_pale),
        box("barista_visor_rim", (-0.9, -0.726, 1.91), (0.355, 0.045, 0.19), m.steel_dull),
        box("barista_visor", (-0.9, -0.752, 1.91), (0.315, 0.025, 0.15), m.ink),
        box("barista_chin", (-0.9, -0.732, 1.775), (0.27, 0.035, 0.035), m.blue_mid),
        cyl("barista_antenna", (-0.77, -0.52, 2.115), 0.012, 0.14, m.steel),
        ball("barista_antenna_tip", (-0.77, -0.52, 2.19), 0.025, m.neon_pink, subdiv=2),
    ]
    for side in (-1, 1):
        x = -0.9 + side * 0.215
        head_parts.extend([
            cyl("barista_ear_hinge", (x, -0.55, 1.89), 0.095, 0.055, m.steel, axis="X"),
            cyl("barista_ear_cap", (x + side * 0.031, -0.55, 1.89), 0.064, 0.016, m.blue_mid, axis="X"),
            cyl("barista_ear_light", (x + side * 0.042, -0.55, 1.89), 0.025, 0.008, m.neon_soft, axis="X"),
        ])
    for i in range(3):
        head_parts.append(box("barista_mouth_vent", (-0.95 + i * 0.05, -0.758, 1.797), (0.028, 0.012, 0.012), m.ink))
    head = articulation("rig_barista_head", (-0.9, -0.55, 1.71), head_parts)
    eyes = articulation("rig_barista_eyes", (-0.9, -0.772, 1.925), [
        box("barista_eye_l", (-0.968, -0.772, 1.925), (0.036, 0.012, 0.063), m.neon_soft),
        box("barista_eye_r", (-0.832, -0.772, 1.925), (0.036, 0.012, 0.063), m.neon_soft),
    ])
    parent([eyes], head)

    for side, suffix in ((-1, "tray"), (1, "cup")):
        x = -0.9 + side * 0.28
        # Upper arm stays at the shoulder; the forearm pivots at the elbow.
        articulation(f"rig_barista_shoulder_{suffix}", (x, -0.55, 1.5), [
            cyl("barista_shoulder", (x, -0.55, 1.49), 0.095, 0.1, m.steel, axis="X"),
            box("barista_upper_arm", (x, -0.6, 1.35), (0.11, 0.12, 0.24), m.blue_mid, rot=(-0.3, 0, 0)),
            cyl("barista_elbow", (x, -0.65, 1.25), 0.065, 0.13, m.purple, axis="X"),
        ])
        parts = [
            box("barista_forearm", (x, -0.8, 1.25), (0.1, 0.28, 0.1), m.teal_pale),
            box("barista_forearm_inset", (x, -0.8, 1.305), (0.05, 0.16, 0.012), m.blue_deep),
            cyl("barista_wrist", (x, -0.96, 1.25), 0.039, 0.065, m.steel, axis="Y"),
            box("barista_palm", (x, -1.005, 1.25), (0.11, 0.05, 0.065), m.purple),
        ]
        for grip in (-1, 1):
            parts.append(box("barista_gripper", (x + grip * 0.052, -1.043, 1.275), (0.023, 0.07, 0.08), m.steel))
        if suffix == "cup":
            parts.extend([
                cone("barista_cup", (x, -1.055, 1.31), 0.041, 0.052, 0.13, m.cream),
                cyl("barista_cup_rim", (x, -1.055, 1.377), 0.056, 0.012, m.pink),
                cyl("barista_milk", (x, -1.055, 1.38), 0.043, 0.006, m.white),
                box("barista_cup_label", (x, -1.103, 1.32), (0.046, 0.008, 0.036), m.pink),
            ])
        else:
            parts.extend([
                cyl("barista_tray", (x, -1.04, 1.3), 0.13, 0.02, m.steel),
                cyl("barista_tray_inset", (x, -1.04, 1.313), 0.112, 0.01, m.pink_pale),
            ])
            for i in range(2):
                parts.append(cyl("barista_cookie", (x + (i - 0.5) * 0.09, -1.04, 1.33), 0.043, 0.024, m.cookie))
                for dx, dy in ((-0.014, -0.01), (0.012, 0.015), (0.017, -0.02)):
                    parts.append(ball("barista_choc_chip", (x + (i - 0.5) * 0.09 + dx, -1.04 + dy, 1.344), 0.006, m.choc))
        articulation(f"rig_barista_{suffix}", (x, -0.65, 1.25), parts)


def counter_interior(m):
    # Counter with a pink top and a striped front
    box("counter_top", (-1.2, -1.3, 0.95), (2.6, 0.42, 0.08), m.pink)
    box("counter_base", (-1.2, -1.27, 0.45), (2.6, 0.3, 0.9), m.blue_deep)
    for i in range(6):
        box(f"counter_stripe_{i}", (-2.3 + i * 0.44, -1.43, 0.45), (0.06, 0.01, 0.8), m.pink)
    box("counter_kick", (-1.2, -1.43, 0.05), (2.6, 0.02, 0.1), m.ink)
    # Stools: chrome post, foot ring, pink seat
    for i, x in enumerate((-2.15, -1.55, -0.95, -0.35)):
        cyl(f"stool_{i}_base", (x, -1.9, 0.02), 0.14, 0.04, m.steel)
        cyl(f"stool_{i}_post", (x, -1.9, 0.27), 0.035, 0.5, m.steel)
        cyl(f"stool_{i}_ring", (x, -1.9, 0.22), 0.11, 0.02, m.steel)
        cyl(f"stool_{i}_seat", (x, -1.9, 0.55), 0.19, 0.08, m.pink)
        cyl(f"stool_{i}_seat_rim", (x, -1.9, 0.505), 0.19, 0.015, m.purple)
    # Things on the counter: cups, a napkin box, a cookie plate, two cats
    for i, x in enumerate((-2.3, -1.12, -0.98)):
        cyl(f"cup_{i}", (x, -1.3, 1.03), 0.045, 0.09, m.white)
        cyl(f"cup_{i}_lid", (x, -1.3, 1.08), 0.05, 0.015, m.pink)
    cyl("plate", (-0.55, -1.3, 1.0), 0.14, 0.015, m.white)
    for i in range(3):
        cyl(f"plate_cookie_{i}", (-0.6 + i * 0.07, -1.3, 1.02 + i * 0.02), 0.06, 0.02, m.cookie, verts=16)
    box("napkins", (-1.4, -1.25, 1.03), (0.12, 0.1, 0.08), m.teal_pale)
    cat("prop_cat_1", (-1.85, -1.27, 0.99), "Skadi", turn=math.radians(25))
    cat("prop_cat_2", (-0.13, -1.27, 0.99), "Freya", turn=math.radians(-20), tail_side=-1)

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
    # The glass stands 5 mm proud of the ring so their faces don't z-fight.
    cyl("back_window", (0.0, 0.235, 1.9), 0.25, 0.04, m.screen_pink, axis="Y")
    # A cat silhouette in the window: body, head, two ears, a tail
    cyl("window_cat_body", (0.0, 0.21, 1.78), 0.09, 0.02, m.ink, axis="Y", verts=16)
    cyl("window_cat_head", (0.07, 0.21, 1.9), 0.06, 0.02, m.ink, axis="Y", verts=16)
    box("window_cat_ear_l", (0.03, 0.21, 1.96), (0.03, 0.02, 0.05), m.ink)
    box("window_cat_ear_r", (0.11, 0.21, 1.96), (0.03, 0.02, 0.05), m.ink)
    box("window_cat_tail", (-0.12, 0.21, 1.82), (0.1, 0.02, 0.025), m.ink, rot=(0, math.radians(-30), 0))

    barista(m)
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
    # Cables snaking from the control panel to the cow screen, a junction
    # box, and down the side
    box("junction_box", (-0.62, -1.33, 4.0), (0.24, 0.08, 0.3), m.purple)
    box("junction_lid", (-0.62, -1.38, 4.04), (0.18, 0.02, 0.16), m.blue_dark)
    for i in range(3):
        box(f"junction_key_{i}", (-0.68 + i * 0.06, -1.39, 3.91), (0.035, 0.02, 0.035), m.ink)
    box("junction_light", (-0.56, -1.39, 4.08), (0.03, 0.01, 0.03), m.bulb_pink)
    cable("cable_1", (-0.42, -1.4, 5.0), (-1.06, -1.56, 4.9), 0.24, 0.02, m.ink)
    tube(
        "cable_2",
        [(-0.3, -1.41, 4.96), (-0.36, -1.44, 4.7), (-0.56, -1.44, 4.42), (-0.6, -1.4, 4.15)],
        0.018,
        m.ink,
    )
    cable("cable_4", (-0.74, -1.4, 3.92), (-1.06, -1.56, 3.75), 0.09, 0.016, m.ink)
    cable("cable_5", (-0.5, -1.4, 3.86), (0.28, -1.44, 3.68), 0.18, 0.014, m.blue_dark)
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


def shorts_tv(m):
    """A portrait TV on an angled bracket around the right exterior corner.

    After Y-up export the anchor's local XY plane is the live DOM screen;
    its +Z faces the viewer. Width/height are exported as extras.
    """
    origin = Vector((3.38, -0.95, 4.48))
    # Keep the mount around the corner, but aim the face toward Street View.
    turn = Matrix.Rotation(math.radians(-10), 4, "Z")
    parts = []

    def panel(name, center, size, material):
        o = box(name, center, size, material)
        parts.append(o)
        return o

    plate = panel("hotspot_shorts_tv", (0, 0, 0), (1.08, 0.24, 1.82), m.ink)
    panel("tv_trim", (0, -0.125, 0), (0.98, 0.025, 1.70), m.neon_soft)
    panel("tv_screen", (0, -0.145, 0), (0.9, 0.02, 1.6), m.screen_dark)
    # Idle artwork only: the live Shorts Section remains DOM (ADR 0002).
    # One small emissive texture keeps the image readable without scene lights.
    poster = mat("tv_bouldering_poster", "ink", emit="white", strength=0.9)
    image = bpy.data.images.load(os.path.join(ROOT, "blender", "textures", "tv-bouldering.png"))
    image.scale(432, 768)
    texture = poster.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    poster.node_tree.links.new(texture.outputs["Color"], poster.node_tree.nodes["Principled BSDF"].inputs["Emission Color"])
    mesh = bpy.data.meshes.new("tv_poster")
    mesh.from_pydata([(-0.45, -0.16, -0.8), (0.45, -0.16, -0.8), (0.45, -0.16, 0.8), (-0.45, -0.16, 0.8)], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new(name="poster")
    for loop, coord in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop.uv = coord
    face = _link(bpy.data.objects.new("tv_poster", mesh))
    mesh.materials.append(poster)
    parts.append(face)
    panel("tv_status_light", (0.38, -0.14, -0.86), (0.035, 0.02, 0.018), m.neon_pink)
    # Rotate all authored front-facing parts as one assembly.
    for o in parts:
        o.matrix_world = Matrix.Translation(origin) @ turn @ o.matrix_world
    bpy.context.view_layer.update()
    parent(parts[1:], plate)

    box("tv_wall_bracket", (2.87, -0.55, 4.48), (0.14, 0.4, 0.65), m.steel)
    tube("tv_mount_arm", [(2.91, -0.55, 4.48), (3.20, -0.55, 4.48), (3.38, -0.89, 4.48)], 0.07, m.ink)
    tube("tv_power", [(2.86, -0.55, 4.2), (2.89, -0.55, 3.5), (2.85, -0.3, 3.15)], 0.018, m.ink)
    anchor = _link(bpy.data.objects.new("tv_screen_anchor", None))
    # Empties' local axes are also converted by the exporter: Blender -Y
    # becomes glTF +Z, and Blender +Z becomes glTF +Y.
    anchor.matrix_world = Matrix.Translation(origin) @ turn @ Matrix.Translation((0, -0.18, 0))
    anchor["screenWidth"] = 0.9
    anchor["screenHeight"] = 1.6


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
    # A thicket of antennas with crossbars, and a sagging wire with a bird
    for i, (x, y, h, bars) in enumerate(
        (
            (-2.0, 0.6, 1.6, 3),
            (-1.2, 0.6, 1.6, 3),
            (-2.55, 0.1, 1.05, 2),
            (-1.6, 1.15, 2.1, 4),
            (-2.35, 1.3, 1.3, 2),
            (-0.15, 1.15, 0.9, 1),
        )
    ):
        cyl(f"antenna_{i}", (x, y, 5.65 + h / 2), 0.018, h, m.ink)
        for k in range(bars):
            w = 0.32 - k * 0.06
            box(f"antenna_{i}_bar_{k}", (x, y, 5.65 + h * 0.45 + k * h * 0.15), (w, 0.02, 0.02), m.ink)
        if i in (1, 3):
            ball(f"antenna_{i}_light", (x, y, 5.67 + h), 0.03, m.bulb_pink)
    cable("antenna_wire", (-2.0, 0.6, 7.2), (-1.2, 0.6, 7.2), 0.14, 0.006, m.ink)
    cable("antenna_wire_2", (-1.6, 1.15, 7.6), (-0.5, 0.3, 6.32), 0.2, 0.006, m.ink)
    # 0.69 of the way along the wire, where it sags 0.12 m
    blob("bird", (-1.45, 0.6, 7.13), (0.05, 0.03, 0.035), m.ink)
    blob("bird_head", (-1.41, 0.6, 7.17), (0.024, 0.022, 0.022), m.ink)
    cone("bird_beak", (-1.38, 0.6, 7.17), 0.008, 0.0, 0.025, m.cookie, rot=(0, math.pi / 2, 0))
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
    # Rooftop foliage: shrubs in planters, and an overgrowth along the front
    # lip above the fans that spills down the wall, like the Reference.
    leaves = [m.blue_dark, m.blue_dark, m.blue_deep, m.purple_deep]
    for i, (x, y, size, count) in enumerate(
        (
            (-2.3, 0.9, (0.36, 0.26, 0.24), 70),
            (2.4, 1.0, (0.36, 0.26, 0.26), 70),
            (0.2, 1.15, (0.28, 0.18, 0.18), 45),
            (-0.9, 1.2, (0.28, 0.18, 0.16), 45),
            (-2.4, -0.8, (0.3, 0.28, 0.2), 55),
        )
    ):
        bush(f"plant_{i}", (x, y, 5.98), size, m.ink, leaves, seed=10 + i, count=count)
    box("planter_l", (-2.3, 0.9, 5.75), (0.8, 0.6, 0.14), m.purple)
    box("planter_r", (2.4, 1.0, 5.75), (0.8, 0.6, 0.14), m.purple)
    box("planter_front", (1.55, -1.12, 5.79), (2.5, 0.36, 0.14), m.purple)
    for i, x in enumerate((0.55, 1.25, 1.95, 2.55)):
        bush(f"overgrowth_{i}", (x, -1.15, 5.95), (0.36, 0.24, 0.15), m.ink, leaves, seed=20 + i, count=55, length=0.085)
    # Ivy hanging over the lip and the fans
    for i, (x, length) in enumerate(((0.32, 0.7), (0.62, 0.35), (0.97, 0.6), (1.85, 0.42), (2.3, 0.28), (2.72, 0.95))):
        vine(f"vine_{i}", (x, -1.47, 5.8), length, m.ink, leaves, seed=30 + i)


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
    # Moonlight from the upper left is the key: it lights tops brighter than
    # fronts and casts the shadows under the sign, ledges, and canopies that
    # give the Reference its depth. The front fill only lifts the shadows.
    moon = light("moon", "SUN", (0, 0, 10), "teal_pale", 1.6)
    moon.data.angle = math.radians(4)
    moon.rotation_euler = Vector((0.55, 0.75, -1.0)).to_track_quat("-Z", "Y").to_euler()
    light("fill", "AREA", (0, -12, 6), "blue_mid", 380, size=8, rot=(math.radians(70), 0, 0))
    light("neon_glow", "AREA", (-0.9, -2.3, 2.9), "teal", 250, size=3, rot=(math.radians(90), 0, 0))
    light("counter_glow", "POINT", (-1.2, -0.6, 2.1), "pink", 260, size=0.5)
    light("counter_glow_teal", "POINT", (-0.3, 0.0, 1.6), "teal", 60, size=0.3)
    # Shop light spilling out of the opening onto the stools and sidewalk
    light("counter_spill", "AREA", (-1.2, -1.2, 2.2), "pink_pale", 120, size=2.2, rot=(math.radians(-25), 0, 0))
    light("kiosk_glow", "POINT", (-4.2, -1.0, 1.0), "teal", 40, size=0.3)
    light("machine_glow", "POINT", (3.3, -1.3, 1.2), "teal", 40, size=0.3)
    light("cow_glow", "POINT", (-1.9, -2.2, 4.3), "pink_pale", 60, size=0.6)
    light("door_lamps", "AREA", (2.0, -1.75, 2.3), "white", 40, size=0.8, rot=(math.radians(20), 0, 0))

    # A dim indigo sky: ambient light from above, so tops read lighter
    world = bpy.data.worlds.new("Night")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.02, 0.022, 0.07, 1)
    bg.inputs["Strength"].default_value = 1.0

    cams = {}
    for name, loc, look, lens in (
        ("street", (0, -16, 4.6), (0, 0, 3.0), 45),
        ("counter", (-1.0, -6.5, 1.9), (-1.2, 0, 1.3), 50),
        ("sign", (-0.9, -6.5, 3.3), (-0.9, 0, 3.4), 45),
        ("upper", (0.5, -7.5, 5.4), (0.5, 0, 5.3), 40),
        ("skadi", (-1.60, -2.15, 1.38), (-1.85, -1.28, 1.16), 50),
        ("freya", (-0.35, -2.15, 1.38), (-0.13, -1.28, 1.16), 50),
        ("tv", (2.7, -4.8, 4.6), (3.38, -0.95, 4.48), 45),
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
    shorts_tv(m)
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
    # Standard, not AgX: the browser applies no tone curve to the baked
    # textures, so the review render should not either.
    scene.view_settings.view_transform = "Standard"
    os.makedirs(RENDER_DIR, exist_ok=True)
    for name, cam in cams.items():
        scene.camera = cam
        scene.render.resolution_x = 1280
        scene.render.resolution_y = 1280 if name == "street" else 800
        scene.render.filepath = os.path.join(RENDER_DIR, f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED", scene.render.filepath)


def is_emissive(material):
    if material is None or not material.use_nodes:
        return False
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    return bool(bsdf) and bsdf.inputs["Emission Strength"].default_value > 0


def mesh_objects():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def regroup():
    """Reduce draw calls and form bake groups.

    Non-emissive geometry is joined into: the street, the building's lower
    and upper halves, one detail mesh per Hotspot, one mesh of Props. Emissive geometry is joined
    per material and never baked, so bloom and hover glow keep working. Fans,
    Hotspot plates, and the ground stay as they are. Character geometry is
    joined per rigid pivot and shares one atlas, preserving articulation.

    Returns a list of (group name, objects, atlas size) to bake.
    """
    statics, emissive_statics, props, plates, pavement = [], {}, [], [], []
    per_hotspot = {}
    per_joint = {}
    for o in mesh_objects():
        emis = is_emissive(o.data.materials[0]) if o.data.materials else False
        if o.parent is not None and o.parent.name.startswith("rig_"):
            d = per_joint.setdefault(o.parent.name, {"detail": [], "glow": {}})
            if emis:
                d["glow"].setdefault(o.data.materials[0].name, []).append(o)
            else:
                d["detail"].append(o)
        elif o.name.startswith("hotspot_") and not emis:
            plates.append(o)  # baked alone; the web scales its colour on hover
        elif o.parent is not None and o.parent.name.startswith("hotspot_"):
            d = per_hotspot.setdefault(o.parent.name, {"detail": [], "glow": {}})
            if emis:
                d["glow"].setdefault(o.data.materials[0].name, []).append(o)
            else:
                d["detail"].append(o)
        elif o.name.startswith("hotspot_") or o.name.startswith("prop_fan_") or o.name == "ground":
            continue
        elif o.name.startswith("prop_"):
            if not emis:
                props.append(o)
            else:
                emissive_statics.setdefault(o.data.materials[0].name, []).append(o)
        elif emis:
            emissive_statics.setdefault(o.data.materials[0].name, []).append(o)
        elif o.name.startswith("street_"):
            pavement.append(o)
        else:
            statics.append(o)

    groups = [("street", [join(pavement, "street")], 1024)]
    # Two building atlases, split at the sign's lower lip, double the texel
    # density of one. More would cost phone memory: each decodes to 16 MB.
    def height(o):
        return (o.matrix_world @ (sum((Vector(c) for c in o.bound_box), Vector()) / 8)).z

    lower = [o for o in statics if height(o) < 2.6]
    upper = [o for o in statics if height(o) >= 2.6]
    groups.append(("building_lower", [join(lower, "building_lower")], 2048))
    groups.append(("building_upper", [join(upper, "building_upper")], 2048))
    for key, objs in emissive_statics.items():
        join(objs, f"glow_{key}")
    for hs, d in per_hotspot.items():
        short = hs.removeprefix("hotspot_")
        if d["detail"]:
            groups.append((f"detail_{short}", [join(d["detail"], f"{short}_detail")], 512))
        for key, objs in d["glow"].items():
            join(objs, f"{short}_glow_{key}")
    for plate in plates:
        groups.append((f"plate_{plate.name.removeprefix('hotspot_')}", [plate], 512))
    if props:
        groups.append(("props", [join(props, "props")], 1024))
    fans = [o for o in mesh_objects() if o.name.startswith("prop_fan_")]
    if fans:
        groups.append(("fans", fans, 256))
    characters = []
    for joint, d in per_joint.items():
        if d["detail"]:
            characters.append(join(d["detail"], f"{joint}_detail"))
        for key, objs in d["glow"].items():
            join(objs, f"{joint}_glow_{key}")
    if characters:
        groups.append(("characters", characters, 1024))
    return groups


def unwrap(objs):
    """Give the objects a shared, non-overlapping 'bake' UV layout."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        uv = o.data.uv_layers.get("bake") or o.data.uv_layers.new(name="bake")
        o.data.uv_layers.active = uv
        uv.active_render = True
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_group(scene, name, objs, size, samples):
    """Bake combined lighting for the objects into one atlas. Returns the
    image; `use_atlas` swaps it in once every group is baked, so no group
    bounces light off another's already-lit texture."""
    unwrap(objs)
    img = bpy.data.images.new(f"bake_{name}", size, size, alpha=False)
    mats = {s.material for o in objs for s in o.material_slots if s.material}
    added = []
    for mt in mats:
        node = mt.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = img
        mt.node_tree.nodes.active = node
        added.append((mt, node))
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    scene.cycles.samples = samples
    scene.render.bake.margin = 8
    scene.render.bake.use_clear = True
    bpy.ops.object.bake(type="COMBINED")
    for mt, node in added:
        mt.node_tree.nodes.remove(node)
    os.makedirs(BAKE_DIR, exist_ok=True)
    img.filepath_raw = os.path.join(BAKE_DIR, f"{name}.png")
    img.file_format = "PNG"
    img.save()
    print(f"BAKED {name} {size}px {len(objs)} objects")
    return img


def use_atlas(name, objs, img):
    """Replace the objects' materials with one material showing the atlas."""
    baked = bpy.data.materials.new(f"baked_{name}")
    baked.use_nodes = True
    bsdf = baked.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    tex = baked.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    baked.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(baked)
        for p in o.data.polygons:
            p.material_index = 0
        for uv in list(o.data.uv_layers):
            if uv.name != "bake":
                o.data.uv_layers.remove(uv)
        # Authored coat colors are already in the atlas. Do not export them
        # again as vertex colors (which can also tint the bake in GLB viewers).
        for color in list(o.data.color_attributes):
            o.data.color_attributes.remove(color)


def bake_all(scene, groups, samples):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "OPTIX"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    atlases = []
    for name, objs, size in groups:
        full = name.startswith("building")
        atlases.append((name, objs, bake_group(scene, name, objs, size, samples if full else max(128, samples // 2))))
    for name, objs, img in atlases:
        use_atlas(name, objs, img)


def export():
    verts = sum(len(o.data.vertices) for o in mesh_objects())
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in mesh_objects())
    meshes = len(mesh_objects())
    images = len([i for i in bpy.data.images if i.name.startswith("bake_")])
    os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        if o.type == "MESH" or o.name.startswith("rig_") or o.name == "tv_screen_anchor":
            o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_lights=False,
        export_cameras=False,
        export_yup=True,
        export_extras=True,
        export_image_format="WEBP",
        export_image_quality=85,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    print(
        f"EXPORTED {GLB_PATH} {os.path.getsize(GLB_PATH)} bytes, "
        f"{meshes} meshes, {images} atlases, {verts} verts, {tris} tris"
    )


if __name__ == "__main__":
    scene, cams = build()
    finalize()
    if "--no-render" not in sys.argv:
        render(scene, cams)
    groups = regroup()
    if "--no-bake" not in sys.argv:
        bake_all(scene, groups, samples=512)
    export()
