"""Render repeatable close views without baking or changing the shipped GLB.

blender -b --python-exit-code 1 --python blender/review_details.py -- before
"""
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build

label = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "after"
build.RENDER_DIR = os.path.join(build.RENDER_DIR, "model-details", label)
scene, cameras = build.build()
views = {name: cameras[name] for name in ("street", "counter")}
for name, location, target, lens in (
    ("entrance", (3.7, -5.7, 2.4), (1.25, -1.3, 1.25), 55),
    ("kiosk", (-5.8, -3.5, 1.8), (-4.2, -0.4, 0.85), 55),
    ("food", (-0.7, -2.35, 1.85), (-0.86, -1.22, 1.02), 60),
    ("serving", (-0.8, -2.0, 1.95), (-0.9, -1.05, 1.32), 60),
):
    bpy.ops.object.camera_add(location=location)
    camera = bpy.context.object
    camera.data.lens = lens
    camera.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()
    views[name] = camera
build.finalize()
print("DETAIL REVIEW: model constructed", flush=True)
build.render(scene, views)
