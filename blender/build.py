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
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

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
    "warm": "ffc58a",
    "cookie": "c98a4b",
    "choc": "5a3420",
    "porcelain": "d4cebc",
    "cookie_edge": "9d6136",
    "steel": "8a98b8",
    "pave": "34366a",
    "pave_worn": "41436d",
    "pave_damp": "242742",
    "puddle": "30394d",
}

random.seed(7)


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def srgb(hex6):
    r, g, b = (int(hex6[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return (_lin(r), _lin(g), _lin(b), 1.0)


# ---------------------------------------------------------------- materials

_mats = {}


def mat(name, color, emit=None, strength=0.0, rough=0.7, metal=0.0, finish=None):
    key = (name, color, emit, strength, rough, metal, finish)
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
    elif finish:
        surface_finish(m, bsdf, srgb(PAL[color]), finish)
    else:
        weather(m, bsdf, srgb(PAL[color]))
    _mats[key] = m
    return m


def surface_finish(material, bsdf, color, finish):
    """Restrained material grain for the bake, not extra browser shaders.

    Wear is modeled at actual contact edges, separately from this grain.
    Food and glazed vessels stay clean rather than inheriting street grime.
    """
    if finish in ("food", "ceramic"):
        bsdf.inputs["Roughness"].default_value = 0.78 if finish == "food" else 0.24
        if finish == "ceramic":
            bsdf.inputs["Coat Weight"].default_value = 0.3
        return
    nt = material.node_tree
    position = nt.nodes.new("ShaderNodeNewGeometry").outputs["Position"]
    grain = nt.nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 95 if finish == "steel" else 65
    grain.inputs["Detail"].default_value = 1
    if finish == "steel":
        stretch = nt.nodes.new("ShaderNodeVectorMath")
        stretch.operation = "MULTIPLY"
        stretch.inputs[1].default_value = (0.025, 1, 1)
        nt.links.new(position, stretch.inputs[0])
        position = stretch.outputs[0]
    nt.links.new(position, grain.inputs["Vector"])
    tint = nt.nodes.new("ShaderNodeMixRGB")
    tint.inputs[1].default_value = tuple(c * 0.88 for c in color[:3]) + (1,)
    tint.inputs[2].default_value = color
    nt.links.new(grain.outputs["Fac"], tint.inputs[0])
    nt.links.new(tint.outputs[0], bsdf.inputs["Base Color"])
    if finish == "paint":
        bsdf.inputs["Coat Weight"].default_value = 0.28
        bsdf.inputs["Coat Roughness"].default_value = 0.3
    elif finish == "plastic":
        bsdf.inputs["Specular IOR Level"].default_value = 0.28
    elif finish == "glass":
        # Opaque tinted glass with a baked sheen avoids transparency sorting
        # and keeps the door complete in Light without live reflections.
        bsdf.inputs["Coat Weight"].default_value = 0.7
        bsdf.inputs["Coat Roughness"].default_value = 0.12


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
        self.enamel_blue = mat("enamel_blue", "blue", rough=0.42, metal=0.15, finish="paint")
        self.enamel_deep = mat("enamel_deep", "blue_deep", rough=0.42, metal=0.15, finish="paint")
        self.enamel_light = mat("enamel_light", "blue_light", rough=0.42, metal=0.15, finish="paint")
        self.enamel_teal = mat("enamel_teal", "teal_pale", rough=0.42, metal=0.15, finish="paint")
        self.plastic = mat("plastic", "purple", rough=0.62, finish="plastic")
        self.brushed_steel = mat("brushed_steel", "steel", rough=0.38, metal=0.65, finish="steel")
        self.glass = mat("tinted_glass", "blue_dark", rough=0.14, metal=0.18, finish="glass")
        self.glass_sheen = mat("glass_sheen", "blue_mid", rough=0.2, finish="glass")
        self.glaze = mat("glazed_cream", "porcelain", finish="ceramic")
        self.glaze_pink = mat("glazed_pink", "pink", finish="ceramic")
        self.milk = mat("fresh_milk", "white", finish="ceramic")
        self.dough = mat("baked_cookie", "cookie", finish="food")
        self.toasted = mat("toasted_cookie_edge", "cookie_edge", finish="food")
        self.chips = mat("embedded_chocolate", "choc", finish="food")
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


def ring(name, center, radius, thickness, material, rot=(0, 0, 0)):
    """An actual open ring, with enough sides for the baked highlight."""
    bpy.ops.mesh.primitive_torus_add(
        major_segments=32, minor_segments=8, location=center, rotation=rot,
        major_radius=radius, minor_radius=thickness,
    )
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    return o


def turned_vessel(name, center, profile, material, segments=32):
    """Turn a radius/height cross-section into a closed, genuinely hollow Prop.

    The profile follows the underside, outer wall, lip and inner surface.
    Keeping both surfaces avoids solid cup caps and paper-thin tray edges.
    """
    vertices, rows, faces = [], [], []
    for radius, height in profile:
        row = []
        for i in range(segments if radius else 1):
            angle = math.tau * i / segments
            row.append(len(vertices))
            vertices.append((radius * math.cos(angle), radius * math.sin(angle), height))
        rows.append(row)
    for lower, upper in zip(rows, rows[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            if len(lower) == 1:
                faces.append((lower[0], upper[j], upper[i]))
            elif len(upper) == 1:
                faces.append((lower[i], lower[j], upper[0]))
            else:
                faces.append((lower[i], lower[j], upper[j], upper[i]))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = _link(bpy.data.objects.new(name, mesh))
    obj.location = center
    # Inside walls can face +Y and still be visible from above the rim.
    obj["preserve_faces"] = True
    mesh.materials.append(material)
    return obj


def cookie(name, center, radius, depth, m, seed):
    """A flat-bottomed cookie with a soft irregular edge and embedded chips."""
    body = turned_vessel(name, center, (
        (0, -depth / 2), (radius * 0.88, -depth / 2),
        (radius, -depth * 0.22), (radius * 0.98, depth * 0.15),
        (radius * 0.84, depth * 0.45), (radius * 0.48, depth / 2),
        (0, depth / 2),
    ), m.dough)
    body.data.materials.append(m.toasted)
    for face in body.data.polygons[:96]:
        face.material_index = 1
    rnd = random.Random(seed)
    phase = rnd.uniform(0, math.tau)
    for vertex in body.data.vertices:
        angle = math.atan2(vertex.co.y, vertex.co.x)
        variation = 0.96 + 0.025 * math.sin(5 * angle + phase) + 0.015 * math.sin(9 * angle - phase)
        vertex.co.x *= variation
        vertex.co.y *= variation
    parts = [body]
    x, y, z = center
    for i in range(6):
        angle = phase + i * 2.4
        distance = radius * (0.22 if i == 0 else rnd.uniform(0.4, 0.69))
        size = radius * rnd.uniform(0.10, 0.15)
        parts.append(blob(
            f"{name}_chip_{i}",
            (x + distance * math.cos(angle), y + distance * math.sin(angle), z + depth * 0.42),
            (size, size * 0.8, depth * 0.18), m.chips, turn=angle, detail=4,
        ))
    return parts


def profile_prism(name, profile, y, depth, material):
    """Extrude an X/Z silhouette along Y: folded cartons and vehicle panels."""
    n = len(profile)
    verts = [(x, y + side * depth / 2, z) for side in (-1, 1) for x, z in profile]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    faces += [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = _link(bpy.data.objects.new(name, mesh))
    mesh.materials.append(material)
    # Recalculate winding for arbitrary caller silhouettes.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    return bevel(o, 0.008, 2, True)


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
        if o.name == "ground" or o.get("preserve_faces") or (o.parent and o.parent.name.startswith("rig_")):
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


def street_patch(name, outline, height, material):
    """Flat wear with explicit clearance, joined into the existing street atlas."""
    # Author outlines in either direction, but always face up for the bake
    # and the browser's back-face culling.
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(outline, outline[1:] + outline[:1]))
    if area < 0:
        outline = list(reversed(outline))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(x, y, height) for x, y in outline], [], [tuple(range(len(outline)))])
    mesh.update()
    obj = _link(bpy.data.objects.new(name, mesh))
    obj.data.materials.append(material)
    return obj


def street_detail(m):
    """Local entrance wear; the walkway and passing traffic keep their clearance.

    These opaque surfaces bake their sheen and remain readable in Light.
    No new reflector, transparent overlay, texture or draw call is needed.
    """
    worn = mat("pave_worn", "pave_worn", rough=0.94)
    damp = mat("pave_damp", "pave_damp", rough=0.82)
    water = mat("shallow_water", "puddle", rough=0.16, metal=0.25, finish="glass")
    # A shallow drain well in the opening cut from the sidewalk below.
    box("street_drain_bed", (1.68, -2.07, -0.046), (0.42, 0.40, 0.018), m.ink)
    for x in (1.484, 1.876):
        box("street_drain_frame", (x, -2.07, -0.008), (0.028, 0.40, 0.024), m.steel_dull)
    for y in (-2.256, -1.884):
        box("street_drain_frame", (1.68, y, -0.008), (0.364, 0.028, 0.024), m.steel_dull)
    for i in range(7):
        box(f"street_drain_bar_{i}", (1.524 + i * 0.052, -2.07, -0.010), (0.022, 0.344, 0.022), m.steel_dull)

    # Small asymmetric chips and a repaired corner along two existing joints.
    # Kept above the original joints (top 3 mm) to survive GLB quantization.
    for i, outline in enumerate((
        [(1.058, -2.39), (1.12, -2.34), (1.09, -2.28), (1.14, -2.24), (1.058, -2.18)],
        [(2.108, -1.74), (2.19, -1.80), (2.25, -1.83), (2.18, -1.86), (2.108, -1.95)],
        [(0.07, -2.40), (0.23, -2.40), (0.16, -2.34), (0.09, -2.29)],
    )):
        street_patch(f"street_worn_joint_{i}", outline, 0.007, worn)
    street_patch("street_hairline", [
        (2.26, -1.89), (2.38, -1.96), (2.43, -2.13), (2.57, -2.23),
        (2.42, -2.14), (2.367, -1.97), (2.25, -1.90),
    ], 0.007, damp)

    # Deterministic, low silhouettes: spills near the bin/door and water at
    # the curb. The outer damp ring and inner water share edges, never overlap.
    for i, (cx, cy, rx, ry, height, wet) in enumerate((
        (1.30, -1.91, 0.13, 0.18, 0.005, False),
        (1.96, -2.26, 0.10, 0.11, 0.005, False),
        (0.35, -2.30, 0.16, 0.08, 0.005, False),
        (2.18, -2.90, 0.69, 0.23, -CURB + 0.007, True),
        (-0.38, -2.86, 0.45, 0.17, -CURB + 0.007, True),
    )):
        count = 32
        outline = []
        for j in range(count):
            a = j * math.tau / count
            radius = 1 + 0.10 * math.sin(a * 3 + i) + 0.06 * math.cos(a * 5 - i)
            outline.append((cx + rx * radius * math.cos(a), cy + ry * radius * math.sin(a)))
        if not wet:
            street_patch(f"street_stain_{i}", outline, height, damp)
            continue
        inner = [(cx + (x - cx) * 0.91, cy + (y - cy) * 0.83) for x, y in outline]
        mesh = bpy.data.meshes.new(f"street_puddle_{i}")
        vertices = [(x, y, height) for x, y in outline + inner]
        faces = [(j, (j + 1) % count, (j + 1) % count + count, j + count) for j in range(count)]
        faces.append(tuple(range(count, count * 2)))
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = _link(bpy.data.objects.new(f"street_puddle_{i}", mesh))
        mesh.materials.append(damp)
        mesh.materials.append(water)
        mesh.polygons[-1].material_index = 1


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
    # Leave a real opening under the grate, rather than laying bars on stone.
    pieces.remove(((0, 3 * slab), (-2.6, -1.5)))
    pieces.extend([
        ((0, 1.47), (-2.6, -1.5)),
        ((1.89, 3 * slab), (-2.6, -1.5)),
        ((1.47, 1.89), (-2.6, -2.27)),
        ((1.47, 1.89), (-1.87, -1.5)),
    ])
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
    street_detail(m)


def storefront(m):
    # Split the right shell around a real doorway. The door sits 30 cm
    # behind the facade; no solid front wall can fill its reveal or glass.
    box("storefront_right_back", (1.6, 0.2, 1.3), (2.6, 2.6, 2.6), m.enamel_blue)
    box("storefront_door_left", (0.46, -1.3, 1.3), (0.32, 0.4, 2.6), m.enamel_blue)
    box("storefront_door_right", (2.24, -1.3, 1.3), (1.32, 0.4, 2.6), m.enamel_blue)
    box("storefront_door_header", (1.1, -1.3, 2.41), (0.96, 0.4, 0.38), m.enamel_blue)
    box("storefront_back", (-1.3, 0.9, 1.3), (3.2, 1.2, 2.6), m.blue)
    box("storefront_left_wall", (-2.75, -0.6, 1.3), (0.3, 1.8, 2.6), m.blue)
    box("storefront_ceiling", (-1.3, -0.6, 2.45), (3.2, 1.8, 0.3), m.blue)
    box("recess_floor", (-1.3, -0.6, 0.05), (2.6, 1.8, 0.1), m.ink)
    box("recess_back_wall", (-1.3, 0.29, 1.2), (2.6, 0.02, 2.2), m.purple_deep)
    box("recess_left_wall", (-2.59, -0.6, 1.2), (0.02, 1.8, 2.2), m.purple_deep)
    box("recess_right_wall", (0.29, -0.6, 1.2), (0.02, 1.8, 2.2), m.purple_deep)
    box("recess_ceiling", (-1.3, -0.6, 2.29), (2.6, 1.8, 0.02), m.purple_deep)
    # Pillars and trims that frame the opening
    box("pillar_left", (-2.78, -1.54, 1.3), (0.26, 0.28, 2.6), m.enamel_deep)
    box("pillar_mid", (0.42, -1.54, 1.3), (0.26, 0.28, 2.6), m.enamel_deep)
    for x in (-2.78, 0.42):
        box("opening_frame_cap", (x, -1.69, 1.3), (0.18, 0.035, 2.56), m.enamel_light)
        box("opening_frame_foot", (x, -1.71, 0.16), (0.19, 0.018, 0.22), m.brushed_steel)
    box("opening_trim", (-1.18, -1.54, 2.37), (2.94, 0.28, 0.14), m.enamel_deep)
    box("opening_header_lip", (-1.18, -1.7, 2.44), (2.99, 0.08, 0.055), m.enamel_light)
    box("opening_neon", (-1.18, -1.69, 2.31), (2.9, 0.02, 0.03), m.neon_soft)
    # Hanging shop sign inside the opening, like the Reference's small sign
    box("hang_chain_l", (-2.2, -1.2, 2.16), (0.015, 0.015, 0.26), m.steel)
    box("hang_chain_r", (-1.7, -1.2, 2.16), (0.015, 0.015, 0.26), m.steel)
    box("hang_sign", (-1.95, -1.2, 1.9), (0.7, 0.05, 0.3), m.purple)
    box("hang_sign_face", (-1.95, -1.23, 1.9), (0.62, 0.01, 0.22), m.screen_pink)
    text("hang_sign_text", "OPEN", 0.11, m.ink, (-1.95, -1.24, 1.9), extrude=0.004)

    # Layered jambs expose the recess from Street View and oblique Stations.
    for x in (0.665, 1.535):
        box("door_reveal", (x, -1.34, 1.1), (0.09, 0.36, 2.2), m.enamel_deep)
        box("door_architrave", (x, -1.535, 1.1), (0.12, 0.07, 2.23), m.enamel_light)
        box("door_gasket", (x + (0.052 if x < 1.1 else -0.052), -1.21, 1.07), (0.018, 0.025, 2.1), m.ink)
    box("door_lintel", (1.1, -1.34, 2.16), (0.81, 0.36, 0.08), m.enamel_deep)
    box("door_lintel_trim", (1.1, -1.535, 2.22), (0.99, 0.07, 0.08), m.enamel_light)
    box("door_threshold", (1.1, -1.33, 0.025), (0.86, 0.39, 0.05), m.brushed_steel)
    box("door", (1.1, -1.16, 1.075), (0.74, 0.08, 2.1), m.plastic)
    box("door_window_seal", (1.1, -1.209, 1.6), (0.52, 0.022, 0.76), m.ink)
    box("door_window", (1.1, -1.226, 1.6), (0.46, 0.012, 0.7), m.glass)
    # Restrained diagonal reflection shapes survive the unlit browser bake.
    for offset, width in ((-0.13, 0.035), (-0.06, 0.013)):
        box("door_glass_sheen", (1.1 + offset, -1.234, 1.74), (width, 0.003, 0.32), m.glass_sheen, rot=(0, -0.22, 0))
    box("door_window_bar", (1.1, -1.24, 1.6), (0.46, 0.016, 0.03), m.plastic)
    box("door_handle_plate", (1.36, -1.211, 1.0), (0.085, 0.018, 0.32), m.brushed_steel)
    box("door_handle", (1.36, -1.255, 1.0), (0.035, 0.08, 0.23), m.brushed_steel)
    box("door_kick", (1.1, -1.209, 0.22), (0.65, 0.018, 0.25), m.brushed_steel)
    for i, (x, z, width) in enumerate(((0.91, 0.21, 0.10), (1.17, 0.15, 0.14), (1.25, 0.27, 0.07))):
        box(f"door_kick_scuff_{i}", (x, -1.219, z), (width, 0.002, 0.005), m.steel_dull, rot=(0, 0.09 * (i - 1), 0))
    # A recessed service panel and folded edges break up the lower facade.
    box("facade_panel_gasket", (2.45, -1.509, 0.73), (0.69, 0.018, 1.0), m.ink)
    box("facade_service_panel", (2.45, -1.526, 0.73), (0.65, 0.025, 0.96), m.enamel_deep)
    # Three wall lamps above the board
    for i, x in enumerate((1.75, 2.0, 2.25)):
        lamp_m = m.bulb_pink if i == 1 else m.bulb
        cyl(f"wall_lamp_ring_{i}", (x, -1.52, 2.35), 0.1, 0.05, m.purple, axis="Y")
        cyl(f"wall_lamp_{i}", (x, -1.54, 2.35), 0.07, 0.04, lamp_m, axis="Y")
    # Vent grille and a downpipe on the right wall
    for i in range(4):
        box(f"vent_slat_{i}", (2.45, -1.543, 0.5 + i * 0.09), (0.48, 0.02, 0.035), m.ink)
        box(f"vent_fold_{i}", (2.45, -1.56, 0.524 + i * 0.09), (0.48, 0.045, 0.018), m.brushed_steel)
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
    for i in range(12):
        a = math.tau * i / 12
        cyl(f"prop_trash_rib_{i}", (1 + 0.18 * math.cos(a), -1.95 + 0.18 * math.sin(a), 0.29), 0.009, 0.48, m.blue_mid)
    ring("prop_trash_rolled_rim", (1, -1.95, 0.61), 0.187, 0.015, m.steel_dull)
    for x in (0.8, 1.2):
        tube("prop_trash_handle", [(x, -1.99, 0.49), (x, -2.02, 0.54), (x, -1.88, 0.54), (x, -1.91, 0.49)], 0.012, m.blue_deep)
    bag = blob("prop_trash_bag", (1.32, -1.9, 0.17), (0.19, 0.15, 0.19), m.ink, detail=10)
    for v in bag.data.vertices:
        a = math.atan2(v.co.y, v.co.x)
        v.co.x *= 1 + 0.07 * math.sin(a * 7 + v.co.z * 19)
        v.co.y *= 1 + 0.09 * math.sin(a * 5)
    cone("prop_trash_bag_neck", (1.33, -1.9, 0.36), 0.065, 0.025, 0.085, m.ink)
    ring("prop_trash_bag_tie", (1.33, -1.9, 0.38), 0.028, 0.007, m.steel_dull)
    blob("prop_trash_bag_knot", (1.34, -1.9, 0.41), (0.05, 0.035, 0.035), m.ink, detail=6)


def cat(name, base, identity, turn=0.0, tail_side=1):
    """Skadi (long-haired brown tabby) or Freya (short-haired gray bicolor).

    Authored coat colors survive regrouping as vertex colors, then bake into
    the existing character atlas. The numbered pivots are the web animation
    contract; identity changes the likeness without changing those joints.
    Photos are visual references only and are not needed to rebuild."""
    # Model in forward-facing local axes; the travel pivot supplies heading.
    spin = Matrix.Identity(3)
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
        obj = blob(f"{name}_{part}", at(*center), radii, fur, detail=detail)
        return paint(obj, lambda p: pattern(*(p[i] / radii[i] for i in range(3))) if pattern else color)

    def continuous_fur(parts, part):
        """Weld overlapping coat volumes before baking, retaining painted color.

        Merely joining the spheres leaves internal faces crossing the outer
        coat when the neck turns. A small voxel union makes one closed skin.
        """
        obj = join(parts, f"{name}_{part}")
        obj.data.calc_loop_triangles()
        vertices = [v.co.copy() for v in obj.data.vertices]
        triangles = [tuple(t.vertices) for t in obj.data.loop_triangles]
        colors = [Vector(c.color) for c in obj.data.color_attributes["cat_coat"].data]
        surface = BVHTree.FromPolygons(vertices, triangles, all_triangles=True)
        obj.data.remesh_voxel_size = 0.003
        with bpy.context.temp_override(active_object=obj, object=obj):
            bpy.ops.object.voxel_remesh()
        soften = obj.modifiers.new("soft coat", "SMOOTH")
        soften.factor = 0.7
        soften.iterations = 4
        simplify = obj.modifiers.new("coat budget", "DECIMATE")
        simplify.ratio = 0.4
        apply_modifiers([obj])
        for attribute in list(obj.data.color_attributes):
            obj.data.color_attributes.remove(attribute)

        def color_at(point):
            nearest, _, index, _ = surface.find_nearest(point)
            a, b, c = triangles[index]
            weights = barycentric_transform(nearest, vertices[a], vertices[b], vertices[c],
                                            Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
            return colors[a] * weights.x + colors[b] * weights.y + colors[c] * weights.z

        obj["organic"] = True
        return paint(obj, color_at)

    def fur_segment(part, start, end, radii, color, pattern=None):
        a, b = Vector(start), Vector(end)
        obj = ellipsoid(part, (a + b) / 2, (*radii, (b - a).length / 2 + 0.009), color, pattern)
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(b - a)
        return obj

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

    haunch_coat = ellipsoid("haunch", (0, 0.033, 0.069), (0.103 if fluffy else 0.09, 0.082, 0.069), coat,
                           lambda x, y, z: white if z < -0.4 and y < -0.15 else tabby(x, y, z), 16)
    haunch = articulation(f"rig_{name}_haunch", at(0, 0.033, 0.069), [])
    body_parts = [
        ellipsoid("body", (0, 0.012, 0.133), (0.081 if fluffy else 0.067, 0.067, 0.105), coat, body_coat, 20),
    ]
    legs = []
    for side in (-1, 1):
        suffix = "left" if side == -1 else "right"
        for kind, px, py, hip, knee, ankle, knee_offset in (
            ("front", side * 0.039, -0.041, 0.135, 0.076, 0.018, 0.022),
            ("hind", side * 0.060, 0.038, 0.112, 0.062, 0.019, -0.051),
        ):
            prefix = f"rig_{name}_{kind}_{suffix}"
            a, b, c = (px, py, hip), (px, py + knee_offset, knee), (px, py, ankle)
            upper = articulation(prefix, at(*a), [
                fur_segment(f"{kind}_leg_{side}", a, b, (0.023, 0.026), coat,
                            tabby if kind == "hind" else lambda x, y, z: tabby(x, y, z) if fluffy and z < -0.25 else white),
            ])
            lower = articulation(f"{prefix}_lower", at(*b), [
                fur_segment(f"{kind}_shin_{side}", b, c, (0.018, 0.020), white),
            ])
            paw = articulation(f"{prefix}_paw", at(px, py, ankle), [
                ellipsoid(f"{kind}_paw_{side}", (px, py - 0.009, ankle),
                          (0.025 if kind == "front" else 0.023, 0.029, ankle), white),
            ])
            parent([paw], lower)
            parent([lower], upper)
            legs.append(upper)
    ruff = None
    if fluffy:
        # One continuous mane, with a gently uneven silhouette. Keeping the
        # tufts in the surface avoids bead-like pieces and extra UV islands.
        ruff = ellipsoid("ruff", (0, -0.02, 0.177), (0.088, 0.065, 0.060), white, detail=20)
        for v in ruff.data.vertices:
            angle = math.atan2(v.co.y / 0.073, v.co.x / 0.097)
            lower = max(0, -v.co.z / 0.072)
            ripple = 1 + 0.08 * math.cos(angle * 9) * (1 - lower)
            v.co.x *= ripple * (1 - 0.22 * lower)
            v.co.y *= ripple
            v.co.z -= 0.008 * lower * (0.5 + 0.5 * math.cos(angle * 9))
    torso = continuous_fur([*body_parts, haunch_coat], "torso")
    # One deforming coat spans the chest and pelvis. The standing shape blends
    # their rigid transforms in authored space, avoiding an exposed hip seam.
    torso.shape_key_add(name="Basis")
    standing = torso.shape_key_add(name="standing")
    chest_pivot = Vector((0, 0.02, 0.09))
    pelvis_pivot = Vector((0, 0.033, 0.069))
    chest_rotation = Matrix.Rotation(1.2, 3, "X")
    pelvis_rotation = Matrix.Rotation(0.18, 3, "X")
    inverse = torso.matrix_world.inverted()
    for vertex, target in zip(torso.data.vertices, standing.data):
        p = torso.matrix_world @ vertex.co - Vector(base)
        weight = max(min(1, max(0, (0.065 - p.y) / 0.10)), min(1, max(0, (p.z - 0.12) / 0.08)))
        weight = weight * weight * (3 - 2 * weight)
        chest = chest_pivot + chest_rotation @ (p - chest_pivot) + Vector((0, 0, 0.036))
        pelvis = p - pelvis_pivot
        pelvis.x *= 0.88
        pelvis = pelvis_pivot + pelvis_rotation @ pelvis + Vector((0, 0.025, 0.07))
        standing_point = pelvis.lerp(chest, weight)
        # Runtime's chest pivot supplies the common rotation and lift.
        local = chest_pivot + chest_rotation.transposed() @ (standing_point - chest_pivot - Vector((0, 0, 0.036)))
        target.co = inverse @ (Vector(base) + local)
    body = articulation(f"rig_{name}_body", at(0, 0.02, 0.09), [torso])
    body["cat_name"] = identity

    head_parts = [ellipsoid("head", (0, -0.018, 0.241), (0.072 if fluffy else 0.065, 0.058, 0.06), coat, face_coat, 28)]
    ears = []
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
        ear_shell = paint(ear, lambda p: coat)
        me = bpy.data.meshes.new(f"{name}_inner_ear_{side}")
        me.from_pydata([at(side * 0.032, -0.0425, 0.279), at(side * 0.063, -0.031, 0.279), at(side * 0.059, -0.017, 0.321)], [], [(0, 1, 2) if side == 1 else (2, 1, 0)])
        inner = _link(bpy.data.objects.new(me.name, me))
        ears.append(articulation(f"rig_{name}_ear_{'left' if side == -1 else 'right'}",
                                at(side * 0.045, -0.025, 0.275), [ear_shell, paint(inner, lambda p: pink)]))
    head_parts.extend([
        ellipsoid("chin", (0, -0.066, 0.202), (0.024, 0.016, 0.013), white),
        # Freya's long gray nose patch interrupts the white blaze; Skadi's
        # brown bridge is shorter and wider, as in the supplied portraits.
        ellipsoid("nose_bridge", (0.003 if not fluffy else 0, -0.075, 0.239), (0.011 if not fluffy else 0.014, 0.006, 0.022 if not fluffy else 0.016), coat),
        ellipsoid("nose", (0, -0.085, 0.222), (0.009, 0.005, 0.006), pink, detail=8),
        ellipsoid("mouth", (0, -0.084, 0.211), (0.0015, 0.0015, 0.006), dark, detail=6),
    ])
    face_detail = [p for p in head_parts if p.name.endswith(("nose_bridge", "nose", "mouth"))]
    coat_parts = [p for p in head_parts if p not in face_detail]
    if ruff:
        coat_parts.append(ruff)
    head = articulation(f"rig_{name}_head", at(0, -0.01, 0.195),
                        [continuous_fur(coat_parts, "face_coat"), *face_detail])
    s = tail_side
    tail_points = [(0.048, 0.082, 0.05), (0.123, 0.065, 0.042), (0.14, -0.033, 0.029), (0.098, -0.091, 0.025), (0.028, -0.105, 0.025)]
    tail = tube(f"{name}_tail", [at(s * x, y, z) for x, y, z in tail_points], 0.027 if fluffy else 0.013, fur)
    def tail_coat(p):
        local = spin.transposed() @ (p - Vector(base))
        return stripe if math.sin((local.x * s - local.y) * 100) > 0.25 else coat
    tail["organic"] = True
    paint(tail, tail_coat)
    tail_tip = ellipsoid("tail_tip", (s * 0.028, -0.105, 0.025), (0.027 if fluffy else 0.013,) * 3, stripe)
    tail = continuous_fur([tail, tail_tip], "tail_coat")
    tail.shape_key_add(name="Basis")
    sway = tail.shape_key_add(name="sway")
    tip_pivot = Vector(at(s * 0.14, -0.033, 0.029))
    inverse = tail.matrix_world.inverted()
    for vertex, target in zip(tail.data.vertices, sway.data):
        p = tail.matrix_world @ vertex.co
        amount = min(1, max(0, (-0.025 - (p.y - base[1])) / 0.08))
        amount = amount * amount * (3 - 2 * amount)
        target.co = inverse @ (tip_pivot + Matrix.Rotation(0.18 * amount, 3, "Z") @ (p - tip_pivot))
    tail_end = articulation(f"rig_{name}_tail_end", tuple(tip_pivot), [])
    tail_pivot = articulation(f"rig_{name}_tail", at(s * 0.048, 0.082, 0.05), [tail, tail_end])
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
    parent([eyelids, *ears], head)
    parent([head], body)
    travel = articulation(f"rig_{name}_travel", base, [body, haunch, tail_pivot, *legs])
    travel.rotation_euler.z = turn


def mouse(m):
    """An original, small sidewalk Prop; hidden by the web between chases."""
    x, y, z = -2.45, -1.72, 0.0
    parts = [
        blob("mouse_body", (x, y, z + 0.038), (0.033, 0.064, 0.034), m.steel),
        blob("mouse_head", (x, y - 0.058, z + 0.035), (0.025, 0.035, 0.024), m.steel),
        ball("mouse_nose", (x, y - 0.089, z + 0.032), 0.008, m.pink),
        tube("mouse_tail", [(x, y + 0.052, z + 0.02), (x + 0.018, y + 0.095, z + 0.013), (x - 0.012, y + 0.14, z + 0.01)], 0.005, m.pink),
    ]
    for side in (-1, 1):
        parts.extend([
            blob("mouse_ear", (x + side * 0.023, y - 0.036, z + 0.063), (0.017, 0.009, 0.019), m.pink_pale),
            ball("mouse_eye", (x + side * 0.019, y - 0.074, z + 0.042), 0.0045, m.ink),
        ])
    articulation("rig_prop_mouse", (x, y, z), parts)


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
    torso = articulation("rig_barista_body", (-0.9, -0.55, 0.97), body)

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
        robot_arm(m, f"barista_{suffix}", (-0.9 + side * 0.28, -0.55, 1.5),
                  0.43, 0.43, m.teal_pale)
    parent([
        bpy.data.objects[name] for name in (
            "rig_barista_head",
            "rig_barista_cup_upper", "rig_barista_tray_upper")
    ], torso)
    articulation("rig_barista_travel", (-0.9, -0.55, 0), [torso])
    serving_props(m)


def robot_arm(m, prefix, shoulder, upper_length, lower_length, enamel):
    """Two down-facing rigid bones and an independently oriented gripper.

    Lengths and grip origins are the contract with customerVisits.ts. The
    runtime solves their reach without stretching or real-time lighting.
    """
    x, y, z = shoulder
    upper = articulation(f"rig_{prefix}_upper", shoulder, [
        cyl("robot_shoulder", shoulder, 0.068, 0.105, m.steel_dull, axis="X"),
        box("robot_upper_arm", (x, y, z - upper_length / 2), (0.075, 0.08, upper_length - 0.055), enamel),
        box("robot_arm_inset", (x, y - 0.044, z - upper_length / 2), (0.031, 0.012, upper_length * 0.5), m.blue_deep),
    ])
    elbow = (x, y, z - upper_length)
    lower = articulation(f"rig_{prefix}_lower", elbow, [
        cyl("robot_elbow", elbow, 0.055, 0.10, m.purple, axis="X"),
        box("robot_forearm", (x, y, elbow[2] - lower_length / 2), (0.08, 0.085, lower_length - 0.035), enamel),
        box("robot_forearm_inset", (x, y - 0.047, elbow[2] - lower_length / 2), (0.035, 0.01, lower_length * 0.6), m.blue_mid),
    ])
    grip = (x, y, elbow[2] - lower_length)
    # The gap fits the finished cup wall; the runtime closes it for a cookie.
    # Thin fingers allow opposite hands to share the cup at different heights.
    parts = [box("robot_palm", (x, y + 0.071, grip[2]), (0.13, 0.035, 0.034), m.purple)]
    for side in (-1, 1):
        parts.append(box("robot_finger", (x + side * 0.057, y + 0.003, grip[2]), (0.016, 0.11, 0.034), m.steel_dull))
    hand = articulation(f"rig_{prefix}_hand", grip, parts)
    parent([hand], lower)
    parent([lower], upper)
    return upper


def serving_props(m):
    """Cup, milk, tray and one transferable cookie, each with an origin."""
    x, y, z = -0.62, -1.055, 1.31
    shell = turned_vessel("service_cup", (x, y, z), (
        (0, -0.065), (0.037, -0.065), (0.041, -0.062),
        (0.048, -0.03), (0.052, 0.057), (0.053, 0.063),
        (0.051, 0.068), (0.047, 0.068), (0.0445, 0.062),
        (0.0445, -0.03), (0.036, -0.055), (0, -0.055),
    ), m.glaze)
    cup = articulation("rig_service_cup", (x, y, z), [
        shell,
        ring("service_cup_rim", (x, y, z + 0.064), 0.051, 0.0035, m.glaze_pink),
        box("service_cup_label", (x, y - 0.048, z), (0.046, 0.008, 0.036), m.pink),
    ])
    milk = articulation("rig_service_milk", (x, y, z + 0.059), [
        turned_vessel("service_milk", (x, y, z + 0.059), (
            (0, -0.0025), (0.043, -0.0025), (0.043, 0.0025),
            (0.039, 0.001), (0, 0.001),
        ), m.milk),
    ])
    parent([milk], cup)
    x, y, z = -1.18, -1.04, 1.31
    tray = articulation("rig_service_tray", (x, y, z), [
        turned_vessel("service_tray", (x, y, z), (
            (0, -0.01), (0.11, -0.01), (0.126, 0.0),
            (0.13, 0.013), (0.128, 0.022), (0.121, 0.024),
            (0.114, 0.012), (0, 0.012),
        ), m.brushed_steel),
        cyl("service_tray_inset", (x, y, z + 0.015), 0.11, 0.006, m.glaze_pink),
    ])
    x += 0.045
    served_cookie = articulation("rig_service_cookie", (x, y, z + 0.03),
        cookie("service_cookie", (x, y, z + 0.03), 0.043, 0.024, m, seed=17))
    parent([served_cookie], tray)


def customer(m, number, x):
    """Original enamel regulars: a teal round head and a pink square head.

    Hip .66, thigh/shin .22/.34, shoulder 1.065; each limb joins at export.
    The shorter thigh clears the stool cushion while the shin reaches its ring.
    """
    y = -2.28
    prefix = f"prop_customer_{number}"
    accent = m.teal_pale if number == 1 else m.pink_pale
    glow = m.neon_soft if number == 1 else m.neon_pink
    parts = [
        box("customer_pelvis", (x, y, 0.66), (0.28, 0.22, 0.13), m.purple),
        box("customer_torso", (x, y, 0.9), (0.31, 0.24, 0.37), m.blue_deep),
        box("customer_chest", (x, y - 0.129, 0.94), (0.265, 0.035, 0.22), accent),
        box("customer_back_panel", (x, y + 0.129, 0.94), (0.23, 0.025, 0.24), accent),
        box("customer_chest_inset", (x, y - 0.152, 0.97), (0.14, 0.012, 0.08), m.purple),
        cyl("customer_neck", (x, y, 1.115), 0.06, 0.09, m.steel_dull),
    ]
    for offset in (-0.06, 0, 0.06):
        parts.append(box("customer_back_vent", (x, y + 0.147, 0.94 + offset), (0.14, 0.012, 0.012), m.blue_deep))
    body = articulation(f"rig_{prefix}_body", (x, y, 0.66), parts)
    head_parts = [
        (blob("customer_round_head", (x, y, 1.28), (0.18, 0.145, 0.17), accent)
         if number == 1 else box("customer_square_head", (x, y, 1.28), (0.32, 0.27, 0.29), accent)),
        box("customer_visor", (x, y - 0.139, 1.3), (0.265, 0.035, 0.12), m.ink),
        box("customer_mouth", (x, y - 0.141, 1.205), (0.09, 0.018, 0.025), m.ink),
        cyl("customer_antenna", (x + (0.0 if number == 1 else 0.1), y, 1.48), 0.009, 0.09, m.steel_dull),
        ball("customer_antenna_tip", (x + (0.0 if number == 1 else 0.1), y, 1.535), 0.019, glow, subdiv=2),
    ]
    for side in (-1, 1):
        head_parts.append(cyl("customer_ear", (x + side * 0.175, y, 1.28), 0.056, 0.035, m.steel_dull, axis="X"))
    head = articulation(f"rig_{prefix}_head", (x, y, 1.12), head_parts)
    eyes = articulation(f"rig_{prefix}_eyes", (x, y - 0.161, 1.31), [
        box("customer_eye", (x + side * 0.054, y - 0.161, 1.31), (0.03, 0.008, 0.044 if number == 1 else 0.025), glow)
        for side in (-1, 1)
    ])
    parent([eyes], head)
    arms = [robot_arm(m, f"{prefix}_{side}", (x + sign * 0.205, y, 1.065), 0.32, 0.32, accent)
            for side, sign in (("left", -1), ("right", 1))]
    parent([head, *arms], body)
    legs = []
    for side, sign in (("left", -1), ("right", 1)):
        lx = x + sign * 0.087
        thigh = articulation(f"rig_{prefix}_{side}_thigh", (lx, y, 0.66), [
            cyl("customer_hip", (lx, y, 0.66), 0.055, 0.075, m.steel_dull, axis="X"),
            box("customer_thigh", (lx, y, 0.55), (0.09, 0.105, 0.17), accent),
        ])
        shin = articulation(f"rig_{prefix}_{side}_shin", (lx, y, 0.44), [
            cyl("customer_knee", (lx, y, 0.44), 0.052, 0.10, m.purple, axis="X"),
            box("customer_shin", (lx, y, 0.27), (0.08, 0.09, 0.28), m.blue_mid),
        ])
        foot = articulation(f"rig_{prefix}_{side}_foot", (lx, y, 0.10), [
            box("customer_boot", (lx, y - 0.024, 0.06), (0.115, 0.16, 0.115), m.purple),
            box("customer_boot_toe", (lx, y - 0.07, 0.067), (0.105, 0.065, 0.06), accent),
            box("customer_sole", (lx, y - 0.024, 0.013), (0.12, 0.16, 0.025), m.ink),
        ])
        parent([foot], shin)
        parent([shin], thigh)
        legs.append(thigh)
    articulation(f"rig_{prefix}_travel", (x, y, 0), [body, *legs])


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
        ring(f"stool_{i}_ring", (x, -1.9, 0.22), 0.11, 0.012, m.steel)
        for side in (-1, 1):
            box(f"stool_{i}_brace_{side}", (x + side * 0.067, -1.9, 0.22), (0.1, 0.018, 0.018), m.steel)
        cyl(f"stool_{i}_collar", (x, -1.9, 0.43), 0.05, 0.1, m.purple)
        cyl(f"stool_{i}_seat", (x, -1.9, 0.55), 0.19, 0.08, m.pink)
        ring(f"stool_{i}_piping", (x, -1.9, 0.575), 0.182, 0.008, m.pink_pale)
        cyl(f"stool_{i}_seat_rim", (x, -1.9, 0.505), 0.19, 0.015, m.purple)
    # Things on the counter: cups, a napkin box, a cookie plate, two cats
    for i, x in enumerate((-2.3, -1.12, -0.98)):
        turned_vessel(f"cup_{i}", (x, -1.16, 1.04), (
            (0, -0.05), (0.03, -0.05), (0.034, -0.045),
            (0.047, 0.047), (0.046, 0.053), (0.041, 0.053),
            (0.04, 0.045), (0.028, -0.041), (0, -0.041),
        ), m.glaze)
        ring(f"cup_{i}_rim", (x, -1.16, 1.09), 0.045, 0.004, m.glaze_pink)
        cyl(f"cup_{i}_milk", (x, -1.16, 1.083), 0.04, 0.003, m.milk)
        cyl(f"cup_{i}_straw", (x + 0.012, -1.16, 1.125), 0.004, 0.1, m.teal_pale)
    cyl("plate", (-0.66, -1.25, 1.0), 0.14, 0.015, m.glaze)
    ring("plate_rim", (-0.66, -1.25, 1.009), 0.129, 0.009, m.glaze_pink)
    # Three cookies rest directly on the plate, with room between them and
    # the rim. Raising later cookies while offsetting them left unsupported
    # overhangs that read as floating, interpenetrating disks.
    for i, (x, y) in enumerate(((-0.715, -1.278), (-0.605, -1.278), (-0.66, -1.193))):
        cookie(f"plate_cookie_{i}", (x, y, 1.0165), 0.045, 0.018, m, seed=31 + i)
    box("napkins", (-1.4, -1.16, 1.03), (0.12, 0.1, 0.08), m.teal_pale)
    box("napkin_slot", (-1.4, -1.16, 1.073), (0.085, 0.018, 0.008), m.ink)
    box("napkin_fold", (-1.4, -1.16, 1.09), (0.07, 0.008, 0.055), m.white, rot=(0.18, 0, 0))
    cat("prop_cat_1", (-1.85, -1.27, 0.99), "Skadi", turn=math.radians(25))
    cat("prop_cat_2", (-0.13, -1.27, 0.99), "Freya", turn=math.radians(-20), tail_side=-1)
    mouse(m)

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
        profile_prism(f"milk_{i}_gable", [(x - 0.06, 1.67), (x + 0.06, 1.67), (x, 1.73)], 0.17, 0.12, m.white)
        box(f"milk_{i}_fold", (x, 0.17, 1.737), (0.013, 0.12, 0.023), m.pink)
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
    # Dedicated milk tap and cookie pickup ledge behind JJ. Runtime coordinates
    # are (x, height, -y); the cup docks directly beneath this nozzle.
    box("prep_ledge", (-1.45, -0.12, 1.085), (1.25, 0.5, 0.05), m.blue_mid)
    box("milk_dispenser", (-1.85, 0.02, 1.51), (0.28, 0.24, 0.46), m.teal_pale)
    box("milk_dispenser_label", (-1.85, -0.105, 1.56), (0.23, 0.012, 0.16), m.purple)
    text("milk_dispenser_text", "MILK", 0.052, m.white, (-1.85, -0.115, 1.56), extrude=0.001)
    cyl("milk_tap_pipe", (-1.85, -0.20, 1.39), 0.023, 0.20, m.steel, axis="Y")
    cyl("milk_tap_nozzle", (-1.85, -0.30, 1.365), 0.025, 0.065, m.steel)
    articulation("rig_service_stream", (-1.85, -0.30, 1.286), [
        cyl("service_milk_stream", (-1.85, -0.30, 1.286), 0.009, 0.097, m.white)
    ])
    # soft-serve machine at the right end of the back counter
    box("softserve_body", (-0.45, -0.05, 1.3), (0.5, 0.45, 0.7), m.white)
    box("softserve_panel", (-0.45, -0.29, 1.45), (0.4, 0.01, 0.2), m.pink)
    box("softserve_screen", (-0.45, -0.3, 1.47), (0.2, 0.01, 0.08), m.screen)
    for i, x in enumerate((-0.57, -0.33)):
        cyl(f"softserve_spout_{i}", (x, -0.33, 1.05), 0.03, 0.14, m.steel)
        box(f"softserve_lever_{i}", (x, -0.4, 1.13), (0.03, 0.14, 0.03), m.pink)
    cone("softserve_cone", (-0.45, -0.3, 1.78), 0.0, 0.12, 0.22, m.cookie)
    swirl = []
    for i in range(45):
        t = i / 44
        a = t * math.tau * 2.6
        r = 0.082 * (1 - t)
        swirl.append((-0.45 + r * math.cos(a), -0.3 + r * math.sin(a), 1.90 + t * 0.19))
    tube("softserve_swirl", swirl, 0.033, m.cream)
    cone("softserve_tip", (*swirl[-1][:2], 2.11), 0.027, 0, 0.065, m.cream)
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
    box("upper", (0, 0.1, 4.5), (5.4, 2.8, 2.2), m.enamel_blue)
    box("upper_cornice", (0, 0.1, 5.58), (5.5, 2.9, 0.06), m.blue_dark)
    # Panels in slightly different blues break up the big face
    box("upper_panel_a", (0.4, -1.32, 5.1), (2.2, 0.06, 0.5), m.enamel_light)
    box("upper_panel_b", (-1.6, -1.32, 3.75), (1.6, 0.06, 0.4), m.enamel_light)
    box("upper_panel_c", (2.0, -1.32, 3.75), (1.0, 0.06, 0.4), m.blue_mid)
    # Stay on the raised backing (left edge -0.7), clear of the first fan.
    box("ctrl_panel", (-0.3, -1.34, 5.1), (0.7, 0.06, 0.3), m.purple)
    for i, mt in enumerate((m.bulb_pink, m.neon, m.bulb)):
        box(f"ctrl_light_{i}", (-0.5 + i * 0.2, -1.38, 5.1), (0.08, 0.02, 0.08), mt)
    box("ctrl_grille", (-0.3, -1.37, 4.98), (0.5, 0.01, 0.03), m.ink)
    # Cables snaking from the control panel to the cow screen, a junction
    # box, and down the side
    box("junction_box", (-0.62, -1.33, 4.0), (0.24, 0.08, 0.3), m.purple)
    box("junction_lid", (-0.62, -1.38, 4.04), (0.18, 0.02, 0.16), m.blue_dark)
    for i in range(3):
        box(f"junction_key_{i}", (-0.68 + i * 0.06, -1.39, 3.91), (0.035, 0.02, 0.035), m.ink)
    box("junction_light", (-0.56, -1.39, 4.08), (0.03, 0.01, 0.03), m.bulb_pink)
    cable("cable_1", (-0.62, -1.4, 5.0), (-1.06, -1.56, 4.9), 0.24, 0.02, m.ink)
    tube(
        "cable_2",
        [(-0.5, -1.41, 4.96), (-0.56, -1.44, 4.7), (-0.62, -1.44, 4.42), (-0.6, -1.4, 4.15)],
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
    box("cow_frame", (-1.9, -1.55, 4.3), (1.7, 0.3, 1.5), m.plastic)
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
        box(f"fan_housing_{i}", (x, -1.35, 4.65), (0.78, 0.16, 0.78), m.plastic)
        cyl(f"fan_housing_ring_{i}", (x, -1.44, 4.65), 0.34, 0.03, m.ink, axis="Y", verts=32)
        hub = cyl(f"prop_fan_{i + 1}", (x, -1.46, 4.65), 0.07, 0.06, m.teal, axis="Y", verts=12)
        blades = []
        for b in range(4):
            a = math.radians(b * 90 + 20)
            profile = [(0.045, -0.022), (0.23, -0.065), (0.30, 0.025), (0.18, 0.083), (0.07, 0.04)]
            blades.append(profile_prism(
                f"fan_blade_{i}_{b}",
                [(x + u * math.cos(a) - v * math.sin(a), 4.65 + u * math.sin(a) + v * math.cos(a)) for u, v in profile],
                -1.46, 0.022, m.teal,
            ))
        join([hub] + blades, f"prop_fan_{i + 1}")
        for radius in (0.16, 0.25, 0.33):
            ring(f"fan_guard_{i}", (x, -1.51, 4.65), radius, 0.008, m.steel_dull, rot=(math.pi / 2, 0, 0))
        for a in (0, math.pi / 3, -math.pi / 3):
            box(f"fan_guard_spoke_{i}", (x, -1.515, 4.65), (0.65, 0.012, 0.012), m.ink, rot=(0, a, 0))
        for dx in (-0.33, 0.33):
            for dz in (-0.33, 0.33):
                cyl(f"fan_mount_{i}", (x + dx, -1.445, 4.65 + dz), 0.021, 0.025, m.steel_dull, axis="Y", verts=8)


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

    # Match the cow display's purple casing, 0.10 rim and 0.05 dark inset,
    # while keeping the portrait screen and its DOM projection in place.
    plate = panel("hotspot_shorts_tv", (0, 0.02, 0), (1.2, 0.3, 1.9), m.purple)
    panel("tv_frame_inner", (0, -0.14, 0), (1.0, 0.02, 1.7), m.ink)
    panel("tv_screen", (0, -0.145, 0), (0.9, 0.02, 1.6), m.screen_dark)
    # Idle artwork only: the live Shorts Section remains DOM (ADR 0002).
    # One small emissive texture keeps the image readable without scene lights.
    poster = mat("tv_bouldering_poster", "ink", emit="white", strength=0.9)
    image = bpy.data.images.load(os.path.join(ROOT, "blender", "textures", "tv-bouldering.png"))
    image.scale(432, 768)
    texture = poster.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Closest"  # Keep the pixel-art edges crisp.
    poster.node_tree.links.new(texture.outputs["Color"], poster.node_tree.nodes["Principled BSDF"].inputs["Emission Color"])
    mesh = bpy.data.meshes.new("tv_poster")
    mesh.from_pydata([(-0.45, -0.16, -0.8), (0.45, -0.16, -0.8), (0.45, -0.16, 0.8), (-0.45, -0.16, 0.8)], [], [(0, 1, 2, 3)])
    uv = mesh.uv_layers.new(name="poster")
    for loop, coord in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop.uv = coord
    face = _link(bpy.data.objects.new("tv_poster", mesh))
    mesh.materials.append(poster)
    parts.append(face)
    panel("tv_status_light", (0.38, -0.14, -0.89), (0.035, 0.02, 0.018), m.neon_pink)
    panel("tv_power_socket", (-0.61, 0.02, -0.48), (0.08, 0.1, 0.12), m.ink)
    # Rotate all authored front-facing parts as one assembly.
    for o in parts:
        o.matrix_world = Matrix.Translation(origin) @ turn @ o.matrix_world
    bpy.context.view_layer.update()
    parent(parts[1:], plate)

    box("tv_wall_bracket", (2.87, -0.55, 4.48), (0.14, 0.4, 0.65), m.steel)
    tube("tv_mount_arm", [(2.91, -0.55, 4.48), (3.20, -0.55, 4.48), (3.38, -0.89, 4.48)], 0.07, m.ink)
    # Share the cow display's junction box. Route below the fans and above
    # the horizontal pipe, then wrap the corner into the TV's side socket.
    power_inlet = origin + turn @ Vector((-0.65, 0.02, -0.48))
    tube(
        "tv_power",
        [(-0.54, -1.35, 4.02), (-0.2, -1.48, 3.98), (0.9, -1.48, 3.92),
         (2.0, -1.48, 3.98), (2.57, -1.48, 4.02), (2.72, -1.25, 4.01), power_inlet],
        0.022,
        m.ink,
    )
    for i, x in enumerate((0.1, 2.15)):
        box(f"tv_power_clip_{i}", (x, -1.48, 3.96 if i == 0 else 3.995), (0.07, 0.08, 0.075), m.steel)
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
    for x in (-0.87, -0.13):
        box("roof_unit_rail", (x, 0.3, 5.72), (0.09, 0.93, 0.12), m.steel_dull)
    box("roof_unit_service_panel", (0.012, 0.3, 6.03), (0.02, 0.54, 0.4), m.blue_dark)
    tube("roof_unit_conduit", [(0, 0.58, 5.9), (0.16, 0.58, 5.9), (0.2, 0.58, 5.71), (0.7, 0.58, 5.71)], 0.023, m.steel_dull)
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
    # A shallow concave reflector with a rolled edge and feed arm.
    center = Vector((2.2, 0.35, 6.2))
    rotation = Matrix.Rotation(math.radians(65), 3, "X")
    verts = []
    for radius in (0.0, 0.075, 0.15, 0.225, 0.3):
        for i in range(32):
            a = math.tau * i / 32
            verts.append(center + rotation @ Vector((radius * math.cos(a), radius * math.sin(a), 0.95 * radius ** 2)))
    faces = [(r * 32 + i, r * 32 + (i + 1) % 32, (r + 1) * 32 + (i + 1) % 32, (r + 1) * 32 + i) for r in range(4) for i in range(32)]
    mesh = bpy.data.meshes.new("dish")
    mesh.from_pydata(verts, [], faces)
    dish = _link(bpy.data.objects.new("dish", mesh))
    mesh.materials.append(m.steel_dull)
    solid = dish.modifiers.new("dish_thickness", "SOLIDIFY")
    solid.thickness = 0.015
    ring("dish_rim", center + rotation @ Vector((0, 0, 0.086)), 0.3, 0.012, m.steel, rot=rotation.to_euler())
    points = [center + rotation @ Vector(p) for p in ((0, -0.29, 0.08), (0, -0.21, 0.34), (0, 0, 0.24))]
    tube("dish_feed_arm", points, 0.018, m.ink)
    blob("dish_receiver", points[-1], (0.045, 0.055, 0.045), m.teal_pale, detail=6)
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
    body = box("hotspot_resume_kiosk", (-4.2, -0.4, 0.75), (0.8, 0.7, 1.5), m.enamel_teal)
    k = []
    k.append(box("kiosk_base", (-4.2, -0.4, 0.03), (0.9, 0.8, 0.06), m.purple))
    k.append(box("kiosk_cap", (-4.2, -0.4, 1.53), (0.86, 0.76, 0.06), m.purple))
    k.append(box("kiosk_screen_frame", (-4.2, -0.76, 0.95), (0.6, 0.02, 0.5), m.plastic))
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
    # Projecting bezel and printer mouth, framed by serviceable cabinet parts.
    for x in (-4.53, -3.87):
        k.append(box("kiosk_bezel_side", (x, -0.79, 0.96), (0.055, 0.13, 0.57), m.plastic))
    for z in (0.68, 1.24):
        k.append(box("kiosk_bezel_edge", (-4.2, -0.79, z), (0.69, 0.13, 0.055), m.plastic))
    k.append(box("kiosk_printer_hood", (-4.2, -0.8, 0.55), (0.49, 0.12, 0.035), m.brushed_steel))
    k.append(box("kiosk_printer_tray", (-4.2, -0.83, 0.44), (0.47, 0.17, 0.025), m.brushed_steel))
    k.append(box("kiosk_keypad_mount", (-4.2, -0.758, 0.26), (0.36, 0.03, 0.25), m.brushed_steel))
    # Small exposed edges where hands and printed sheets touch the cabinet.
    for x, y, z, width in ((-4.38, -0.861, 0.558, 0.055), (-4.04, -0.861, 0.558, 0.035), (-4.29, -0.916, 0.445, 0.09)):
        k.append(box("kiosk_contact_wear", (x, y, z), (width, 0.003, 0.009), m.steel_dull))
    for x, height in ((-4.52, 0.065), (-3.9, 0.04)):
        k.append(box("kiosk_corner_wear", (x, -0.752, 0.12), (0.022, 0.004, height), m.brushed_steel))
    k.append(box("kiosk_service_panel", (-3.792, -0.4, 0.7), (0.025, 0.52, 1.08), m.blue_mid))
    for z in (0.25, 1.12):
        k.append(box("kiosk_hinge", (-3.77, -0.19, z), (0.04, 0.04, 0.12), m.steel_dull))
    for z in (0.12, 1.42):
        for x in (-4.52, -3.88):
            k.append(cyl("kiosk_fastener", (x, -0.764, z), 0.016, 0.018, m.steel, axis="Y", verts=8))
    for z in (0.4, 0.47, 0.54):
        k.append(box("kiosk_side_vent", (-3.773, -0.4, z), (0.012, 0.32, 0.024), m.ink))
    parent(k, body)


def machine(m):
    body = box("hotspot_projects_machine", (3.3, -0.6, 0.9), (0.8, 0.9, 1.8), m.enamel_deep)
    k = []
    k.append(box("machine_canopy", (3.3, -0.7, 1.86), (0.92, 1.1, 0.12), m.pink))
    k.append(box("machine_canopy_sign", (3.3, -1.26, 1.86), (0.9, 0.02, 0.1), m.screen_pink))
    k.append(text("machine_sign_text", "PLAY", 0.07, m.ink, (3.3, -1.27, 1.86), extrude=0.003))
    for i in range(3):
        k.append(cyl(f"machine_canopy_bulb_{i}", (3.05 + i * 0.25, -1.1, 1.79), 0.03, 0.02, m.bulb))
    k.append(box("machine_screen_frame", (3.3, -1.06, 1.2), (0.62, 0.02, 0.56), m.plastic))
    k.append(box("machine_screen", (3.3, -1.07, 1.2), (0.54, 0.02, 0.48), m.screen))
    k += screen_content("machine", (3.3, -1.08, 1.2), 0.54, 0.48, m.ink, rows=3, seed=4)
    k.append(box("machine_screen_cursor", (3.42, -1.09, 1.08), (0.06, 0.01, 0.03), m.pink))
    for i, mt in enumerate((m.pink, m.teal, m.bulb_pink, m.white)):
        k.append(box(f"machine_btn_{i}", (3.1 + i * 0.13, -1.07, 0.78), (0.08, 0.03, 0.08), mt))
    k.append(box("machine_coin", (3.52, -1.07, 0.62), (0.08, 0.02, 0.12), m.ink))
    k.append(box("machine_slot", (3.3, -1.07, 0.38), (0.5, 0.03, 0.14), m.ink))
    k.append(box("machine_slot_lip", (3.3, -1.1, 0.3), (0.52, 0.06, 0.02), m.brushed_steel))
    k.append(box("machine_side_stripe", (3.71, -0.6, 0.9), (0.02, 0.6, 1.4), m.teal))
    k.append(box("machine_foot", (3.3, -0.6, 0.03), (0.86, 0.96, 0.06), m.ink))
    for x in (2.96, 3.64):
        k.append(box("machine_bezel_side", (x, -1.1, 1.2), (0.055, 0.13, 0.63), m.plastic))
        k.append(box("machine_corner_trim", (x, -1.065, 0.42), (0.055, 0.055, 0.6), m.blue_mid))
    for z in (0.9, 1.5):
        k.append(box("machine_bezel_edge", (3.3, -1.1, z), (0.72, 0.13, 0.05), m.plastic))
    k.append(box("machine_control_deck", (3.3, -1.14, 0.72), (0.76, 0.28, 0.07), m.plastic))
    for x, width in ((3.02, 0.055), (3.35, 0.075), (3.51, 0.04)):
        k.append(box("machine_deck_wear", (x, -1.279, 0.744), (width, 0.004, 0.009), m.brushed_steel))
    k.append(cyl("machine_joystick_base", (3.07, -1.2, 0.767), 0.055, 0.02, m.ink))
    k.append(cyl("machine_joystick_stem", (3.07, -1.2, 0.805), 0.014, 0.07, m.steel))
    k.append(blob("machine_joystick_grip", (3.07, -1.2, 0.845), (0.036, 0.036, 0.036), m.pink, detail=8))
    for x, color in ((3.35, m.teal), (3.5, m.pink)):
        k.append(cyl("machine_deck_button_rim", (x, -1.21, 0.76), 0.049, 0.018, m.ink))
        k.append(cyl("machine_deck_button", (x, -1.21, 0.777), 0.037, 0.022, color))
    k.append(box("machine_coin_surround", (3.52, -1.06, 0.59), (0.15, 0.035, 0.22), m.brushed_steel))
    k.append(box("machine_coin_cut", (3.52, -1.084, 0.62), (0.018, 0.008, 0.08), m.ink))
    k.append(box("machine_return", (3.52, -1.09, 0.53), (0.065, 0.03, 0.035), m.pink))
    k.append(box("machine_side_panel", (3.718, -0.6, 0.92), (0.025, 0.67, 1.12), m.blue_dark))
    for z in (0.51, 0.58, 0.65, 0.72):
        k.append(box("machine_side_vent", (3.737, -0.6, z), (0.012, 0.4, 0.025), m.ink))
    for z in (0.42, 1.4):
        for y in (-0.87, -0.33):
            k.append(cyl("machine_panel_bolt", (3.742, y, z), 0.016, 0.016, m.steel, axis="X", verts=8))
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
    moon = light("moon", "SUN", (0, 0, 10), "teal_pale", 1.0)
    moon.data.angle = math.radians(4)
    moon.rotation_euler = Vector((0.55, 0.75, -1.0)).to_track_quat("-Z", "Y").to_euler()
    light("fill", "AREA", (0, -12, 6), "blue_mid", 220, size=8, rot=(math.radians(70), 0, 0))
    light("neon_glow", "AREA", (-0.9, -2.3, 2.9), "teal", 90, size=3, rot=(math.radians(90), 0, 0))
    # Warm service light is the focal point; cyan stays local to machinery.
    # Less frontal fill leaves the jambs and shelf recesses legible in the bake.
    light("counter_glow", "POINT", (-1.2, -0.6, 2.1), "warm", 110, size=0.45)
    light("counter_glow_teal", "POINT", (-0.3, 0.0, 1.6), "teal", 18, size=0.3)
    light("counter_spill", "AREA", (-1.2, -1.2, 2.2), "cream", 100, size=1.8, rot=(math.radians(-25), 0, 0))
    light("kiosk_glow", "POINT", (-4.2, -1.0, 1.0), "teal", 40, size=0.3)
    light("machine_glow", "POINT", (3.3, -1.3, 1.2), "teal", 40, size=0.3)
    light("cow_glow", "POINT", (-1.9, -2.2, 4.3), "pink_pale", 30, size=0.6)
    light("door_lamps", "AREA", (2.0, -1.75, 2.3), "white", 25, size=0.8, rot=(math.radians(20), 0, 0))

    # A dim indigo sky: ambient light from above, so tops read lighter
    world = bpy.data.worlds.new("Night")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.02, 0.022, 0.07, 1)
    bg.inputs["Strength"].default_value = 0.7

    cams = {}
    for name, loc, look, lens in (
        ("street", (0, -16, 4.6), (0, 0, 3.0), 45),
        ("customers", (-4.3, -4.9, 1.9), (-3.3, -2.28, 0.85), 55),
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
    customer(m, 1, -3.0)
    customer(m, 2, -3.65)
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
    characters, animals, customers = [], [], []
    for joint, d in per_joint.items():
        if d["detail"]:
            if joint.startswith(("rig_prop_customer_", "rig_service_", "rig_barista_")):
                target = customers
            else:
                target = animals if joint.startswith(("rig_prop_cat_", "rig_prop_mouse")) else characters
            target.append(join(d["detail"], f"{joint}_detail"))
        for key, objs in d["glow"].items():
            join(objs, f"{joint}_glow_{key}")
    if characters:
        groups.append(("characters", characters, 1024))
    if animals:
        groups.append(("animals", animals, 1024))
    if customers:
        groups.append(("customers", customers, 1024))
    return groups


def unwrap(objs):
    """Give the objects a shared, non-overlapping 'bake' UV layout."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        if o.data.shape_keys:
            # UV editing an active non-Basis key can enable it on leaving Edit
            # Mode. Bake and export the authored sitting pose, never that key.
            o.active_shape_key_index = 0
            for key in o.data.shape_keys.key_blocks:
                key.value = 0
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
    portable = []
    for mt in mats:
        if name in ("animals", "customers", "car_paint", "car_detail"):
            # Interior surfaces hidden by a seated limb must not bake black:
            # walking exposes them. Bake coat colour with gentle broad shading
            # instead of positional lights or occlusion from other joints.
            nodes, links = mt.node_tree.nodes, mt.node_tree.links
            output = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
            original = output.inputs["Surface"].links[0].from_socket
            base = nodes.get("Principled BSDF").inputs["Base Color"]
            geometry = nodes.new("ShaderNodeNewGeometry")
            dot = nodes.new("ShaderNodeVectorMath")
            dot.operation = "DOT_PRODUCT"
            dot.inputs[1].default_value = Vector((0.25, -0.45, 0.85)).normalized()
            links.new(geometry.outputs["Normal"], dot.inputs[0])
            shade = nodes.new("ShaderNodeMath")
            shade.operation = "MULTIPLY_ADD"
            shade.inputs[1].default_value = 0.18
            shade.inputs[2].default_value = 0.88
            links.new(dot.outputs["Value"], shade.inputs[0])
            color = nodes.new("ShaderNodeMixRGB")
            color.blend_type = "MULTIPLY"
            color.inputs[0].default_value = 1
            if base.is_linked:
                links.new(base.links[0].from_socket, color.inputs[1])
            else:
                color.inputs[1].default_value = base.default_value
            links.new(shade.outputs[0], color.inputs[2])
            emission = nodes.new("ShaderNodeEmission")
            links.new(color.outputs[0], emission.inputs["Color"])
            links.new(emission.outputs[0], output.inputs["Surface"])
            portable.append((mt, output, original, [geometry, dot, shade, color, emission]))
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
    bpy.ops.object.bake(type="EMIT" if name in ("animals", "customers", "car_paint", "car_detail") else "COMBINED")
    for mt, node in added:
        mt.node_tree.nodes.remove(node)
    for mt, output, original, nodes in portable:
        mt.node_tree.links.new(original, output.inputs["Surface"])
        for node in nodes:
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
    moving = [(name, objs, size) for name, objs, size in groups if name in ("animals", "customers")]
    # Moving characters and serving Props leave no permanent baked shadows.
    hidden = [o for o in mesh_objects() if o.parent and o.parent.name.startswith(
        ("rig_prop_cat_", "rig_prop_mouse", "rig_prop_customer_", "rig_service_", "rig_barista_"))]
    for o in hidden:
        o.hide_render = True
    for name, objs, size in groups:
        if name in ("animals", "customers"):
            continue
        full = name.startswith("building")
        atlases.append((name, objs, bake_group(scene, name, objs, size, samples if full else max(128, samples // 2))))
    for o in hidden:
        o.hide_render = False
    for name, objs, size in moving:
        atlases.append((name, objs, bake_group(scene, name, objs, size, 128)))
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
        # finalize() already applies modifiers. Keep the cats' standing morph.
        export_apply=False,
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


def build_car_asset():
    """A small city hatchback facing +X. Separate portable atlases avoid
    baking the Creamery's positional lights into a moving vehicle. Wheel
    pivots export with local Z axles; only the paint material is tinted.
    """
    global GLB_PATH
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    scene = bpy.context.scene
    m = M()
    paint = mat("car_paint", "steel", rough=0.5)
    glass = mat("car_glass", "ink", rough=0.25)
    parts = []

    def panel(name, center, size, material, rot=(0, 0, 0)):
        o = box(name, center, size, material, rot)
        parts.append(o)
        return o

    # Side silhouettes cut up around the tires, rather than burying wheels
    # in a single box. The narrower chassis sits behind these panels.
    profile = [(-1.38, 0.55), (-1.18, 0.67), (0.83, 0.64), (1.39, 0.5), (1.39, 0.31), (1.12, 0.31)]
    for cx in (0.84, -0.87):
        profile += [(cx + 0.29 * math.cos(a), 0.24 + 0.29 * math.sin(a)) for a in [i * math.pi / 12 for i in range(1, 13)]]
        if cx > 0:
            profile += [(0.52, 0.3), (-0.55, 0.3), (-0.58, 0.31)]
    profile += [(-1.38, 0.31)]
    for side in (-1, 1):
        parts.append(profile_prism("car_side", profile, side * 0.51, 0.07, paint))
        panel("car_sill", (-0.03, side * 0.555, 0.31), (0.96, 0.065, 0.055), m.ink)
        panel("car_sill_light", (-0.03, side * 0.592, 0.34), (0.78, 0.009, 0.018), m.neon_soft)
        panel("car_door_seam", (-0.35, side * 0.553, 0.52), (0.015, 0.012, 0.24), m.ink)
        panel("car_door_handle", (-0.22, side * 0.566, 0.61), (0.13, 0.018, 0.026), m.steel_dull)
        panel("car_mirror_arm", (0.47, side * 0.55, 0.72), (0.05, 0.16, 0.035), m.ink)
        panel("car_mirror", (0.48, side * 0.66, 0.74), (0.14, 0.075, 0.07), paint)
        for cx in (-0.87, 0.84):
            pts = [(cx + 0.294 * math.cos(a), side * 0.558, 0.24 + 0.294 * math.sin(a)) for a in [i * math.pi / 12 for i in range(13)]]
            parts.append(tube("car_wheel_arch", pts, 0.024, m.ink))
    panel("car_chassis", (0, 0, 0.34), (2.6, 0.86, 0.16), m.ink)
    panel("car_belt", (0, 0, 0.60), (2.48, 1.01, 0.09), paint)
    panel("car_hood", (0.96, 0, 0.62), (0.66, 1.01, 0.055), paint, rot=(0, 0.12, 0))
    cabin = [(-1.03, 0.645), (-0.68, 0.98), (0.25, 0.98), (0.69, 0.645)]
    parts.append(profile_prism("car_cabin", cabin, 0, 0.88, glass))
    panel("car_roof", (-0.21, 0, 0.98), (0.98, 0.92, 0.055), paint)
    for side in (-1, 1):
        for a, b in ((cabin[0], cabin[1]), (cabin[2], cabin[3])):
            parts.append(tube("car_window_pillar", [(a[0], side * 0.45, a[1]), (b[0], side * 0.45, b[1])], 0.026, paint))
        panel("car_window_divider", (-0.27, side * 0.449, 0.805), (0.043, 0.018, 0.3), m.ink)
        panel("car_window_trim", (-0.15, side * 0.451, 0.657), (1.53, 0.018, 0.024), m.steel_dull)
    for x in (-1.37, 1.38):
        panel("car_bumper", (x, 0, 0.34), (0.11, 1.1, 0.11), m.ink)
        panel("car_license", (x * 1.05, 0, 0.35), (0.012, 0.23, 0.065), m.teal_pale)
    panel("car_front_grille", (1.402, 0, 0.45), (0.025, 0.57, 0.08), m.ink)
    for y in (-0.36, 0.36):
        panel("car_headlamp_recess", (1.385, y, 0.535), (0.045, 0.28, 0.105), m.ink)
        panel("car_headlamp", (1.414, y, 0.543), (0.012, 0.22, 0.038), m.bulb)
        for z in (0.49, 0.55):
            panel("car_tail_light", (-1.405, y, z), (0.018, 0.25, 0.027), m.neon_pink)
    for i in range(5):
        panel("car_rear_louver", (-1.08 - i * 0.048, 0, 0.686 - i * 0.014), (0.021, 0.7, 0.024), m.ink)
    body = articulation("rig_traffic_body", (0, 0, 0), parts)
    wheels = []
    for x in (-0.87, 0.84):
        for side in (-1, 1):
            y = side * 0.53
            pieces = [cyl("car_tire", (x, y, 0.24), 0.24, 0.16, m.ink, axis="Y", verts=32)]
            pieces.append(cyl("car_rim", (x, side * 0.619, 0.24), 0.16, 0.023, m.steel_dull, axis="Y", verts=24))
            pieces.append(cyl("car_hub", (x, side * 0.638, 0.24), 0.059, 0.018, m.blue_dark, axis="Y"))
            for i in range(5):
                a = math.tau * i / 5
                pieces.append(box("car_wheel_slot", (x + 0.103 * math.cos(a), side * 0.636, 0.24 + 0.103 * math.sin(a)), (0.068, 0.01, 0.027), m.ink, rot=(0, -a, 0)))
            wheels.append(articulation(f"rig_traffic_wheel_{len(wheels)}", (x, y, 0.24), pieces))
    articulation("rig_traffic_car", (0, 0, 0), [body] + wheels)
    finalize()
    # Join by material category and pivot: two small atlases, a handful of
    # emissive parts, and four rotating wheels instead of per-panel draws.
    paints, details, glows = [], [], {}
    for pivot in [body] + wheels:
        painted, plain = [], []
        for o in list(pivot.children):
            mt = o.data.materials[0]
            if is_emissive(mt):
                glows.setdefault(mt.name, []).append(o)
            elif mt == paint:
                painted.append(o)
            else:
                plain.append(o)
        if painted:
            paints.append(join(painted, f"{pivot.name}_paint"))
        if plain:
            details.append(join(plain, f"{pivot.name}_detail"))
    for name, objects in glows.items():
        join(objects, f"car_glow_{name}")
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "OPTIX"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.view_settings.view_transform = "Standard"
    for name, objects, size in (("car_paint", paints, 256), ("car_detail", details, 512)):
        use_atlas(name, objects, bake_group(scene, name, objects, size, 32))
    GLB_PATH = os.path.join(ROOT, "public", "models", "traffic-car.glb")
    export()


if __name__ == "__main__":
    if "--car-only" not in sys.argv:
        scene, cams = build()
        finalize()
        if "--no-render" not in sys.argv:
            render(scene, cams)
        groups = regroup()
        if "--no-bake" not in sys.argv:
            bake_all(scene, groups, samples=512)
        export()
    build_car_asset()
