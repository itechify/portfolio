"""Builds the Creamery blockout, renders a review image, and exports the GLB.

Run headless:  blender -b --python blender/build.py [-- --no-render]
Everything here is reproducible; the .blend is never saved.
"""

import math
import os
import sys

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLB_PATH = os.path.join(ROOT, "public", "models", "creamery.glb")
RENDER_PATH = os.path.join(ROOT, "blender", "renders", "blockout.png")

# Palette sampled from the Reference (sRGB hex).
PAL = {
    "sky": "68c8f8",
    "blue": "4050e0",
    "blue_mid": "40a0e0",
    "blue_deep": "2838b0",
    "purple": "402040",
    "purple_deep": "281030",
    "teal": "48f0e0",
    "teal_pale": "a8f0f0",
    "pink": "f06ea8",
    "pink_pale": "f8b0d0",
    "white": "f8f8f8",
}


def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def srgb(hex6):
    r, g, b = (int(hex6[i : i + 2], 16) / 255 for i in (0, 2, 4))
    return (_lin(r), _lin(g), _lin(b), 1.0)


_mats = {}


def mat(name, color, emit=None, strength=0.0, rough=0.7):
    key = (name, color, emit, strength, rough)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = srgb(PAL[color])
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = srgb(PAL[emit])
        bsdf.inputs["Emission Strength"].default_value = strength
    _mats[key] = m
    return m


def box(name, center, size, material):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.object
    o.name = name
    o.scale = size
    o.data.materials.append(material)
    return o


def cyl(name, center, radius, depth, material, axis="Z", verts=24):
    rot = {"Z": (0, 0, 0), "Y": (math.pi / 2, 0, 0), "X": (0, math.pi / 2, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=radius, depth=depth, location=center, rotation=rot
    )
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    return o


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


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    blue = mat("blue", "blue")
    blue_mid = mat("blue_mid", "blue_mid")
    blue_deep = mat("blue_deep", "blue_deep")
    purple = mat("purple", "purple")
    purple_deep = mat("purple_deep", "purple_deep")
    pink = mat("pink", "pink")
    teal = mat("teal", "teal")
    ground_m = mat("ground", "purple_deep", rough=0.25)
    neon = mat("neon", "teal", emit="teal", strength=3.0)
    neon_pink = mat("neon_pink", "pink", emit="pink", strength=4.0)
    screen = mat("screen", "teal_pale", emit="teal_pale", strength=1.4)
    screen_cow = mat("screen_cow", "pink_pale", emit="pink_pale", strength=1.3)
    bulb = mat("bulb", "white", emit="white", strength=3.0)

    # Street
    box("ground", (0, 0, -0.05), (16, 10, 0.1), ground_m)
    box("curb", (0, -2.2, 0.06), (12, 0.6, 0.12), purple)

    # Lower storefront. The left two thirds is an open counter recess built from
    # separate walls so the interior is visible; the right third is solid.
    box("storefront_right", (1.6, 0, 1.3), (2.6, 3.0, 2.6), blue)
    box("storefront_back", (-1.3, 0.9, 1.3), (3.2, 1.2, 2.6), blue)
    box("storefront_left_wall", (-2.75, -0.6, 1.3), (0.3, 1.8, 2.6), blue)
    box("storefront_ceiling", (-1.3, -0.6, 2.45), (3.2, 1.8, 0.3), blue)
    box("recess_floor", (-1.3, -0.6, 0.05), (2.6, 1.8, 0.1), purple_deep)
    box("recess_back_wall", (-1.3, 0.29, 1.2), (2.6, 0.02, 2.2), purple_deep)
    box("recess_left_wall", (-2.59, -0.6, 1.2), (0.02, 1.8, 2.2), purple_deep)
    box("recess_right_wall", (0.29, -0.6, 1.2), (0.02, 1.8, 2.2), purple_deep)
    box("counter_top", (-1.2, -1.3, 0.95), (2.6, 0.4, 0.08), pink)
    box("counter_base", (-1.2, -1.27, 0.45), (2.6, 0.3, 0.9), blue_deep)
    box("back_shelf", (-1.3, 0.2, 1.7), (2.2, 0.15, 0.6), blue_mid)
    for i, x in enumerate((-2.0, -1.2, -0.4)):
        cyl(f"prop_stool_{i + 1}_post", (x, -1.9, 0.25), 0.05, 0.5, purple)
        cyl(f"prop_stool_{i + 1}_seat", (x, -1.9, 0.53), 0.22, 0.07, pink)
    box("prop_barista", (-0.6, -0.6, 1.35), (0.45, 0.4, 0.9), blue_mid)
    box("prop_barista_head", (-0.6, -0.6, 1.95), (0.35, 0.35, 0.3), purple)
    cyl("counter_arch", (-0.3, 0.26, 1.6), 0.45, 0.06, screen_cow, axis="Y")
    box("menu_board", (-1.9, 0.26, 1.9), (0.9, 0.04, 0.5), screen)

    box("door", (1.1, -1.48, 1.05), (0.7, 0.08, 2.1), purple_deep)
    box("hotspot_contact_board", (2.0, -1.52, 1.75), (0.9, 0.06, 0.8), blue_mid)
    for i, x in enumerate((1.75, 2.0, 2.25)):
        lamp_m = neon_pink if i == 1 else bulb
        cyl(f"wall_lamp_{i + 1}", (x, -1.52, 2.35), 0.08, 0.05, lamp_m, axis="Y")
    cyl("prop_trash", (1.0, -1.95, 0.3), 0.18, 0.6, teal)
    cyl("prop_trash_lid", (1.0, -1.95, 0.62), 0.2, 0.04, blue_mid)

    # Right-side vending machine: Projects
    box("hotspot_projects_machine", (3.3, -0.6, 0.9), (0.8, 0.9, 1.8), blue_deep)
    box("machine_screen", (3.3, -1.06, 1.15), (0.55, 0.03, 0.5), screen)
    box("machine_top", (3.3, -0.6, 1.85), (0.85, 0.95, 0.12), pink)
    box("machine_slot", (3.3, -1.06, 0.45), (0.5, 0.03, 0.12), purple_deep)

    # Left kiosk: Resume
    box("hotspot_resume_kiosk", (-4.2, -0.4, 0.75), (0.8, 0.7, 1.5), mat("kiosk", "teal_pale"))
    box("kiosk_screen", (-4.2, -0.77, 0.9), (0.5, 0.03, 0.45), screen)
    box("kiosk_slot", (-4.2, -0.77, 0.35), (0.45, 0.03, 0.08), purple_deep)
    cyl("kiosk_mast", (-4.2, -0.4, 1.75), 0.03, 0.5, purple)
    cyl("kiosk_lamp_l", (-4.35, -0.4, 2.05), 0.08, 0.1, neon_pink)
    cyl("kiosk_lamp_r", (-4.05, -0.4, 2.05), 0.08, 0.1, neon_pink)

    # Sign band: neon sign on the left, pink vents on the right
    box("sign_band", (0, 0, 3.0), (6.6, 3.4, 0.8), blue_deep)
    box("sign_backplate", (-0.9, -1.72, 3.0), (4.4, 0.06, 0.7), purple)
    box("hotspot_home_sign", (-0.9, -1.76, 3.0), (4.2, 0.04, 0.55), neon)
    box("sign_lip", (0, -1.7, 2.6), (6.6, 0.1, 0.06), teal)
    for i in range(5):
        box(f"vent_{i + 1}", (2.5, -1.72, 2.72 + i * 0.14), (1.4, 0.05, 0.06), pink)

    # Upper block: cow screen and fans
    box("upper", (0, 0.1, 4.5), (5.4, 2.8, 2.2), blue)
    box("upper_panel", (0.9, -1.32, 4.4), (1.2, 0.08, 0.5), blue_mid)
    box("cow_frame", (-1.9, -1.55, 4.3), (1.6, 0.3, 1.4), purple)
    box("hotspot_about_cowscreen", (-1.9, -1.72, 4.3), (1.4, 0.04, 1.2), screen_cow)
    box("cow_eye_l", (-2.15, -1.75, 4.45), (0.18, 0.02, 0.18), purple_deep)
    box("cow_eye_r", (-1.65, -1.75, 4.45), (0.18, 0.02, 0.18), purple_deep)
    box("cow_snout", (-1.9, -1.75, 4.0), (0.6, 0.02, 0.3), pink)
    for i, x in enumerate((0.5, 1.4, 2.3)):
        box(f"fan_housing_{i + 1}", (x, -1.35, 4.8), (0.75, 0.15, 0.75), purple)
        cyl(f"prop_fan_{i + 1}", (x, -1.44, 4.8), 0.3, 0.05, teal, axis="Y")

    # Rooftop
    box("roof", (0, 0.1, 5.65), (5.6, 3.0, 0.1), blue_deep)
    box("roof_unit", (-0.5, 0.3, 6.0), (1.0, 0.8, 0.6), purple)
    for i, x in enumerate((-1.9, -1.3)):
        cyl(f"antenna_{i + 1}", (x, 0.6, 6.4), 0.02, 1.5, purple)
    box("monitor_leg", (1.4, 0.4, 6.0), (0.1, 0.1, 0.6), purple)
    tilt = (math.radians(-8), 0, 0)
    box("monitor_frame", (1.4, 0.3, 6.8), (2.2, 0.25, 1.2), purple).rotation_euler = tilt
    box("hotspot_credits_monitor", (1.4, 0.16, 6.82), (2.0, 0.04, 1.0), screen).rotation_euler = tilt
    for i, (x, y) in enumerate(((-2.3, 0.9), (2.4, 1.0), (0.2, 1.1), (-0.9, 1.2))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.35, location=(x, y, 5.9))
        o = bpy.context.object
        o.name = f"prop_plant_{i + 1}"
        o.data.materials.append(blue_deep)

    # Lights for the review render only (not exported)
    light("fill", "AREA", (0, -12, 6), "blue_mid", 600, size=8, rot=(math.radians(70), 0, 0))
    light("neon_glow", "AREA", (-0.9, -2.3, 2.9), "teal", 250, size=3, rot=(math.radians(90), 0, 0))
    light("counter_glow", "POINT", (-1.2, -0.6, 2.1), "pink", 200, size=0.5)
    light("counter_glow_teal", "POINT", (-0.3, 0.0, 1.6), "teal", 60, size=0.3)
    light("kiosk_glow", "POINT", (-4.2, -1.0, 1.0), "teal", 40, size=0.3)
    light("machine_glow", "POINT", (3.3, -1.3, 1.2), "teal", 40, size=0.3)

    world = bpy.data.worlds.new("Night")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.004, 0.005, 0.02, 1)
    bg.inputs["Strength"].default_value = 1.0

    bpy.ops.object.camera_add(location=(0, -17, 4.8))
    cam = bpy.context.object
    cam.name = "review_camera"
    cam.data.lens = 45
    cam.rotation_euler = (math.radians(86), 0, 0)
    scene.camera = cam
    return scene


def render(scene):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "OPTIX"
    scene.render.engine = "CYCLES"
    scene.cycles.device = "GPU"
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.view_settings.view_transform = "AgX"
    scene.render.filepath = RENDER_PATH
    os.makedirs(os.path.dirname(RENDER_PATH), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print("RENDERED", RENDER_PATH)


def export():
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
    print("EXPORTED", GLB_PATH, os.path.getsize(GLB_PATH), "bytes")


if __name__ == "__main__":
    scene = build()
    if "--no-render" not in sys.argv:
        render(scene)
    export()
